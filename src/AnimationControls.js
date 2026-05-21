/**
 * AnimationControls – rendert die Steuerleiste am unteren Bildschirmrand.
 */
export class AnimationControls {
  /**
   * @param {HTMLElement} container
   * @param {{ onStepChange: (index: number, step: object) => void,
   *           onKChange:    (k: number) => void }} callbacks
   */
  constructor(container, { onStepChange, onKChange, onHeatmapToggle, logContainer,
                            onLogToggle, onOpenEditor, onOpenSettings }) {
    this._container        = container;
    this._onStepChange     = onStepChange;
    this._onKChange        = onKChange;
    this._onHeatmapToggle  = onHeatmapToggle ?? (() => {});
    this._onLogToggle      = onLogToggle     ?? (() => {});
    this._onOpenEditor     = onOpenEditor    ?? (() => {});
    this._onOpenSettings   = onOpenSettings  ?? (() => {});
    this._logContainer     = logContainer ?? null;
    this._scenarioName     = '';
    this._scenarioDesc     = '';
    this._logList          = null;
    this._steps        = [];
    this._logicalSteps = [];
    this._currentIndex = 0;
    this._playTimer    = null;
    this._speed        = 200; // ms pro Schritt
    this._showDist     = true;
    this._showAssign   = true;
    this._render();
  }

  /**
   * Setzt neue Schrittliste und springt zum Anfang.
   * @param {Array<object>} steps
   */
  setSteps(steps) {
    this._pause();
    this._steps = steps;
    this._logicalSteps = this._buildLogicalSteps(steps);
    this._renderLog();
    this._goToStep(0);
  }

  /** Fasst aufeinanderfolgende vq-move-Schritte zu einem logischen Schritt zusammen. */
  _buildLogicalSteps(steps) {
    const logical = [];
    let i = 0;
    while (i < steps.length) {
      const step = steps[i];
      if (step.type === 'vq-move') {
        const group = { type: 'vq-move', description: step.description, indices: [i] };
        let j = i + 1;
        while (j < steps.length && steps[j].type === 'vq-move') {
          group.indices.push(j);
          j++;
        }
        logical.push(group);
        i = j;
      } else {
        logical.push({ type: step.type, description: step.description, indices: [i] });
        i++;
      }
    }
    return logical;
  }

  /**
   * Setzt den angezeigten k-Wert in der Eingabe.
   * @param {number} k
   */
  setK(k) {
    if (this._kInput) this._kInput.value = k;
  }

  /**
   * Aktualisiert den Szenario-Namen und -Beschreibung im Log-Panel.
   * @param {string} name
   * @param {string} desc
   */
  setScenarioInfo(name, desc) {
    this._scenarioName = name ?? '';
    this._scenarioDesc = desc ?? '';
    const nameEl = this._logContainer?.querySelector('.log-panel__scenario-name');
    if (nameEl) {
      nameEl.textContent = this._scenarioName;
      this._logContainer.querySelector('.log-panel__scenario-desc').textContent = this._scenarioDesc;
    }
  }

  // ── Rendering ────────────────────────────────────────────────────────────────

  _render() {
    this._container.innerHTML = `
      <div class="controls">

        <button id="btn-log-toggle" class="controls__icon-btn" title="Protokoll ein-/ausblenden">&#9776; Schritte einblenden</button>

        <div class="controls__k">
          <label class="controls__label" for="k-input">Anzahl Cluster: </label>
          <input type="number" id="k-input" class="controls__k-input"
                 min="1" max="10" value="3" />
          <button id="btn-rerun" class="controls__btn-rerun">↺ Neustart</button>
        </div>

        <div class="controls__nav">
          <button id="btn-play"  class="controls__btn controls__btn--play" title="Abspielen / Pause">▶ Animation abspielen</button>
          <button id="btn-next"  class="controls__btn" title="Schritt vor">→ Einzelschritt anzeigen</button>
        </div>

         <!--
        <div class="controls__info">
          <span id="step-counter" class="controls__counter">–</span>
          <span id="step-type"    class="controls__type"></span>
          <span id="step-desc"    class="controls__desc-text"></span>
        </div>
         -->        

        <div class="controls__speed">
          <label class="controls__label" for="speed-slider">⏱</label>
          <input type="range" id="speed-slider" min="100" max="1000" step="100" value="500" />
          <span id="speed-label" class="controls__speed-label">1.2s</span>

        </div>

        <div class="controls__actions">
          <button id="btn-open-settings" class="controls__icon-btn" title="Einstellungen">⚙</button>
        </div>

      </div>
    `;

    // Referenzen cachen
    this._kInput         = this._container.querySelector('#k-input');
    this._btnPlay        = this._container.querySelector('#btn-play');
    this._btnNext        = this._container.querySelector('#btn-next');
    this._btnRerun       = this._container.querySelector('#btn-rerun');
    this._btnLogToggle   = this._container.querySelector('#btn-log-toggle');
    this._btnOpenSettings= this._container.querySelector('#btn-open-settings');
    this._counterEl      = this._container.querySelector('#step-counter');
    this._typeEl         = this._container.querySelector('#step-type');
    this._descEl         = this._container.querySelector('#step-desc');
    this._speedSlider    = this._container.querySelector('#speed-slider');
    this._speedLabel     = this._container.querySelector('#speed-label');
    // Initialzustand aus Slider übernehmen
    this._speed = parseInt(this._speedSlider.value, 10);
    this._speedLabel.textContent = `${(this._speed / 1000).toFixed(1)}s`;
    // Events
    this._btnPlay.addEventListener('click',  () => this._togglePlay());
    this._btnNext.addEventListener('click',  () => { this._pause(); this._goToStep(this._currentIndex + 1, 1); });
    this._btnLogToggle.addEventListener('click',    () => this._onLogToggle());
    this._btnOpenSettings.addEventListener('click', () => this._onOpenSettings());

    this._speedSlider.addEventListener('input', () => {
      this._speed = parseInt(this._speedSlider.value, 10);
      this._speedLabel.textContent = `${(this._speed / 1000).toFixed(1)}s`;
      if (this._playTimer !== null) { this._pause(); this._play(); }
    });

    this._kInput.addEventListener('change', () => {
      const k = parseInt(this._kInput.value, 10);
      if (k >= 1) this._onKChange(k);
    });

    this._btnRerun.addEventListener('click', () => {
      const k = parseInt(this._kInput.value, 10);
      if (k >= 1) this._onKChange(k);
    });
  }

  // ── Navigation ───────────────────────────────────────────────────────────────

  /**
   * @param {number} index   Zielindex (wird geclampt)
   * @param {number} [dir]   Suchrichtung beim Überspringen: +1 vorwärts, -1 rückwärts
   */
  _goToStep(index, dir = 1) {
    if (this._steps.length === 0) return;
    index = Math.max(0, Math.min(index, this._steps.length - 1));
    index = this._skipToValid(index, dir);
    this._currentIndex = index;
    const step = this._steps[this._currentIndex];

    const _logIdx   = this._logicalSteps.findIndex(ls => ls.indices.includes(this._currentIndex));
    const _logTotal  = this._logicalSteps.length || this._steps.length;
    const _logNum    = (_logIdx >= 0 ? _logIdx : this._currentIndex) + 1;
    if (this._counterEl) this._counterEl.textContent = `Schritt ${_logNum} / ${_logTotal}`;
    if (this._typeEl) {
      this._typeEl.textContent  = this._typeLabel(step.type);
      this._typeEl.dataset.type = step.type;
    }
    if (this._descEl) this._descEl.textContent = step.description;
    this._btnPlay.textContent   = this._playTimer !== null ? '⏸ Animation pausieren' : '▶ Animation abspielen';

    this._updateLog(this._currentIndex);
    this._onStepChange(this._currentIndex, step);
  }

  _togglePlay() {
    this._playTimer !== null ? this._pause() : this._play();
  }

  _play() {
    if (this._currentIndex >= this._steps.length - 1) this._goToStep(0, 1);
    this._btnPlay.textContent = '⏸ Animation pausieren';
    this._playTimer = setInterval(() => {
      if (this._currentIndex >= this._steps.length - 1) {
        this._pause();
      } else {
        this._goToStep(this._currentIndex + 1, 1);
      }
    }, this._speed);
  }

  /** Gibt true zurück, wenn ein Schritt dieses Typs aktuell übersprungen werden soll. */
  _shouldSkip(type) {
    if (!this._showDist   && type === 'assign-point-distance') return true;
    if (!this._showDist   && type === 'vq-distance')           return true;
    if (!this._showAssign && type === 'assign-point')          return true;
    return false;
  }

  /** Setzt den Distanzmessungs-Filter von außen (z. B. aus dem Einstellungen-Panel). */
  setShowDist(v) {
    this._showDist = v;
    if (!v && this._steps[this._currentIndex]?.type === 'assign-point-distance') {
      this._goToStep(this._currentIndex, 1);
    }
  }

  /** Setzt den Zuweisungs-Filter von außen. */
  setShowAssign(v) {
    this._showAssign = v;
    if (!v && this._steps[this._currentIndex]?.type === 'assign-point') {
      this._goToStep(this._currentIndex, 1);
    }
  }

  /**
   * Springt vom Startindex in Richtung dir, bis ein nicht zu überspringender
   * Schritt gefunden wird.
   * @param {number} index
   * @param {number} dir  +1 oder -1
   */
  _skipToValid(index, dir) {
    const total = this._steps.length;
    let i = index;
    while (i >= 0 && i < total && this._shouldSkip(this._steps[i]?.type)) {
      i += dir;
    }
    if (i < 0 || i >= total) {
      // Gegenrichtung versuchen
      i = index;
      const inv = -dir;
      while (i >= 0 && i < total && this._shouldSkip(this._steps[i]?.type)) {
        i += inv;
      }
    }
    return Math.max(0, Math.min(i, total - 1));
  }

  _pause() {
    if (this._playTimer !== null) {
      clearInterval(this._playTimer);
      this._playTimer = null;
    }
    if (this._btnPlay) this._btnPlay.textContent = '▶ Animation abspielen';
  }

  _typeLabel(type) {
    return {
      init:                    'Init',
      'assign-point-distance': 'Distanzmessung',
      'assign-point':          'Zuweisung',
      'update-move':           'Verschiebung',
      update:                  'Update',
      converged:               '✓ Konvergiert',
      'vq-init':               'Init',
      'vq-distance':           'Distanzmessung',
      'vq-nearest':            'Nächster Prototyp',
      'vq-move':               'Prototyp bewegen',
      'vq-done':               '✓ VQ abgeschlossen',
    }[type] ?? type;
  }

  // ── Log-Panel ────────────────────────────────────────────────────────────────

  _renderLog() {
    if (!this._logContainer) return;
    const app = this._logContainer.closest('#app');
    const isCollapsed = app?.classList.contains('log--collapsed') ?? false;

    this._logContainer.innerHTML = `
      <div class="log-panel__header">
        <span>Schrittprotokoll</span>
        <button class="log-panel__toggle" title="Panel ausblenden">◀</button>
      </div>
      <ul class="log-panel__list"></ul>
    `;

    // Reopen-Button-Logik entfernt – Log-Toggle jetzt in der Toolbar

    const toggleBtn = this._logContainer.querySelector('.log-panel__toggle');
    toggleBtn.addEventListener('click', () => {
      app?.classList.add('log--collapsed');
    });

    this._logList = this._logContainer.querySelector('.log-panel__list');
    (this._logicalSteps.length ? this._logicalSteps : []).forEach((ls, li) => {
      const el = document.createElement('li');
      el.className = 'log-entry';
      el.dataset.logical = li;
      el.innerHTML = `
        <span class="log-entry__num">${li + 1}</span>
        <span class="log-entry__type" data-type="${ls.type}">${this._typeLabel(ls.type)}</span>
        <span class="log-entry__desc">${ls.description}</span>
      `;
      el.addEventListener('click', () => { this._pause(); this._goToStep(ls.indices[0]); });
      this._logList.appendChild(el);
    });
  }

  _updateLog(actualIndex) {
    if (!this._logList) return;
    const prev = this._logList.querySelector('.log-entry--active');
    if (prev) prev.classList.remove('log-entry--active');
    const logIdx = this._logicalSteps.findIndex(ls => ls.indices.includes(actualIndex));
    const active = logIdx >= 0 ? this._logList.querySelector(`[data-logical="${logIdx}"]`) : null;
    if (active) {
      active.classList.add('log-entry--active');
      active.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }
}
