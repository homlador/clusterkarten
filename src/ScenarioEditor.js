/**
 * ScenarioEditor – Seitenleisten-UI zum interaktiven Erstellen neuer Szenarien.
 */
export class ScenarioEditor {
  /**
   * @param {HTMLElement} container
   * @param {{ onCancel: () => void, getGeoUri: () => string, onClearAll: () => void, onNavigate: (lat: number, lng: number, zoom: number) => void, scenario: import('./Scenario.js').Scenario }} options
   */
  constructor(container, { onCancel, getGeoUri, onClearAll, onNavigate, onSave, scenario }) {
    this._container       = container;
    this._onCancel        = onCancel;
    this._getGeoUri       = getGeoUri;
    this._onClearAll      = onClearAll ?? (() => {});
    this._onNavigate      = onNavigate ?? (() => {});
    this._onSave          = onSave     ?? (() => {});
    this._scenario        = scenario;
    this._onPointsChanged = null;
    this._render();
  }

  /**
   * Fügt einen Datenpunkt per Kartenklick hinzu.
   * @param {number} lat
   * @param {number} lng
   */
  addPoint(lat, lng) {
    this._scenario.datapoints.push({ x: +lat.toFixed(6), y: +lng.toFixed(6) });
    this._updatePointList();
  }

  /**
   * Registriert einen Callback für Punktänderungen (Hinzufügen / Löschen).
   * @param {(points: Array<{x:number,y:number}>) => void} cb
   */
  onPointsChanged(cb) {
    this._onPointsChanged = cb;
  }

  // ── Rendering ────────────────────────────────────────────────────────────────

  _render() {
    const geoText = this._formatGeoUri(this._getGeoUri());

    this._container.innerHTML = `
      <div class="panel__header editor__header">
        <button id="editor-back" class="editor__back-btn">← Zurück</button>
        <h1 class="panel__title">Szenario-Editor</h1>
      </div>

      <div class="panel__section">
        <label class="panel__label" for="editor-search">Karte navigieren</label>
        <div class="editor__search-row">
          <input type="text" id="editor-search" class="editor__input"
                 placeholder='Ortsname oder "51.5, 6.7"' />
          <button id="editor-search-btn" class="editor__search-btn">Suchen</button>
        </div>
        <p id="editor-search-status" class="editor__search-status"></p>
        <p id="editor-geo-info" class="editor__search-status" style="color:var(--color-muted);margin-top:.25rem">${geoText}</p>
      </div>

      <div class="panel__section">
        <div class="editor__points-header">
          <span class="panel__label">
            Datenpunkte&thinsp;(<span id="editor-count">0</span>)
          </span>
          <button id="editor-clear" class="editor__btn-sm">Alle löschen</button>
        </div>
        <ul id="editor-point-list" class="editor__point-list"></ul>
        <p class="editor__hint">Auf die Karte klicken, um Punkte hinzuzufügen.</p>
      </div>
    `;

    this._countEl        = this._container.querySelector('#editor-count');
    this._listEl         = this._container.querySelector('#editor-point-list');
    this._searchInput    = this._container.querySelector('#editor-search');
    this._searchStatus   = this._container.querySelector('#editor-search-status');
    this._geoInfoEl      = this._container.querySelector('#editor-geo-info');

    this._container.querySelector('#editor-back')
      .addEventListener('click', () => this._onCancel());

    this._container.querySelector('#editor-search-btn')
      .addEventListener('click', () => this._onSearch());
    this._searchInput
      .addEventListener('keydown', e => { if (e.key === 'Enter') this._onSearch(); });

    this._container.querySelector('#editor-clear')
      .addEventListener('click', () => {
        this._scenario.datapoints = [];
        this._updatePointList();
        this._onClearAll();
      });

    this._updatePointList();
  }

  _updatePointList() {
    this._countEl.textContent  = this._scenario.datapoints.length;

    this._listEl.innerHTML = this._scenario.datapoints
      .map((p, i) => `
        <li class="editor__point-item">
          <span class="editor__point-num">${i + 1}</span>
          <span class="editor__point-coords">${p.x.toFixed(5)}, ${p.y.toFixed(5)}</span>
          <button class="editor__point-del" data-index="${i}" title="Entfernen">✕</button>
        </li>
      `).join('');

    this._listEl.querySelectorAll('.editor__point-del').forEach(btn => {
      btn.addEventListener('click', e => {
        const idx = parseInt(e.currentTarget.dataset.index, 10);
        this._scenario.datapoints.splice(idx, 1);
        this._updatePointList();
      });
    });

    if (this._onPointsChanged) this._onPointsChanged([...this._scenario.datapoints]);
  }

  async _onSearch() {
    const query = this._searchInput.value.trim();
    if (!query) return;

    // Koordinaten erkennen: "51.5, 6.7" oder "51.5 6.7"
    const coordMatch = query.match(/^(-?\d+(?:\.\d+)?)[,\s]+(-?\d+(?:\.\d+)?)$/);
    if (coordMatch) {
      const lat = parseFloat(coordMatch[1]);
      const lng = parseFloat(coordMatch[2]);
      if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
        this._onNavigate(lat, lng, 14);
        this._setSearchStatus('');
        return;
      }
    }

    // Nominatim-Geocoding
    this._setSearchStatus('Suche läuft\u2026');
    try {
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`;
      const res  = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data.length) {
        this._setSearchStatus('Kein Ergebnis gefunden.');
        return;
      }
      const { lat, lon, display_name } = data[0];
      this._onNavigate(parseFloat(lat), parseFloat(lon), 13);
      this._setSearchStatus(display_name.split(',').slice(0, 2).join(', '));
    } catch (_err) {
      this._setSearchStatus('Fehler bei der Suche.');
    }
  }

  _setSearchStatus(text) {
    this._searchStatus.textContent = text;
  }

  /** Aktualisiert die Geo-Anzeige sofort mit der aktuellen Kartenposition. */
  updateGeoInfo() {
    if (this._geoInfoEl) {
      this._geoInfoEl.textContent = this._formatGeoUri(this._getGeoUri());
    }
  }

  /** Aktualisiert die Geo-Anzeige nach einer Kartennavigation (mit kurzer Verzögerung). */
  _refreshGeoInfo() {
    setTimeout(() => this.updateGeoInfo(), 600);
  }

  /** Wandelt einen GEO-URI in lesbaren Text um. */
  _formatGeoUri(uri) {
    const m = uri.match(/^geo:([+-]?[\d.]+),([+-]?[\d.]+)(?:\?z=(\d+))?/);
    if (!m) return uri;
    return `\u{1F4CD} ${m[1]}, ${m[2]}  ·  Zoom\u00a0${m[3] ?? 13}`;
  }

  /** Escaped HTML-Sonderzeichen für Attribut-/Inhalt-Einbettungen. */
  _esc(str) {
    return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  /** Gibt eine Referenz auf die aktuellen Datenpunkte zurück. */
  getPoints() {
    return this._scenario.datapoints;
  }
}
