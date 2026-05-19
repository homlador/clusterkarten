/**
 * ScenarioPanel – rendert die Seitenleiste mit Szenario-Auswahl,
 * Name und Beschreibung des aktiven Szenarios.
 */
export class ScenarioPanel {
  /**
   * @param {HTMLElement} container  Das DOM-Element für die Sidebar
   * @param {function(string): void} onSelect  Callback mit der gewählten Szenario-ID
   */
  constructor(container, { onSelect, onNewScenario, onLoadFile, onAlgoChange, onCopyUrl, onClose }) {
    this._container      = container;
    this._onSelect       = onSelect;
    this._onNewScenario  = onNewScenario;
    this._onLoadFile     = onLoadFile;
    this._onAlgoChange   = onAlgoChange ?? (() => {});
    this._onCopyUrl      = onCopyUrl    ?? (() => '');
    this._onClose        = onClose      ?? (() => {});
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

      <div class="panel__section panel__section--actions">
        <input type="file" id="scenario-file-input" accept=".json" style="display:none" />
        <button id="btn-load-scenario" class="panel__btn-action">
          📂 Szenario laden
        </button>
        <button id="btn-new-scenario" class="panel__btn-new">
          Szenario editieren
        </button>
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
        <button id="btn-copy-url" class="panel__btn-action">🔗 URL kopieren</button>
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

  setActiveScenario(scenario) {
    this._info.innerHTML = `
      <h2 class="panel__scenario-name">${scenario.name}</h2>
      <p class="panel__scenario-desc">${scenario.description}</p>
      <p class="panel__scenario-meta">${scenario.datapoints.length} Datenpunkt(e) · <code>${scenario.location}</code></p>
    `;
  }
}
