/**
 * Scenario – hält alle Daten eines Szenarios und bietet Methoden
 * zum Laden und Speichern als JSON sowie per URL.
 */

/** @param {*} val @returns {boolean|null} */
function parseBoolFlag(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === 'boolean') return val;
  if (val === '1' || val === 1) return true;
  if (val === '0' || val === 0) return false;
  return null;
}

export class Scenario {

  constructor({
    name        = '',
    description = '',
    task        = '',
    location    = '',
    k           = 3,
    algo        = 'vq',
    showDist    = true,
    showAssign  = true,
    showHeatmap = false,
    datapoints  = [],
  } = {}) {
    this.name        = name;
    this.description = description;
    this.task        = task;
    this.location    = location;
    this.k           = k;
    this.algo        = algo;
    this.showDist    = showDist;
    this.showAssign  = showAssign;
    this.showHeatmap = showHeatmap;
    this.datapoints  = datapoints.map(p => ({ ...p }));
  }

  /**
   * Erstellt ein Scenario aus einem rohen JSON-Objekt.
   * Verarbeitet String-Flags ("1"/"0") und fehlende Felder mit sinnvollen Defaults.
   * @param {object} obj
   * @returns {Scenario}
   */
  static fromJSON(obj) {
    const showDist    = parseBoolFlag(obj.dist);
    const showAssign  = parseBoolFlag(obj.assign);
    const showHeatmap = parseBoolFlag(obj.heatmap);
    return new Scenario({
      name:        obj.name        ?? '',
      description: obj.description ?? '',
      task:        obj.task        ?? '',
      location:    obj.location    ?? '',
      k:           (typeof obj.k === 'number' && obj.k >= 1) ? obj.k : 3,
      algo:        (obj.algo === 'vq' || obj.algo === 'kmeans') ? obj.algo : 'vq',
      showDist:    showDist    ?? true,
      showAssign:  showAssign  ?? true,
      showHeatmap: showHeatmap ?? false,
      datapoints:  Array.isArray(obj.datapoints) ? obj.datapoints : [],
    });
  }

  /**
   * Dekodiert ein pako+base64url-kodiertes Szenario aus dem URL-Parameter „scenario".
   * @param {string} encoded
   * @returns {Scenario}
   */
  static fromPakoEncoded(encoded) {
    const b64    = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const binary = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const json   = /* global pako */ pako.inflate(binary, { to: 'string' });
    return Scenario.fromJSON(JSON.parse(json));
  }

  /**
   * Überschreibt Felder aus URL-Parametern (algo, k, dist, assign, heatmap).
   * Felder, die im Query-String fehlen, bleiben unverändert.
   * @param {string} searchString  z. B. `"?algo=vq&k=3&dist=1"`
   */
  applyUrlParams(searchString) {
    const p = new URLSearchParams(searchString);
    if (p.has('algo') && (p.get('algo') === 'vq' || p.get('algo') === 'kmeans'))
      this.algo = p.get('algo');
    const rawK = parseInt(p.get('k') ?? '', 10);
    if (!isNaN(rawK) && rawK >= 1) this.k = rawK;
    if (p.has('dist'))    this.showDist    = p.get('dist')    !== '0';
    if (p.has('assign'))  this.showAssign  = p.get('assign')  !== '0';
    if (p.has('heatmap')) this.showHeatmap = p.get('heatmap') !== '0';
  }

  /**
   * Serialisiert das Szenario als rohe JSON-Struktur
   * (kompatibel mit dem Dateiformat in public/scenarios/).
   * @returns {object}
   */
  toJSON() {
    const obj = {
      name:        this.name,
      description: this.description,
      location:    this.location,
      k:           this.k,
      algo:        this.algo,
      dist:        this.showDist    ? '1' : '0',
      assign:      this.showAssign  ? '1' : '0',
      heatmap:     this.showHeatmap ? '1' : '0',
      datapoints:  this.datapoints.map(p => ({ ...p })),
    };
    if (this.task) obj.task = this.task;
    return obj;
  }

  /**
   * Erstellt eine vollständige Share-URL für dieses Szenario (pako-kodiert).
   * @returns {string}
   */
  shareUrl() {
    const json       = JSON.stringify(this.toJSON());
    const compressed = /* global pako */ pako.deflate(json);
    const encoded    = btoa(String.fromCharCode(...compressed))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const params = new URLSearchParams({ scenario: encoded });
    return `${location.origin}${location.pathname}?${params.toString()}`;
  }

  /**
   * Löst einen Browser-Download des Szenarios als JSON-Datei aus.
   */
  downloadJSON() {
    const json = JSON.stringify(this.toJSON(), null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), {
      href: url, download: `${this.name || 'szenario'}.json`,
    });
    a.click();
    URL.revokeObjectURL(url);
  }
}
