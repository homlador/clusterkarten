import { GeoUri } from './utils/GeoUri.js';

/* global L */

/** Farben für bis zu 10 Cluster */
const CLUSTER_COLORS = [
  '#e74c3c', '#3498db', '#2ecc71', '#f39c12',
  '#9b59b6', '#1abc9c', '#e67e22', '#e91e63',
  '#00bcd4', '#8bc34a',
];

const UNASSIGNED_COLOR = '#888888';

function hexToRgb(hex) {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

/**
 * MapView – kapselt die Leaflet-Karte und die Cluster-Visualisierung.
 */
export class MapView {
  /**
   * @param {HTMLElement} container
   */
  constructor(container) {
    this._map = L.map(container);

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(this._map);

    // Drei separate Layer, damit die Z-Reihenfolge stimmt:
    // Linien → Datenpunkte → Zentren
    this._lineLayer        = L.layerGroup().addTo(this._map);
    this._pointLayer       = L.layerGroup().addTo(this._map);
    this._centroidLayer    = L.layerGroup().addTo(this._map);
    // Eigener Layer für den Szenario-Editor (liegt oben)
    this._editLayer        = L.layerGroup().addTo(this._map);
    this._editClickHandler = null;

    // Heatmap-Pane (zwischen Kacheln und Overlays)
    this._map.createPane('heatmapPane');
    this._map.getPane('heatmapPane').style.zIndex       = '250';
    this._map.getPane('heatmapPane').style.pointerEvents = 'none';
    this._heatVisible    = false;
    this._heatOverlay    = null;
    this._lastCentroids  = [];
    this._lastDatapoints = [];
  }

  /**
   * Setzt die Kartenansicht anhand eines GEO-URI.
   * @param {string} geoUri  z.B. "geo:51.56018,6.71694?z=14"
   */
  setView(geoUri) {
    const { lat, lng, zoom } = GeoUri.parse(geoUri);
    this._map.setView([lat, lng], zoom);
  }

  /**
   * Fliegt sanft zu gegebenen Koordinaten (z.B. nach Suchanfrage).
   * @param {number} lat
   * @param {number} lng
   * @param {number} [zoom=13]
   */
  flyTo(lat, lng, zoom = 13) {
    this._map.flyTo([lat, lng], zoom);
  }

  /**
   * Registriert einen Callback für jede abgeschlossene Kartenbewegung.
   * @param {() => void} cb
   */
  onMoveEnd(cb) {
    this._map.on('moveend', cb);
  }

  /**
   * Entfernt einen zuvor registrierten moveend-Callback.
   * @param {() => void} cb
   */
  offMoveEnd(cb) {
    this._map.off('moveend', cb);
  }

  /**
   * Rendert einen K-Means-Schritt auf der Karte:
   *   – gestrichelte farbige Linien von jedem Punkt zu seinem Zentrum
   *   – farbige CircleMarker für Datenpunkte (Farbe = Cluster)
   *   – Diamant-förmige DivIcon-Marker für Clusterzentren
   *
   * @param {object} step        Ein Schritt-Objekt aus KMeans.computeAllSteps()
   * @param {Array<{x:number,y:number}>} datapoints
   */
  renderClusterStep(step, datapoints) {
    this._lineLayer.clearLayers();
    this._pointLayer.clearLayers();
    this._centroidLayer.clearLayers();

    const { centroids, assignments, activePointIndex = -1, type } = step;
    const hasActivePoint = activePointIndex >= 0;
    const isDistStep     = type === 'assign-point-distance';

    // 1. Verbindungslinien (zuerst, damit sie unter den Markern liegen)
    datapoints.forEach(({ x, y }, idx) => {
      const ci = assignments[idx];
      if (ci === -1) return;
      const color    = CLUSTER_COLORS[ci % CLUSTER_COLORS.length];
      const isActive = hasActivePoint && idx === activePointIndex;
      L.polyline([[x, y], [centroids[ci].lat, centroids[ci].lng]], {
        color,
        weight:    isActive ? 2.5 : 1.5,
        opacity:   isActive ? 0.9 : 0.55,
        dashArray: isActive ? null : '5 5',
      }).addTo(this._lineLayer);
    });

    // Für Distanz-Teilschritte: Mess-Linien vom aktiven Punkt zu allen bisher gemessenen Zentren
    if (isDistStep && hasActivePoint) {
      const { activeCentroidIndex, nearestCentroidIndex } = step;
      const p = datapoints[activePointIndex];
      for (let j = 0; j <= activeCentroidIndex; j++) {
        const c         = centroids[j];
        const isCurrent = j === activeCentroidIndex;
        L.polyline([[p.x, p.y], [c.lat, c.lng]], {
          color:     isCurrent ? '#f1c40f' : '#aaaaaa',
          weight:    isCurrent ? 3 : 1.5,
          opacity:   isCurrent ? 1.0 : 0.45,
          dashArray: '8 4',
        }).addTo(this._lineLayer);
      }
    }

    // 2. Datenpunkte als CircleMarker
    datapoints.forEach(({ x, y }, idx) => {
      const ci           = assignments[idx];
      const isActive     = hasActivePoint && idx === activePointIndex;
      // Noch nicht verarbeitete Punkte (hinter dem aktiven) erscheinen blasser
      const isPending    = hasActivePoint && idx > activePointIndex;
      const color        = ci === -1 ? UNASSIGNED_COLOR : CLUSTER_COLORS[ci % CLUSTER_COLORS.length];
      L.circleMarker([x, y], {
        radius:      isActive ? 13 : 9,
        color:       '#1a1a2e',
        weight:      isActive ? 3 : 2,
        fillColor:   color,
        fillOpacity: isPending ? 0.25 : (ci === -1 ? 0.5 : 1.0),
      })
        .bindPopup(`<b>Punkt ${idx + 1}</b><br>Lat: ${x}<br>Lng: ${y}<br>Cluster: ${ci === -1 ? '–' : ci + 1}`)
        .addTo(this._pointLayer);
    });

    const isMoveStep = type === 'update-move';

    // 3. Clusterzentren als Diamant-Icon
    centroids.forEach((c, i) => {
      const color            = CLUSTER_COLORS[i % CLUSTER_COLORS.length];
      const isActiveCentroid = false;
      const size             = 26;
      const icon  = L.divIcon({
        className: '',
        html: `<div class="centroid-marker${isMoveStep ? ' centroid-marker--moving' : ''}" style="background:${color}"></div>`,
        iconSize:   [size, size],
        iconAnchor: [size / 2, size / 2],
      });
      L.marker([c.lat, c.lng], { icon, zIndexOffset: 1000 })
        .bindPopup(`<b>Zentrum ${i + 1}</b><br>Lat: ${c.lat.toFixed(5)}<br>Lng: ${c.lng.toFixed(5)}`)
        .addTo(this._centroidLayer);
    });

    // Bei update-move: alte Positionen (blass) + Bewegungslinie anzeigen
    if (isMoveStep && step.oldCentroids) {
      step.oldCentroids.forEach((old, i) => {
        const color   = CLUSTER_COLORS[i % CLUSTER_COLORS.length];
        const current = centroids[i];

        // Linie von alter zu aktueller Position
        L.polyline([[old.lat, old.lng], [current.lat, current.lng]], {
          color,
          weight:  3,
          opacity: 0.7,
          dashArray: '6 3',
        }).addTo(this._centroidLayer);

        // Alte Position als verblasster Geisterumriss
        const ghostIcon = L.divIcon({
          className: '',
          html: `<div class="centroid-marker centroid-marker--ghost" style="border-color:${color}"></div>`,
          iconSize:   [26, 26],
          iconAnchor: [13, 13],
        });
        L.marker([old.lat, old.lng], { icon: ghostIcon, zIndexOffset: 999 })
          .addTo(this._centroidLayer);
      });
    }

    // Heatmap aktualisieren
    this._lastCentroids  = step.centroids;
    this._lastDatapoints = datapoints;
    this._redrawHeatmap();
  }

  // ── VQ-Visualisierung ─────────────────────────────────────────────────────────

  /**
   * Rendert einen VQ-Schritt auf der Karte.
   * @param {object} step        Ein Schritt-Objekt aus VQ.computeAllSteps()
   * @param {Array<{x:number,y:number}>} datapoints
   */
  renderVQStep(step, datapoints) {
    this._lineLayer.clearLayers();
    this._pointLayer.clearLayers();
    this._centroidLayer.clearLayers();

    const { prototypes, activePointIndex, nearestProtoIndex, type, oldProtoPos } = step;
    const isDistStep    = type === 'vq-distance';
    const isNearestStep = type === 'vq-nearest';
    const isMoveStep    = type === 'vq-move';

    // Hilfsfunktion: nächster Prototyp für einen Punkt (für Färbung)
    const nearestProtoFor = (x, y) => {
      let best = 0, bestDist = Infinity;
      prototypes.forEach((p, j) => {
        const dl = x - p.lat, dn = y - p.lng;
        const d  = dl * dl + dn * dn;
        if (d < bestDist) { bestDist = d; best = j; }
      });
      return best;
    };

    // 1. Verbindungslinie aktiver Punkt → nächster Prototyp
    if ((isNearestStep || isMoveStep) && activePointIndex >= 0) {
      const p    = datapoints[activePointIndex];
      const proto = prototypes[nearestProtoIndex];
      L.polyline([[p.x, p.y], [proto.lat, proto.lng]], {
        color:     '#f1c40f',
        weight:    2.5,
        opacity:   0.9,
        dashArray: '8 4',
      }).addTo(this._lineLayer);
    }

    // Für Distanz-Teilschritte: Mess-Linien vom aktiven Punkt zu allen bisher gemessenen Prototypen
    if (isDistStep && activePointIndex >= 0) {
      const { measuredProtoIndex, nearestSoFar } = step;
      const p = datapoints[activePointIndex];
      for (let j = 0; j <= measuredProtoIndex; j++) {
        const proto     = prototypes[j];
        const isCurrent = j === measuredProtoIndex;
        const isBest    = j === nearestSoFar && j !== measuredProtoIndex;
        L.polyline([[p.x, p.y], [proto.lat, proto.lng]], {
          color:     isCurrent ? '#f1c40f' : (isBest ? '#2ecc71' : '#aaaaaa'),
          weight:    isCurrent ? 3 : 1.5,
          opacity:   isCurrent ? 1.0 : 0.45,
          dashArray: '8 4',
        }).addTo(this._lineLayer);
      }
    }

    // 2. Datenpunkte
    // Vor dem ersten Durchgang keine Zuweisung: nur verarbeitete Punkte färben
    const isDone        = type === 'vq-done';
    const processedSet  = new Set(step.processedIndices ?? []);

    datapoints.forEach(({ x, y }, idx) => {
      const isActive    = idx === activePointIndex;
      const isProcessed = processedSet.has(idx) || isDone;

      let fillColor, fillOpacity;
      if (isActive) {
        fillColor   = '#ffffff';
        fillOpacity = 1.0;
      } else if (isProcessed) {
        fillColor   = CLUSTER_COLORS[nearestProtoFor(x, y) % CLUSTER_COLORS.length];
        fillOpacity = 1.0;
      } else {
        fillColor   = UNASSIGNED_COLOR;
        fillOpacity = 0.4;
      }

      L.circleMarker([x, y], {
        radius:      isActive ? 13 : 9,
        color:       '#1a1a2e',
        weight:      isActive ? 3 : 2,
        fillColor,
        fillOpacity,
      })
        .bindPopup(`<b>Punkt ${idx + 1}</b><br>Lat: ${x}<br>Lng: ${y}`)
        .addTo(this._pointLayer);
    });

    // 3. Prototypen als Diamant-Icons
    prototypes.forEach((proto, i) => {
      const color = CLUSTER_COLORS[i % CLUSTER_COLORS.length];
      const icon  = L.divIcon({
        className: '',
        html: `<div class="centroid-marker${isMoveStep && i === nearestProtoIndex ? ' centroid-marker--moving' : ''}" style="background:${color}"></div>`,
        iconSize:   [26, 26],
        iconAnchor: [13, 13],
      });
      L.marker([proto.lat, proto.lng], { icon, zIndexOffset: 1000 })
        .bindPopup(`<b>Prototyp ${i + 1}</b><br>Lat: ${proto.lat.toFixed(5)}<br>Lng: ${proto.lng.toFixed(5)}`)
        .addTo(this._centroidLayer);
    });

    // 4. Ghost + Bewegungslinie beim vq-move
    if (isMoveStep && oldProtoPos) {
      const color   = CLUSTER_COLORS[nearestProtoIndex % CLUSTER_COLORS.length];
      const current = prototypes[nearestProtoIndex];
      L.polyline([[oldProtoPos.lat, oldProtoPos.lng], [current.lat, current.lng]], {
        color,
        weight:    3,
        opacity:   0.7,
        dashArray: '6 3',
      }).addTo(this._centroidLayer);
      const ghostIcon = L.divIcon({
        className: '',
        html: `<div class="centroid-marker centroid-marker--ghost" style="border-color:${color}"></div>`,
        iconSize:   [26, 26],
        iconAnchor: [13, 13],
      });
      L.marker([oldProtoPos.lat, oldProtoPos.lng], { icon: ghostIcon, zIndexOffset: 999 })
        .addTo(this._centroidLayer);
    }

    // Heatmap aktualisieren
    this._lastCentroids  = prototypes;
    this._lastDatapoints = datapoints;
    this._redrawHeatmap();
  }

  // ── Heatmap ────────────────────────────────────────────────────────────────

  /**
   * Schaltet die Heatmap ein oder aus.
   * @param {boolean} v
   */
  setHeatmapVisible(v) {
    this._heatVisible = v;
    if (!v && this._heatOverlay) {
      this._heatOverlay.remove();
      this._heatOverlay = null;
    } else if (v) {
      this._redrawHeatmap();
    }
  }

  _redrawHeatmap() {
    if (!this._heatVisible) return;
    const centroids  = this._lastCentroids;
    const datapoints = this._lastDatapoints;
    if (!centroids || centroids.length === 0 || !datapoints.length) return;

    const RES = 250;
    const canvas = document.createElement('canvas');
    canvas.width  = RES;
    canvas.height = RES;

    const lats = [...datapoints.map(d => d.x), ...centroids.map(c => c.lat)];
    const lngs = [...datapoints.map(d => d.y), ...centroids.map(c => c.lng)];
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
    const padLat = (maxLat - minLat) * 0.2 || 0.01;
    const padLng = (maxLng - minLng) * 0.2 || 0.01;
    const sw = [minLat - padLat, minLng - padLng];
    const ne = [maxLat + padLat, maxLng + padLng];

    const ctx       = canvas.getContext('2d');
    const imageData = ctx.createImageData(RES, RES);

    for (let py = 0; py < RES; py++) {
      const lat = ne[0] - (py / RES) * (ne[0] - sw[0]);
      for (let px = 0; px < RES; px++) {
        const lng = sw[1] + (px / RES) * (ne[1] - sw[1]);
        let minDist = Infinity, nearest = 0;
        for (let i = 0; i < centroids.length; i++) {
          const dl = lat - centroids[i].lat;
          const dn = lng - centroids[i].lng;
          const d  = dl * dl + dn * dn;
          if (d < minDist) { minDist = d; nearest = i; }
        }
        const rgb = hexToRgb(CLUSTER_COLORS[nearest % CLUSTER_COLORS.length]);
        const off = (py * RES + px) * 4;
        imageData.data[off]     = rgb.r;
        imageData.data[off + 1] = rgb.g;
        imageData.data[off + 2] = rgb.b;
        imageData.data[off + 3] = 75; // ~30 % Deckkraft
      }
    }
    ctx.putImageData(imageData, 0, 0);

    const url    = canvas.toDataURL();
    const bounds = [sw, ne];
    if (this._heatOverlay) {
      this._heatOverlay.setBounds(bounds).setUrl(url);
    } else {
      this._heatOverlay = L.imageOverlay(url, bounds, {
        pane:        'heatmapPane',
        opacity:     1,
        interactive: false,
      }).addTo(this._map);
    }
  }

  // ── Szenario-Editor ────────────────────────────────────────────────────────────

  // ── Szenario-Editor ────────────────────────────────────────────────────────────

  /** Leert alle Visualisierungslayer (Linien, Punkte, Zentren). */
  clearVisualization() {
    this._lineLayer.clearLayers();
    this._pointLayer.clearLayers();
    this._centroidLayer.clearLayers();
  }

  /**
   * Aktiviert den Bearbeitungsmodus: Kartenklicks rufen onClick(lat, lng) auf.
   * @param {(lat: number, lng: number) => void} onClick
   */
  enableEditMode(onClick) {
    this._editClickHandler = e => onClick(e.latlng.lat, e.latlng.lng);
    this._map.on('click', this._editClickHandler);
    this._map.getContainer().classList.add('map--edit-mode');
  }

  /** Deaktiviert den Bearbeitungsmodus und leert den Edit-Layer. */
  disableEditMode() {
    if (this._editClickHandler) {
      this._map.off('click', this._editClickHandler);
      this._editClickHandler = null;
    }
    this._editLayer.clearLayers();
    this._map.getContainer().classList.remove('map--edit-mode');
  }

  /**
   * Zeigt die Datenpunkte des Editors als nummerierte Marker.
   * @param {Array<{x:number,y:number}>} points
   */
  renderEditPoints(points) {
    this._editLayer.clearLayers();
    points.forEach(({ x, y }, i) => {
      const icon = L.divIcon({
        className: '',
        html: `<div class="edit-point-marker">${i + 1}</div>`,
        iconSize:   [24, 24],
        iconAnchor: [12, 12],
      });
      L.marker([x, y], { icon })
        .bindPopup(`<b>Punkt ${i + 1}</b><br>Lat: ${x}<br>Lng: ${y}`)
        .addTo(this._editLayer);
    });
  }

  /**
   * Gibt die aktuelle Kartenansicht als GEO-URI zurück.
   * @returns {string}  z. B. "geo:51.56018,6.71694?z=14"
   */
  getViewGeoUri() {
    const { lat, lng } = this._map.getCenter();
    const zoom         = this._map.getZoom();
    return `geo:${lat.toFixed(5)},${lng.toFixed(5)}?z=${zoom}`;
  }

  /** Gibt die aktuell sichtbaren Kartengrenzen zurück. */
  getMapBounds() {
    const b = this._map.getBounds();
    return {
      south: b.getSouth(),
      north: b.getNorth(),
      west:  b.getWest(),
      east:  b.getEast(),
    };
  }

  // ── Legacy-Methode (wird nach Einführung des Clusterings nicht mehr genutzt) ─

  /**
   * @deprecated Nutze renderClusterStep() stattdessen.
   * @param {Array<{ x: number, y: number }>} datapoints
   */
  setMarkers(datapoints) {
    this._pointLayer.clearLayers();
    datapoints.forEach(({ x, y }, index) => {
      const marker = L.marker([x, y]);
      marker.bindPopup(`<strong>Punkt ${index + 1}</strong><br>Lat: ${x}<br>Lng: ${y}`);
      this._pointLayer.addLayer(marker);
    });
  }
}
