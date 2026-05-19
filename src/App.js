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
      onNewScenario: ()       => this._startEditor(),
      onLoadFile:    scenario => this._loadScenarioData(scenario),
      onAlgoChange:  mode     => this._setMode(mode),
    });
    this._controls = new AnimationControls(controlsEl, {
      onStepChange:    (_index, step) => this._onStep(step),
      onKChange:       k             => this._rerun(k),
      onHeatmapToggle: v             => this._mapView.setHeatmapVisible(v),
      logContainer:    logEl ?? null,
    });

    this._currentScenario = null;
    this._currentK        = 3;
    this._mode            = 'vq';
    this._editor          = null;
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

    if (index.scenarios.length > 0) {
      await this._loadScenario(index.scenarios[0].id);
    }
  }

  /**
   * Lädt ein Szenario anhand seiner ID und aktualisiert Karte + Panel.
   * @param {string} id
   */
  async _loadScenario(id) {
    const scenario = await this._fetchJson(`./public/scenarios/${id}.json`);

    this._currentScenario = scenario;
    this._currentK        = scenario.k ?? 3;

    this._panel.setActiveScenario(scenario);
    this._mapView.setView(scenario.location);
    this._controls.setK(this._currentK);
    this._controls.setScenarioInfo(scenario.name ?? '', scenario.description ?? '');
    this._rerun(this._currentK);
  }

  /** Wechselt den Algorithmus und startet neu. */
  _setMode(mode) {
    this._mode = mode;
    if (this._currentScenario) this._rerun(this._currentK);
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
      const vq    = new VQ(this._currentScenario.datapoints, k);
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

  _loadScenarioData(scenario) {
    this._currentScenario = scenario;
    this._currentK        = scenario.k ?? 3;
    this._panel.setActiveScenario(scenario);
    if (scenario.location) this._mapView.setView(scenario.location);
    this._controls.setK(this._currentK);
    this._controls.setScenarioInfo(scenario.name ?? '', scenario.description ?? '');
    this._rerun(this._currentK);
  }

  // ── Szenario-Editor ──────────────────────────────────────────────────

  _startEditor() {
    this._controls.setSteps([]);
    this._panelScenarioEl.style.display = 'none';
    this._panelEditorEl.style.cssText   = 'display:contents';
    this._editor = new ScenarioEditor(this._panelEditorEl, {
      onCancel:    () => this._stopEditor(),
      getGeoUri:   () => this._mapView.getViewGeoUri(),
      onClearAll:  () => this._mapView.clearVisualization(),
      onNavigate:  (lat, lng, zoom) => this._mapView.flyTo(lat, lng, zoom),
    });
    this._editor.onPointsChanged(pts => this._mapView.renderEditPoints(pts));
    this._mapView.enableEditMode((lat, lng) => this._editor.addPoint(lat, lng));
  }

  _stopEditor() {
    this._mapView.disableEditMode();
    this._panelEditorEl.style.cssText   = 'display:none';
    this._panelScenarioEl.style.display = 'contents';
    this._editor = null;
    if (this._currentScenario) this._rerun(this._currentK);
  }
}
