import { MapView } from './MapView.js';
import { ScenarioPanel } from './ScenarioPanel.js';
import { ScenarioEditor } from './ScenarioEditor.js';
import { AnimationControls } from './AnimationControls.js';
import { KMeans } from './KMeans.js';
import { VQ } from './VQ.js';
import { Scenario } from './Scenario.js';

/**
 * App – Hauptklasse, orchestriert Panel, Karte und Animationssteuerung.
 */
export class ClusterKarten {
  /**
   * @param {HTMLElement} panelEl     Container für die Seitenleiste
   * @param {HTMLElement} mapEl       Container für die Karte
   * @param {HTMLElement} controlsEl  Container für die Animationssteuerung
   * @param {HTMLElement} [logEl]     Container für das Schrittprotokoll
   */
  constructor(panelEl, mapEl, controlsEl, logEl) {
    // Szenario-Banner (oben links)
    this._bannerEl = document.getElementById('scenario-banner');
    const infoBtnEl = document.getElementById('banner-info-btn');
    if (infoBtnEl) {
      infoBtnEl.addEventListener('click', () => {
        const descEl = document.getElementById('banner-desc');
        if (descEl) {
          descEl.hidden = !descEl.hidden;
          infoBtnEl.classList.toggle('scenario-banner__info-btn--active', !descEl.hidden);
        }
      });
    }

    // Zwei austauschbare Ansichten innerhalb des Panel-Containers
    this._panelScenarioEl = document.createElement('div');
    this._panelScenarioEl.style.cssText = 'display:contents';
    this._panelEditorEl   = document.createElement('div');
    this._panelEditorEl.style.cssText   = 'display:none';
    panelEl.appendChild(this._panelScenarioEl);
    panelEl.appendChild(this._panelEditorEl);

    this._mapView  = new MapView(mapEl);
    this._panel    = new ScenarioPanel(this._panelScenarioEl, {
      onSelect:            id       => this._loadScenario(id),
      onNewScenario:       ()       => this._startEditor(this._currentScenario),
      onCreateScenario:    ()       => this._startEditor(null),
      onLoadFile:          scenario => this._loadScenarioData(scenario),
      onAlgoChange:        mode     => this._setMode(mode),
      onCopyUrl:           ()       => this._buildShareUrl(),
      onClose:             ()       => this._toggleSettings(),
      onShowDistChange:    v        => { if (this._currentScenario) this._currentScenario.showDist    = v; this._controls.setShowDist(v); },
      onShowAssignChange:  v        => { if (this._currentScenario) this._currentScenario.showAssign  = v; this._controls.setShowAssign(v); },
      onHeatmapChange:     v        => { if (this._currentScenario) this._currentScenario.showHeatmap = v; this._mapView.setHeatmapVisible(v); },
    });
    this._controls = new AnimationControls(controlsEl, {
      onStepChange:    (_index, step) => this._onStep(step),
      onKChange:       k             => { if (this._currentScenario) this._currentScenario.k = k; this._rerun(); },
      onHeatmapToggle: v             => { if (this._currentScenario) this._currentScenario.showHeatmap = v; this._mapView.setHeatmapVisible(v); },
      logContainer:    logEl ?? null,
      onLogToggle:     ()            => this._toggleLog(),
      onOpenEditor:    ()            => this._startEditor(this._currentScenario),
      onOpenSettings:  ()            => this._toggleSettings(),
    });

    this._currentScenario = null;
    this._editingScenario = null;
    this._editor            = null;
    this._editorAbortCtrl   = null;
  }

  /** Lädt das Manifest und initialisiert das erste Szenario. */
  async init() {
    const index = await this._fetchJson('./public/scenarios/index.json');

    this._panel.setScenarioList(
      await Promise.all(
        index.scenarios.map(async s => {
          const data = await this._fetchJson(`./public/scenarios/${s.id}.json`);
          return { id: s.id, name: data.name };
        })
      )
    );

    // URL-Parameter ?scenario=<pako-base64url> hat Vorrang, dann ?id=<id>
    const urlScenario = this._loadScenarioFromUrl();
    const params      = new URLSearchParams(window.location.search);
    const urlId       = params.get('id');
    const urlSearch   = window.location.search;

    if (urlScenario) {
      this._applyScenario(urlScenario);
    } else if (urlId) {
      await this._loadScenario(urlId, urlSearch);
    } else if (index.scenarios.length > 0) {
      await this._loadScenario(index.scenarios[0].id);
    }
  }

  /**
   * Liest den URL-Parameter „scenario", dekodiert ihn (base64url + pako)
   * und gibt ein Scenario-Objekt zurück – oder null bei Fehler/Fehlen.
   * @returns {Scenario|null}
   */
  _loadScenarioFromUrl() {
    const params  = new URLSearchParams(window.location.search);
    const encoded = params.get('scenario');
    if (!encoded) return null;
    try {
      return Scenario.fromPakoEncoded(encoded);
    } catch (err) {
      console.error('Fehler beim Dekodieren des URL-Szenarios:', err);
      return null;
    }
  }

  /**
   * Lädt ein Szenario anhand seiner ID und aktualisiert Karte + Panel.
   * @param {string} id
   * @param {string|null} [urlSearch]  Optionaler URL-Query-String zum Überschreiben der Einstellungen.
   */
  async _loadScenario(id, urlSearch = null) {
    const data     = await this._fetchJson(`./public/scenarios/${id}.json`);
    const scenario = Scenario.fromJSON(data);
    if (urlSearch) scenario.applyUrlParams(urlSearch);
    this._applyScenario(scenario);
  }

  /** Wechselt den Algorithmus und startet neu. */
  _setMode(mode) {
    if (!this._currentScenario) return;
    this._currentScenario.algo = mode;
    this._updateBanner();
    this._rerun();
  }

  /** Führt den aktuell gewählten Algorithmus aus. */
  _rerun() {
    if (!this._currentScenario) return;
    if (this._currentScenario.algo === 'vq') this._rerunVQ();
    else                                     this._rerunKMeans();
  }

  /** Führt K-Means für das aktuelle Szenario durch. */
  _rerunKMeans() {
    try {
      const kmeans = new KMeans(this._currentScenario.datapoints, this._currentScenario.k);
      const steps  = kmeans.computeAllSteps();
      this._controls.setSteps(steps);
    } catch (err) {
      console.error('K-Means Fehler:', err.message);
    }
  }

  _rerunVQ() {
    try {
      const vq    = new VQ(this._currentScenario.datapoints, this._currentScenario.k, this._mapView.getMapBounds());
      const steps = vq.computeAllSteps();
      this._controls.setSteps(steps);
    } catch (err) {
      console.error('VQ Fehler:', err.message);
    }
  }

  /**
   * Wird von AnimationControls aufgerufen, wenn der Schritt wechselt.
   * @param {object} step
   */
  _onStep(step) {
    if (step.type?.startsWith('vq-')) {
      this._mapView.renderVQStep(step, this._currentScenario.datapoints);
    } else {
      this._mapView.renderClusterStep(step, this._currentScenario.datapoints);
    }
  }

  /** Erzeugt eine Share-URL für das aktuelle Szenario + Algorithmus,
   *  schreibt sie in die Adresszeile und gibt sie zurück. */
  _buildShareUrl() {
    if (!this._currentScenario) return '';
    const url = this._currentScenario.shareUrl();
    //history.pushState(null, '', url);
    return url;
  }

  /**
   * @param {string} url
   * @returns {Promise<any>}
   */
  async _fetchJson(url) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Fehler beim Laden von ${url}: ${response.status}`);
    }
    return response.json();
  }

  _loadScenarioData(plainObj) {
    this._applyScenario(Scenario.fromJSON(plainObj));
  }

  /**
   * Setzt ein Scenario-Objekt als aktives Szenario und aktualisiert alle UI-Komponenten.
   * @param {Scenario} scenario
   */
  _applyScenario(scenario) {
    this._currentScenario = scenario;
    this._panel.setAlgo(scenario.algo);
    this._applyDisplaySettings(scenario);
    this._panel.setActiveScenario(scenario);
    if (scenario.location) this._mapView.setView(scenario.location);
    this._controls.setK(scenario.k);
    this._controls.setScenarioInfo(scenario.name, scenario.description);
    this._updateBanner();
    this._rerun();
  }

  // ── Szenario-Editor ──────────────────────────────────────────────────

  /**
   * Wendet Anzeigeeinstellungen eines Szenarios auf Controls, Panel und Karte an.
   * @param {Scenario} scenario
   */
  _applyDisplaySettings(scenario) {
    this._controls.setShowDist(scenario.showDist);
    this._panel.setShowDist(scenario.showDist);
    this._controls.setShowAssign(scenario.showAssign);
    this._panel.setShowAssign(scenario.showAssign);
    this._mapView.setHeatmapVisible(scenario.showHeatmap);
    this._panel.setShowHeatmap(scenario.showHeatmap);
  }

  _toggleLog() {
    document.getElementById('app')?.classList.toggle('log--collapsed');
  }

  _toggleSettings() {
    document.getElementById('app')?.classList.toggle('settings--open');
  }

  _updateBanner() {
    if (!this._bannerEl || !this._currentScenario) return;
    const s = this._currentScenario;
    this._bannerEl.querySelector('#banner-name').textContent = s.name ?? '';
    this._bannerEl.querySelector('#banner-algo').textContent = s.algo === 'vq' ? 'VQ' : 'K-Means';
    const h5pLink = this._bannerEl.querySelector('#banner-h5p-link');
    if (h5pLink) {
      h5pLink.href   = s.algo === 'vq' ? './vq-h5p.html' : './kmeans-h5p.html';
      h5pLink.hidden = false;
    }
    this._bannerEl.querySelector('#banner-task').textContent = s.task ?? '';
    const descEl = this._bannerEl.querySelector('#banner-desc');
    descEl.textContent = s.description ?? '';
    descEl.hidden = true;
    const infoBtnEl = this._bannerEl.querySelector('#banner-info-btn');
    if (infoBtnEl) infoBtnEl.classList.remove('scenario-banner__info-btn--active');
    // Info-Button nur anzeigen wenn Beschreibung vorhanden
    if (infoBtnEl) infoBtnEl.hidden = !s.description;
  }

  _startEditor(existingScenario = null) {
    const editing = existingScenario
      ?? new Scenario({ location: this._mapView.getViewGeoUri() });
    this._editingScenario = editing;

    this._controls.setSteps([]);
    if (!existingScenario) this._mapView.clearVisualization();
    document.getElementById('app')?.classList.add('app--editing');

    const nameEl    = document.getElementById('banner-name');
    const taskEl    = document.getElementById('banner-task');
    const descEl    = document.getElementById('banner-desc');
    const infoBtnEl = document.getElementById('banner-info-btn');

    this._editorAbortCtrl = new AbortController();
    const { signal } = this._editorAbortCtrl;

    if (nameEl) {
      nameEl.contentEditable = 'true';
      nameEl.textContent = editing.name;
      nameEl.addEventListener('input', () => { editing.name = nameEl.textContent.trim(); }, { signal });
    }
    if (taskEl) {
      taskEl.contentEditable = 'true';
      taskEl.textContent = editing.task;
      taskEl.addEventListener('input', () => { editing.task = taskEl.textContent.trim(); }, { signal });
    }
    if (descEl) {
      descEl.contentEditable = 'true';
      descEl.hidden = false;
      descEl.textContent = editing.description;
      descEl.addEventListener('input', () => { editing.description = descEl.textContent.trim(); }, { signal });
    }
    if (infoBtnEl) infoBtnEl.hidden = true;

    this._panelScenarioEl.style.display = 'none';
    this._panelEditorEl.style.cssText   = 'display:contents';
    this._editor = new ScenarioEditor(this._panelEditorEl, {
      scenario:   editing,
      onCancel:   () => this._stopEditor(),
      getGeoUri:  () => this._mapView.getViewGeoUri(),
      onClearAll: () => this._mapView.clearVisualization(),
      onNavigate: (lat, lng, zoom) => this._mapView.flyTo(lat, lng, zoom),
      onSave:     () => this._saveEditorScenario(),
    });
    this._editor.onPointsChanged(pts => this._mapView.renderEditPoints(pts));
    this._mapView.enableEditMode((lat, lng) => this._editor.addPoint(lat, lng));
    this._editorMoveHandler = () => this._editor.updateGeoInfo();
    this._mapView.onMoveEnd(this._editorMoveHandler);
  }

  _saveEditorScenario() {
    if (!this._editingScenario) return;
    this._editingScenario.location = this._mapView.getViewGeoUri();
    if (!this._editingScenario.name) this._editingScenario.name = 'Neues Szenario';
    this._editingScenario.downloadJSON();
  }

  _stopEditor() {
    this._editorAbortCtrl?.abort();
    this._editorAbortCtrl = null;
    if (this._editorMoveHandler) {
      this._mapView.offMoveEnd(this._editorMoveHandler);
      this._editorMoveHandler = null;
    }
    this._mapView.disableEditMode();
    document.getElementById('app')?.classList.remove('app--editing');
    const nameEl = document.getElementById('banner-name');
    const taskEl = document.getElementById('banner-task');
    const descEl = document.getElementById('banner-desc');
    if (nameEl) nameEl.contentEditable = 'false';
    if (taskEl) taskEl.contentEditable = 'false';
    if (descEl) { descEl.contentEditable = 'false'; descEl.hidden = true; }
    this._panelEditorEl.style.cssText   = 'display:none';
    this._panelScenarioEl.style.display = 'contents';
    this._editor          = null;
    this._editingScenario = null;
    if (this._currentScenario) {
      this._updateBanner();
      this._rerun();
    }
  }
}
