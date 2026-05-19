/**
 * KMeans – berechnet alle Schritte des K-Means-Algorithmus und speichert
 * sie als Array, damit die Animation sie frei durchlaufen kann.
 *
 * Jeder Schritt enthält:
 *   type:             'init' | 'assign-point' | 'update' | 'converged'
 *   iteration:        Nummer der aktuellen Iteration
 *   description:      lesbarer Text für die Steuerleiste
 *   centroids:        Array<{ lat, lng }>  – aktuelle Zentren
 *   assignments:      number[]             – Cluster-Index je Datenpunkt (-1 = nicht zugewiesen)
 *   activePointIndex: number              – gerade zugewiesener Punkt (-1 = keiner)
 */
export class KMeans {
  /**
   * @param {Array<{x: number, y: number}>} points  x = Breitengrad, y = Längengrad
   * @param {number} k  Anzahl Cluster
   */
  constructor(points, k) {
    if (k < 1) throw new Error('k muss mindestens 1 sein.');
    if (k > points.length) throw new Error(`k (${k}) darf nicht größer als die Punktanzahl (${points.length}) sein.`);
    this._points = points;
    this._k = k;
  }

  /**
   * Führt den vollständigen K-Means-Algorithmus durch und gibt alle
   * Zwischenschritte zurück.
   * @returns {Array<object>}
   */
  computeAllSteps() {
    const steps = [];

    // ── Init: k zufällige Punkte als Startzentren (ohne Zurücklegen) ──────────
    const centroids = this._initCentroids();
    steps.push({
      type: 'init',
      iteration: 0,
      description: `K-Means gestartet: ${this._k} Startzentren zufällig aus den Datenpunkten gewählt.`,
      centroids: centroids.map(c => ({ ...c })),
      assignments: new Array(this._points.length).fill(-1),
      activePointIndex: -1,
    });

    let prevAssignments = [];
    const MAX_ITER = 100;

    for (let iter = 1; iter <= MAX_ITER; iter++) {
      // Vollständige Zuweisung vorab berechnen (für Konvergenzprüfung und Distanzangaben)
      const fullAssignments = this._assign(centroids);
      const converged       = this._assignmentsEqual(prevAssignments, fullAssignments);

      // ── Ein Schritt pro Datenpunkt ───────────────────────────────────────────
      for (let i = 0; i < this._points.length; i++) {
        const isLast   = i === this._points.length - 1;
        const nearest  = fullAssignments[i];
        const distKm   = this._distKm(
          this._points[i].x, this._points[i].y,
          centroids[nearest].lat, centroids[nearest].lng,
        );

        // Partielle Zuweisung: Punkte 0..i-1 bereits zugewiesen, Punkt i und Rest noch -1
        const partialBeforeI = fullAssignments
          .slice(0, i)
          .concat(new Array(this._points.length - i).fill(-1));

        // Sub-Schritte: Distanz zu jedem Clusterzentrum einzeln berechnen
        centroids.forEach((c, j) => {
          const dKm = this._distKm(
            this._points[i].x, this._points[i].y,
            c.lat, c.lng,
          );
          const isMin = j === nearest;
          steps.push({
            type: 'assign-point-distance',
            iteration: iter,
            description: `Iter. ${iter} · Punkt ${i + 1}: Distanz zu Zentrum ${j + 1} = ${dKm.toFixed(2)} km${isMin ? ' ← minimal' : ''}`,
            centroids: centroids.map(c => ({ ...c })),
            assignments: partialBeforeI,
            activePointIndex: i,
            activeCentroidIndex: j,
            distanceKm: dKm,
            nearestCentroidIndex: nearest,
          });
        });

        // Partielle Zuweisung: Punkte 0..i bereits zugewiesen, Rest noch -1
        const partialAssignments = fullAssignments
          .slice(0, i + 1)
          .concat(new Array(this._points.length - i - 1).fill(-1));

        steps.push({
          type: (converged && isLast) ? 'converged' : 'assign-point',
          iteration: iter,
          description: (converged && isLast)
            ? `Konvergenz nach ${iter - 1} Iteration(en). Clustering abgeschlossen.`
            : `Iter. ${iter} · Punkt ${i + 1}: → Cluster ${nearest + 1}  (${distKm.toFixed(2)} km, minimal)`,
          centroids: centroids.map(c => ({ ...c })),
          assignments: partialAssignments,
          activePointIndex: (converged && isLast) ? -1 : i,
          nearestCentroidIndex: nearest,
        });
      }

      if (converged) break;
      prevAssignments = fullAssignments;

      // ── Aktualisierungsschritt ───────────────────────────────────────────────
      const oldCentroids = centroids.map(c => ({ ...c }));
      const updated      = this._updateCentroids(fullAssignments);

      // Interpolations-Teilschritte: Zentren gleiten von alt nach neu
      const INTERP_STEPS = 8;
      for (let s = 1; s <= INTERP_STEPS; s++) {
        const t = s / INTERP_STEPS;
        const interp = oldCentroids.map((old, ci) => ({
          lat: old.lat + (updated[ci].lat - old.lat) * t,
          lng: old.lng + (updated[ci].lng - old.lng) * t,
        }));
        steps.push({
          type: 'update-move',
          iteration: iter,
          description: `Iteration ${iter}: Clusterzentren werden auf Schwerpunkte verschoben…`,
          centroids: interp,
          assignments: [...fullAssignments],
          activePointIndex: -1,
          oldCentroids: oldCentroids.map(c => ({ ...c })),
          newCentroids: updated.map(c => ({ ...c })),
        });
      }

      centroids.splice(0, centroids.length, ...updated);

      steps.push({
        type: 'update',
        iteration: iter,
        description: `Iteration ${iter}: Clusterzentren auf den Schwerpunkt der zugewiesenen Punkte verschoben.`,
        centroids: centroids.map(c => ({ ...c })),
        assignments: [...fullAssignments],
        activePointIndex: -1,
      });
    }

    return steps;
  }

  // ── Private Hilfsmethoden ────────────────────────────────────────────────────

  _initCentroids() {
    const indices = [...Array(this._points.length).keys()]
      .sort(() => Math.random() - 0.5)
      .slice(0, this._k);
    return indices.map(i => ({ lat: this._points[i].x, lng: this._points[i].y }));
  }

  _assign(centroids) {
    return this._points.map(p => {
      let minDist = Infinity;
      let nearest = 0;
      centroids.forEach((c, i) => {
        const d = this._dist(p.x, p.y, c.lat, c.lng);
        if (d < minDist) { minDist = d; nearest = i; }
      });
      return nearest;
    });
  }

  _updateCentroids(assignments) {
    return Array.from({ length: this._k }, (_, i) => {
      const assigned = this._points.filter((_, idx) => assignments[idx] === i);
      if (assigned.length === 0) {
        // Leeres Cluster: Fallback auf zufälligen Datenpunkt
        const p = this._points[Math.floor(Math.random() * this._points.length)];
        return { lat: p.x, lng: p.y };
      }
      return {
        lat: assigned.reduce((s, p) => s + p.x, 0) / assigned.length,
        lng: assigned.reduce((s, p) => s + p.y, 0) / assigned.length,
      };
    });
  }

  /** Euklidische Distanz in Grad (intern für Nearest-Neighbour-Vergleich). */
  _dist(lat1, lng1, lat2, lng2) {
    return Math.sqrt((lat1 - lat2) ** 2 + (lng1 - lng2) ** 2);
  }

  /** Näherungsweise Distanz in Kilometern (Flacherde, ausreichend für kleine Gebiete). */
  _distKm(lat1, lng1, lat2, lng2) {
    const dLat = (lat1 - lat2) * 111.32;
    const dLng = (lng1 - lng2) * 111.32 * Math.cos(lat1 * Math.PI / 180);
    return Math.sqrt(dLat * dLat + dLng * dLng);
  }

  _assignmentsEqual(a, b) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }
}
