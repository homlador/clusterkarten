/**
 * VQ – Vector Quantization (Online-Lernvariante)
 *
 * Schritte:
 *   1. k Prototypen zufällig an Datenpunkten initialisieren
 *   2. Für jeden Datenpunkt:
 *      a. Nächsten Prototypen bestimmen  → Typ 'vq-nearest'
 *      b. Prototypen um die Hälfte der Distanz bewegen (mit Interpolation) → Typ 'vq-move'
 *   3. Fertig → Typ 'vq-done'
 */

const INTERP_STEPS = 6;

export class VQ {
  /**
   * @param {Array<{x: number, y: number}>} points  x = Breitengrad, y = Längengrad
   * @param {number} k  Anzahl Prototypen
   */
  constructor(points, k, bounds = null) {
    if (k < 1) throw new Error('k muss mindestens 1 sein.');
    if (k > points.length) throw new Error(
      `k (${k}) darf nicht größer als die Punktanzahl (${points.length}) sein.`
    );
    this._points = points;
    this._k      = k;
    this._bounds = bounds; // { south, north, west, east } oder null
  }

  /**
   * Führt den vollständigen VQ-Algorithmus durch und gibt alle Zwischenschritte zurück.
   * @returns {Array<object>}
   */
  computeAllSteps() {
    const steps = [];
    const n = this._points.length;
    const allIndices = [...Array(n).keys()];

    // k Prototypen initialisieren: zufällig auf der Karte (falls Grenzen bekannt), sonst an Datenpunkten
    let prototypes;
    if (this._bounds) {
      const { south, north, west, east } = this._bounds;
      prototypes = Array.from({ length: this._k }, () => ({
        lat: south + Math.random() * (north - south),
        lng: west  + Math.random() * (east  - west),
      }));
    } else {
      const shuffledInit = [...allIndices].sort(() => Math.random() - 0.5);
      prototypes = shuffledInit.slice(0, this._k)
        .map(i => ({ lat: this._points[i].x, lng: this._points[i].y }));
    }

    steps.push({
      type:              'vq-init',
      description:       `${this._k} Prototypen zufällig initialisiert`,
      prototypes:        prototypes.map(p => ({ ...p })),
      activePointIndex:  -1,
      nearestProtoIndex: -1,
      processedIndices:  [],
    });

    // Datenpunkte in zufälliger Reihenfolge verarbeiten
    const order            = [...allIndices].sort(() => Math.random() - 0.5);
    const processedIndices = [];

    for (const i of order) {
      const pt = this._points[i];

      // Distanz zu jedem Prototypen messen und einzeln als Schritt speichern
      let nearest = 0;
      let minDist = Infinity;
      for (let j = 0; j < prototypes.length; j++) {
        const d = this._distKm(pt.x, pt.y, prototypes[j].lat, prototypes[j].lng);
        if (d < minDist) { minDist = d; nearest = j; }
        steps.push({
          type:               'vq-distance',
          description:        `Punkt ${i + 1}: Abstand zu Prototyp ${j + 1}: ${d.toFixed(2)} km`,
          prototypes:         prototypes.map(p => ({ ...p })),
          activePointIndex:   i,
          measuredProtoIndex: j,
          nearestSoFar:       nearest,
          processedIndices:   [...processedIndices],
        });
      }

      steps.push({
        type:              'vq-nearest',
        description:       `Punkt ${i + 1}: nächster Prototyp ist ${nearest + 1} (${minDist.toFixed(2)} km)`,
        prototypes:        prototypes.map(p => ({ ...p })),
        activePointIndex:  i,
        nearestProtoIndex: nearest,
        processedIndices:  [...processedIndices],
      });

      // Neue Position: halbe Distanz zum Datenpunkt
      const oldPos = { ...prototypes[nearest] };
      const newLat = oldPos.lat + (pt.x - oldPos.lat) * 0.5;
      const newLng = oldPos.lng + (pt.y - oldPos.lng) * 0.5;

      // Interpolationsschritte für flüssige Animation
      for (let s = 1; s <= INTERP_STEPS; s++) {
        const t      = s / INTERP_STEPS;
        const interp = prototypes.map((pr, j) =>
          j === nearest
            ? { lat: oldPos.lat + (newLat - oldPos.lat) * t,
                lng: oldPos.lng + (newLng - oldPos.lng) * t }
            : { ...pr }
        );
        steps.push({
          type:              'vq-move',
          description:       `${i + 1}: Prototyp ${nearest + 1} zur Hälfte des Abstands`,
          prototypes:        interp,
          activePointIndex:  i,
          nearestProtoIndex: nearest,
          processedIndices:  [...processedIndices],
          oldProtoPos:       oldPos,
        });
      }

      // Punkt gilt jetzt als verarbeitet
      processedIndices.push(i);
      prototypes[nearest] = { lat: newLat, lng: newLng };
    }

    steps.push({
      type:              'vq-done',
      description:       'VQ abgeschlossen. Alle Datenpunkte verarbeitet.',
      prototypes:        prototypes.map(p => ({ ...p })),
      activePointIndex:  -1,
      nearestProtoIndex: -1,
      processedIndices:  [...allIndices],
    });

    return steps;
  }

  /** Näherungsweise Distanz in Kilometern (Flacherde). */
  _distKm(lat1, lng1, lat2, lng2) {
    const dLat = (lat1 - lat2) * 111.32;
    const dLng = (lng1 - lng2) * 111.32 * Math.cos(lat1 * Math.PI / 180);
    return Math.sqrt(dLat * dLat + dLng * dLng);
  }
}
