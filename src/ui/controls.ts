import {
  MAP_LABEL,
  SCENARIOS,
  sanitizeSettings,
  type Settings,
} from '../config/settings.js';

export interface ControlActions {
  toggleRun(): void;
  step(): void;
  reset(): void;
  newMap(): void;
  fitCamera(): void;
  toggleCalc(): void;
  openHow(): void;
  onMapChange(): void;
  onAntCountChange(): void;
  onFoodCountChange(): void;
  onHint(message: string): void;
  onDeselect(): void;
}

export interface ControlsApi {
  setRunning(running: boolean): void;
  setCalc(on: boolean): void;
  syncChips(): void;
  /** Re-reads every input from settings (used after presets / imports). */
  syncInputs(): void;
}

export function bindControls(settings: Settings, actions: ControlActions): ControlsApi {
  const btnStart = el<HTMLButtonElement>('btnStart');
  const btnStartBig = el<HTMLButtonElement>('btnStartBig');
  const btnStep = el<HTMLButtonElement>('btnStep');
  const startHint = el<HTMLElement>('startHint');

  const selAnts = el<HTMLSelectElement>('selAnts');
  const selFood = el<HTMLSelectElement>('selFood');
  const selMap = el<HTMLSelectElement>('selMap');
  const selScenario = el<HTMLSelectElement>('selScenario');
  const selPheroView = el<HTMLSelectElement>('selPheroView');
  const speedSeg = el<HTMLElement>('speedSeg');
  const speedVal = el<HTMLElement>('speedVal');
  const hudMap = el<HTMLElement>('hudMap');
  const hudScenario = el<HTMLElement>('hudScenario');

  /** Merge a patch into settings, clamping/repairing every value. */
  const apply = (patch: Partial<Settings>): void => {
    Object.assign(settings, sanitizeSettings({ ...settings, ...patch }));
    syncLabels();
  };

  function syncLabels(): void {
    setText('valStrength', settings.pheromoneStrength.toFixed(3));
    setText('valEvap', settings.evaporation.toFixed(4));
    setText('valSense', String(settings.detectionRadius));
    setText('valFollow', settings.following.toFixed(2));
    setText('valRandom', settings.randomness.toFixed(2));
    setText('valSpeed', settings.antSpeed.toFixed(2));
    setText('valObstacles', String(settings.obstacleCount));
    speedVal.textContent = `${settings.speed}×`;
  }

  function syncChips(): void {
    const label = MAP_LABEL[settings.mapSize];
    hudMap.textContent = `${label ?? 'Custom'} · ${settings.mapSize} × ${settings.mapSize}`;
    const scenario = SCENARIOS.find((s) => s.key === settings.scenario);
    hudScenario.textContent = scenario ? scenario.label : 'Custom';
  }

  /** Click, then drop focus so the space shortcut stays available. */
  const bind = (btn: HTMLButtonElement, fn: () => void): void => {
    btn.addEventListener('click', () => {
      fn();
      btn.blur();
    });
  };

  bind(btnStart, actions.toggleRun);
  bind(btnStartBig, actions.toggleRun);
  bind(btnStep, actions.step);
  bind(el('btnReset'), actions.reset);
  bind(el('btnNewMap'), actions.newMap);
  bind(el('btnFit'), actions.fitCamera);
  bind(el('btnCalc'), actions.toggleCalc);
  bind(el('btnHow'), actions.openHow);
  bind(el('btnClearSel'), actions.onDeselect);

  // --- speed -----------------------------------------------------------------
  speedSeg.addEventListener('click', (e) => {
    const target = (e.target as HTMLElement).closest('button[data-speed]');
    if (!(target instanceof HTMLButtonElement)) return;
    const speed = Number(target.dataset.speed);
    if (!Number.isFinite(speed)) return;
    apply({ speed });
    for (const b of speedSeg.querySelectorAll('button')) b.classList.toggle('on', b === target);
  });

  // --- basic -----------------------------------------------------------------
  selAnts.value = String(settings.antCount);
  selAnts.addEventListener('change', () => {
    const n = Number(selAnts.value);
    if (!Number.isFinite(n)) return;
    apply({ antCount: n });
    actions.onAntCountChange();
  });

  selFood.value = String(settings.foodCount);
  selFood.addEventListener('change', () => {
    const n = Number(selFood.value);
    if (!Number.isFinite(n)) return;
    apply({ foodCount: n });
    actions.onFoodCountChange();
  });

  selMap.value = String(settings.mapSize);
  selMap.addEventListener('change', () => {
    const n = Number(selMap.value);
    if (!Number.isFinite(n)) return;
    apply({ mapSize: n });
    syncChips();
    actions.onMapChange();
  });

  selScenario.value = settings.scenario;
  selScenario.addEventListener('change', () => {
    apply({ scenario: selScenario.value as Settings['scenario'] });
    syncChips();
    actions.onMapChange();
  });

  selPheroView.value = settings.pheroView;
  selPheroView.addEventListener('change', () => {
    apply({ pheroView: selPheroView.value as Settings['pheroView'] });
  });

  // --- advanced --------------------------------------------------------------
  const sliders: [id: string, key: keyof Settings][] = [
    ['rngStrength', 'pheromoneStrength'],
    ['rngEvap', 'evaporation'],
    ['rngSense', 'detectionRadius'],
    ['rngFollow', 'following'],
    ['rngRandom', 'randomness'],
    ['rngSpeed', 'antSpeed'],
    ['rngObstacles', 'obstacleCount'],
  ];

  for (const [id, key] of sliders) {
    const input = el<HTMLInputElement>(id);
    input.value = String(settings[key]);
    input.addEventListener('input', () => {
      const v = Number(input.value);
      if (!Number.isFinite(v)) return;
      apply({ [key]: v } as Partial<Settings>);
      if (key === 'obstacleCount') actions.onHint('Obstacle count applies to the next map.');
    });
  }

  function syncInputs(): void {
    selAnts.value = String(settings.antCount);
    selFood.value = String(settings.foodCount);
    selMap.value = String(settings.mapSize);
    selScenario.value = settings.scenario;
    selPheroView.value = settings.pheroView;
    for (const [id, key] of sliders) {
      const input = document.getElementById(id) as HTMLInputElement | null;
      if (input) input.value = String(settings[key]);
    }
    for (const b of speedSeg.querySelectorAll('button')) {
      b.classList.toggle('on', Number((b as HTMLButtonElement).dataset.speed) === settings.speed);
    }
    syncLabels();
    syncChips();
  }

  syncLabels();
  syncChips();

  return {
    setRunning(running: boolean): void {
      btnStart.textContent = running ? 'Pause' : 'Start';
      btnStart.classList.toggle('primary', !running);
      startHint.classList.toggle('gone', running);
      btnStep.disabled = running;
      const mStart = document.getElementById('btnStartMobile');
      if (mStart) {
        mStart.textContent = running ? 'Pause' : 'Start';
        mStart.classList.toggle('primary', !running);
      }
      const mStep = document.getElementById('btnStepMobile') as HTMLButtonElement | null;
      if (mStep) mStep.disabled = running;
    },

    setCalc(on: boolean): void {
      el<HTMLElement>('btnCalc').setAttribute('aria-pressed', String(on));
      el<HTMLElement>('calcFlag').hidden = !on;
      document.getElementById('canvas')?.classList.toggle('picking', on);
    },

    syncChips,
    syncInputs,
  };
}

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node as T;
}

function setText(id: string, value: string): void {
  document.getElementById(id)?.replaceChildren(value);
}
