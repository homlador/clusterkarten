/**
 * ScenarioPanel – rendert die Seitenleiste mit Szenario-Auswahl,
 * Name und Beschreibung des aktiven Szenarios.
 */
export class ScenarioPanel {
  /**
   * @param {HTMLElement} container  Das DOM-Element für die Sidebar
   * @param {function(string): void} onSelect  Callback mit der gewählten Szenario-ID
   */
  constructor(container, { onSelect, onNewScenario, onCreateScenario, onLoadFile, onAlgoChange, onCopyUrl, onClose,
                            onShowDistChange, onShowAssignChange, onHeatmapChange }) {
    this._container            = container;
    this._onSelect             = onSelect;
    this._onNewScenario        = onNewScenario;
    this._onCreateScenario     = onCreateScenario     ?? (() => {});
    this._onLoadFile           = onLoadFile;
    this._onAlgoChange       = onAlgoChange       ?? (() => {});
    this._onCopyUrl          = onCopyUrl          ?? (() => '');
    this._onClose            = onClose            ?? (() => {});
    this._onShowDistChange   = onShowDistChange   ?? (() => {});
    this._onShowAssignChange = onShowAssignChange ?? (() => {});
    this._onHeatmapChange    = onHeatmapChange    ?? (() => {});
    this._currentScenario    = null;
    this._render();
  }

  _render() {
    this._container.innerHTML = `
      <div class="panel__header">
        <span class="panel__title">Einstellungen</span>
        <button id="btn-panel-close" class="panel__close-btn" title="Panel schließen">▶</button>
      </div>
      <div class="panel__section">
        <label class="panel__label" for="scenario-select">Szenario</label>
        <select class="panel__select" id="scenario-select"></select>
      </div>
      <div class="panel__section panel__info" id="scenario-info">
        <p class="panel__info-placeholder">Lade Szenarien …</p>
      </div>
      
      <div class="panel__section">
        <label class="panel__label">Algorithmus</label>
        <div class="panel__algo-selector">
          <label class="panel__algo-label">
            <input type="radio" name="algo" value="kmeans" /> K-Means
          </label>
          <label class="panel__algo-label">
            <input type="radio" name="algo" value="vq" checked /> VQ
          </label>
        </div>
      </div>

      <div class="panel__section">
        <label class="panel__label">Ansicht</label>
        <label class="panel__check-label" title="Distanzmessungs-Schritte anzeigen">
          <input type="checkbox" id="show-dist" checked />
          Distanzmessungen
        </label>
        <label class="panel__check-label" title="Zuweisungs-Schritte anzeigen">
          <input type="checkbox" id="show-assign" checked />
          Zuweisungen
        </label>
        <label class="panel__check-label" title="Voronoi-Heatmap der Clusterbereiche anzeigen">
          <input type="checkbox" id="show-heatmap" />
          Heatmap
        </label>
      </div>  

      <div class="panel__section panel__section--actions">
        <button id="btn-new-scenario" class="panel__btn-action">
          Szenario editieren
        </button>
        <input type="file" id="scenario-file-input" accept=".json" style="display:none" />
        <button id="btn-load-scenario" class="panel__btn-action">
          Szenario aus JSON laden
        </button>
        <button id="btn-download-json" class="panel__btn-action" disabled>
          Szenario als JSON herunterladen
        </button>
        <button id="btn-copy-url" class="panel__btn-action">Szenario als 🔗 URL speichern</button>
        <span id="copy-url-feedback" class="panel__copy-feedback" hidden>✓ Kopiert!</span>        
      </div>

    `;

    this._select = this._container.querySelector('#scenario-select');
    this._info   = this._container.querySelector('#scenario-info');

    this._container.querySelector('#btn-panel-close')
      .addEventListener('click', () => this._onClose());

    this._select.addEventListener('change', () => {
      this._onSelect(this._select.value);
    });

    this._container.querySelector('#btn-new-scenario')
      .addEventListener('click', () => this._onNewScenario());

    this._container.querySelectorAll('input[name="algo"]').forEach(radio => {
      radio.addEventListener('change', () => {
        if (radio.checked) this._onAlgoChange(radio.value);
      });
    });

    const fileInput = this._container.querySelector('#scenario-file-input');
    this._container.querySelector('#btn-load-scenario')
      .addEventListener('click', () => fileInput.click());

    this._showDistCb   = this._container.querySelector('#show-dist');
    this._showAssignCb = this._container.querySelector('#show-assign');
    this._showHeatmapCb = this._container.querySelector('#show-heatmap');

    this._showDistCb.addEventListener('change',    () => this._onShowDistChange(this._showDistCb.checked));
    this._showAssignCb.addEventListener('change',  () => this._onShowAssignChange(this._showAssignCb.checked));
    this._showHeatmapCb.addEventListener('change', () => this._onHeatmapChange(this._showHeatmapCb.checked));

    this._downloadBtn = this._container.querySelector('#btn-download-json');
    this._downloadBtn.addEventListener('click', () => {
      if (!this._currentScenario) return;
      const json = JSON.stringify(this._currentScenario, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `${this._currentScenario.name ?? 'szenario'}.json`;
      a.click();
      URL.revokeObjectURL(url);
    });

    const copyBtn      = this._container.querySelector('#btn-copy-url');
    const copyFeedback = this._container.querySelector('#copy-url-feedback');
    copyBtn.addEventListener('click', async () => {
      const url = this._onCopyUrl();
      if (!url) return;
      try {
        await navigator.clipboard.writeText(url);
        copyFeedback.hidden = false;
        setTimeout(() => { copyFeedback.hidden = true; }, 2000);
      } catch {
        prompt('URL kopieren:', url);
      }
    });
    fileInput.addEventListener('change', () => {
      const file = fileInput.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = e => {
        try {
          const scenario = JSON.parse(e.target.result);
          this._onLoadFile(scenario);
        } catch {
          alert('Ungültige JSON-Datei.');
        }
      };
      reader.readAsText(file);
      fileInput.value = '';
    });
  }

  /**
   * Befüllt das Dropdown mit einer Liste von Szenario-Einträgen.
   * @param {Array<{ id: string, name: string }>} items
   */
  setScenarioList(items) {
    this._select.innerHTML = items
      .map(item => `<option value="${item.id}">${item.name}</option>`)
      .join('');
  }

  /**
   * Zeigt Name, Beschreibung und Datenpunkt-Anzahl des aktiven Szenarios.
   * @param {{ name: string, description: string, datapoints: Array }} scenario
   */
  /** Setzt den Algorithmus-Radio-Button von außen. */
  setAlgo(algo) {
    const radio = this._container.querySelector(`input[name="algo"][value="${algo}"]`);
    if (radio) radio.checked = true;
  }

  setShowDist(v)    { if (this._showDistCb)    this._showDistCb.checked    = v; }
  setShowAssign(v)  { if (this._showAssignCb)  this._showAssignCb.checked  = v; }
  setShowHeatmap(v) { if (this._showHeatmapCb) this._showHeatmapCb.checked = v; }

  setActiveScenario(scenario) {
    this._currentScenario = scenario;
    if (this._downloadBtn) this._downloadBtn.disabled = false;
    this._info.innerHTML = `
      <h2 class="panel__scenario-name">${scenario.name}</h2>
      <p class="panel__scenario-desc">${scenario.description}</p>
      <p class="panel__scenario-meta">${scenario.datapoints.length} Datenpunkt(e) <br/><code>${scenario.location}</code></p>
    `;
  }
}
