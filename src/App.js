import { MapView } from './MapView.js';
import { ScenarioPanel } from './ScenarioPanel.js';
import { ScenarioEditor } from './ScenarioEditor.js';
import { AnimationControls } from './AnimationControls.js';
import { KMeans } from './KMeans.js';
import { VQ } from './VQ.js';

/**
 * App – Hauptklasse, orchestriert Panel, Karte und Animationssteuerung.
 */
export class App {
  /**
   * @param {HTMLElement} panelEl     Container für die Seitenleiste
   * @param {HTMLElement} mapEl       Container für die Karte
   * @param {HTMLElement} controlsEl  Container für die Animationssteuerung
   * @param {HTMLElement} [logEl]     Container für das Schrittprotokoll
   */
  constructor(panelEl, mapEl, controlsEl, logEl) {
    this._panelEl = panelEl;

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
      onSelect:      id       => this._loadScenario(id),
      onNewScenario: ()       => this._startEditor(this._currentScenario),
      onLoadFile:    scenario => this._loadScenarioData(scenario),
      onAlgoChange:  mode     => this._setMode(mode),
      onCopyUrl:     ()       => this._buildShareUrl(),
      onClose:       ()       => this._toggleSettings(),
    });
    this._controls = new AnimationControls(controlsEl, {
      onStepChange:    (_index, step) => this._onStep(step),
      onKChange:       k             => this._rerun(k),
      onHeatmapToggle: v             => this._mapView.setHeatmapVisible(v),
      logContainer:    logEl ?? null,
      onLogToggle:     ()            => this._toggleLog(),
      onOpenEditor:    ()            => this._startEditor(this._currentScenario),
      onOpenSettings:  ()            => this._toggleSettings(),
    });

    this._currentScenario   = null;
    this._currentScenarioId = null;
    this._currentK          = 3;
    this._mode              = 'vq';
    this._editor            = null;
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
    const urlAlgo     = params.get('algo');
    const urlK        = parseInt(params.get('k') ?? '', 10);

    const kOverride = (!isNaN(urlK) && urlK >= 1) ? urlK : null;

    if (urlScenario) {
      if (urlAlgo && ['vq', 'kmeans'].includes(urlAlgo)) {
        this._mode = urlAlgo;
        this._panel.setAlgo(urlAlgo);
      }
      this._loadScenarioData(urlScenario, kOverride);
    } else if (urlId) {
      if (urlAlgo && ['vq', 'kmeans'].includes(urlAlgo)) {
        this._mode = urlAlgo;
        this._panel.setAlgo(urlAlgo);
      }
      await this._loadScenario(urlId, kOverride);
    } else if (index.scenarios.length > 0) {
      await this._loadScenario(index.scenarios[0].id);
    }
  }

  /**
   * Liest den URL-Parameter „scenario", dekodiert ihn (base64url + pako)
   * und gibt das Szenario-Objekt zurück – oder null bei Fehler/Fehlen.
   * @returns {object|null}
   */
  _loadScenarioFromUrl() {
    const params  = new URLSearchParams(window.location.search);
    const encoded = params.get('scenario');
    if (!encoded) return null;
    try {
      // base64url → base64 → Uint8Array → pako inflate → JSON
      const b64        = encoded.replace(/-/g, '+').replace(/_/g, '/');
      const binary     = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      const json       = /* global pako */ pako.inflate(binary, { to: 'string' });
      return JSON.parse(json);
    } catch (err) {
      console.error('Fehler beim Dekodieren des URL-Szenarios:', err);
      return null;
    }
  }

  /**
   * Lädt ein Szenario anhand seiner ID und aktualisiert Karte + Panel.
   * @param {string} id
   */
  async _loadScenario(id, overrideK = null) {
    const scenario = await this._fetchJson(`./public/scenarios/${id}.json`);

    this._currentScenario   = scenario;
    this._currentScenarioId = id;
    this._currentK          = overrideK ?? scenario.k ?? 3;

    this._panel.setActiveScenario(scenario);
    this._mapView.setView(scenario.location);
    this._controls.setK(this._currentK);
    this._controls.setScenarioInfo(scenario.name ?? '', scenario.description ?? '');
    this._updateBanner();
    this._rerun(this._currentK);
  }

  /** Wechselt den Algorithmus und startet neu. */
  _setMode(mode) {
    this._mode = mode;
    if (this._currentScenario) {
      this._updateBanner();
      this._rerun(this._currentK);
    }
  }

  /** Führt den aktuell gewählten Algorithmus aus. */
  _rerun(k) {
    if (this._mode === 'vq') this._rerunVQ(k);
    else                     this._rerunKMeans(k);
  }

  /**
   * Führt K-Means für das aktuelle Szenario mit dem angegebenen k durch.
   * @param {number} k
   */
  _rerunKMeans(k) {
    this._currentK = k;
    try {
      const kmeans = new KMeans(this._currentScenario.datapoints, k);
      const steps  = kmeans.computeAllSteps();
      this._controls.setSteps(steps);
    } catch (err) {
      console.error('K-Means Fehler:', err.message);
    }
  }

  _rerunVQ(k) {
    this._currentK = k;
    try {
      const vq    = new VQ(this._currentScenario.datapoints, k, this._mapView.getMapBounds());
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

  /** Erzeugt eine Share-URL für das aktuelle Szenario + Algorithmus. */
  _buildShareUrl() {
    if (!this._currentScenario) return '';
    const params = new URLSearchParams();
    if (this._currentScenarioId) {
      params.set('id', this._currentScenarioId);
    } else {
      /* global pako */
      const json       = JSON.stringify(this._currentScenario);
      const compressed = pako.deflate(json);
      const b64        = btoa(String.fromCharCode(...compressed))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      params.set('scenario', b64);
    }
    params.set('algo', this._mode);
    params.set('k',    this._currentK);
    return `${location.origin}${location.pathname}?${params.toString()}`;
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

  _loadScenarioData(scenario, overrideK = null) {
    this._currentScenario   = scenario;
    this._currentScenarioId = null;
    this._currentK          = overrideK ?? scenario.k ?? 3;
    this._panel.setActiveScenario(scenario);
    if (scenario.location) this._mapView.setView(scenario.location);
    this._controls.setK(this._currentK);
    this._controls.setScenarioInfo(scenario.name ?? '', scenario.description ?? '');
    this._updateBanner();
    this._rerun(this._currentK);
  }

  // ── Szenario-Editor ──────────────────────────────────────────────────

  _toggleLog() {
    document.getElementById('app')?.classList.toggle('log--collapsed');
  }

  _toggleSettings() {
    this._panelEl.classList.toggle('panel--open');
  }

  _updateBanner() {
    if (!this._bannerEl || !this._currentScenario) return;
    const s = this._currentScenario;
    this._bannerEl.querySelector('#banner-name').textContent = s.name ?? '';
    this._bannerEl.querySelector('#banner-algo').textContent = this._mode === 'vq' ? 'VQ' : 'K-Means';
    this._bannerEl.querySelector('#banner-task').textContent = s.task ?? '';
    const descEl = this._bannerEl.querySelector('#banner-desc');
    descEl.textContent = s.description ?? '';
    descEl.hidden = true;
    const infoBtnEl = this._bannerEl.querySelector('#banner-info-btn');
    if (infoBtnEl) infoBtnEl.classList.remove('scenario-banner__info-btn--active');
    // Info-Button nur anzeigen wenn Beschreibung vorhanden
    if (infoBtnEl) infoBtnEl.hidden = !s.description;
  }

  _startEditor(scenario = null) {
    this._controls.setSteps([]);
    this._panelScenarioEl.style.display = 'none';
    this._panelEditorEl.style.cssText   = 'display:contents';
    this._editor = new ScenarioEditor(this._panelEditorEl, {
      scenario,
      onCancel:    () => this._stopEditor(),
      getGeoUri:   () => this._mapView.getViewGeoUri(),
      onClearAll:  () => this._mapView.clearVisualization(),
      onNavigate:  (lat, lng, zoom) => this._mapView.flyTo(lat, lng, zoom),
    });
    this._editor.onPointsChanged(pts => this._mapView.renderEditPoints(pts));
    this._mapView.enableEditMode((lat, lng) => this._editor.addPoint(lat, lng));
    this._editorMoveHandler = () => this._editor.updateGeoInfo();
    this._mapView.onMoveEnd(this._editorMoveHandler);
  }

  _stopEditor() {
    if (this._editorMoveHandler) {
      this._mapView.offMoveEnd(this._editorMoveHandler);
      this._editorMoveHandler = null;
    }
    this._mapView.disableEditMode();
    this._panelEditorEl.style.cssText   = 'display:none';
    this._panelScenarioEl.style.display = 'contents';
    this._editor = null;
    if (this._currentScenario) this._rerun(this._currentK);
  }
}
