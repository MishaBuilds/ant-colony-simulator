import { dist2 } from './core/math.js';
import { DEFAULT_SETTINGS, sanitizeSettings } from './config/settings.js';
import { Camera } from './render/camera.js';
import { Renderer } from './render/renderer.js';
import { Ant } from './sim/ant.js';
import { Simulation } from './sim/simulation.js';
import { HistoryRecorder, summarize } from './lab/experiments.js';
import { bindControls } from './ui/controls.js';
import { Inspector } from './ui/inspector.js';
import { bindModal } from './ui/modal.js';
import { StatsView } from './ui/stats.js';
import { bindEditor, type EditorTool } from './ui/editor.js';
import { bindLab, syncSeedField, syncLabInputs } from './ui/lab.js';
import { RunsPanel } from './ui/compare.js';

const MAX_STEPS_PER_FRAME = 240;
/** Aim for a 60 fps frame; the tick budget is whatever is left after
 *  maintain + render, so slow machines degrade in speed, not in smoothness. */
const FRAME_TARGET_MS = 1000 / 60;
const BUDGET_MIN_MS = 2;
const BUDGET_MAX_MS = 14;
/** Simulation backlog allowed before we drop requested speed (~3 s at 60 Hz). */
const MAX_ACCUMULATOR = 180;

const REDUCED_MOTION =
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const EDITOR_SHORTCUTS: Record<string, EditorTool> = {
  '1': 'pan',
  '2': 'food',
  '3': 'nest',
  '4': 'wall',
  '5': 'erase',
};

function main(): void {
  const settings = sanitizeSettings(DEFAULT_SETTINGS);
  const sim = new Simulation(settings);
  const camera = new Camera();
  const recorder = new HistoryRecorder();

  const canvas = must<HTMLCanvasElement>('canvas');
  const viewport = must<HTMLElement>('viewport');
  const renderer = new Renderer(canvas);
  const stats = new StatsView();
  const inspector = new Inspector();
  const modal = bindModal();
  const runs = new RunsPanel({ onHint: hint });

  let running = false;
  let showCalc = false;
  let selected: Ant | null = null;
  let accumulator = 0;
  let fps = 60;
  let animTime = 0;
  let statClock = 0;
  let insClock = 0;
  let fitted = false;
  let manualView = false; // true once the user zooms or pans by hand
  let experimentDone = false;

  // ------------------------------------------------------------- view helpers

  const updateZoomChip = (): void => {
    must('hudZoom').textContent = `${camera.zoomPercent}%`;
  };

  const fit = (keepView = false): void => {
    const rect = viewport.getBoundingClientRect();
    camera.refit(rect.width, rect.height, sim.world.size, keepView);
    manualView = keepView;
    updateZoomChip();
  };

  const resize = (): void => {
    const rect = viewport.getBoundingClientRect();
    renderer.resize(rect.width, rect.height);
    if (!fitted) {
      fitted = true;
      fit(false);
    } else {
      fit(manualView);
    }
    runs.renderCompare();
  };

  const refreshChips = (): void => {
    controls.syncChips();
    if (sim.customized) must('hudScenario').textContent = 'Custom map';
  };

  const updateExperimentProgress = (): void => {
    const box = must('expProgress');
    const limit = settings.experimentSeconds;
    if (!(limit > 0)) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    const t = Math.min(sim.metrics.time, limit);
    must('expProgressLabel').textContent = `${Math.floor(t)}s / ${limit}s`;
    const bar = must('expProgressBar');
    bar.style.width = `${Math.min(100, (t / limit) * 100).toFixed(1)}%`;
  };

  const refreshUi = (): void => {
    stats.update(sim, fps);
    inspector.update(selected, settings);
    updateExperimentProgress();
    refreshChips();
  };

  const setRunning = (next: boolean): void => {
    running = next;
    controls.setRunning(running);
    if (!running) accumulator = 0;
  };

  const isRunning = (): boolean => running;

  const setShowCalc = (next: boolean): void => {
    showCalc = next;
    controls.setCalc(showCalc);
  };

  const deselect = (): void => {
    if (selected) {
      selected = null;
      inspector.update(null, settings);
    }
  };

  let toastTimer = 0;
  function hint(message: string): void {
    const toast = must<HTMLElement>('toast');
    toast.textContent = message;
    toast.classList.add('show');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove('show'), 2600);
  }

  const resetExperiment = (): void => {
    sim.reset();
    recorder.reset();
    recorder.forcePush(sim);
    deselect();
    experimentDone = false;
    fit();
    refreshUi();
  };

  const regenerate = (): void => {
    sim.rebuild();
    recorder.reset();
    recorder.forcePush(sim);
    deselect();
    experimentDone = false;
    syncSeedField(sim.seed);
    fit();
    refreshUi();
  };

  const checkExperimentEnd = (): void => {
    const limit = settings.experimentSeconds;
    if (limit > 0 && !experimentDone && sim.metrics.time >= limit) {
      experimentDone = true;
      recorder.forcePush(sim);
      setRunning(false);
      refreshUi();
      hint(`Experiment finished at ${Math.floor(sim.metrics.time)}s — save a snapshot to compare it.`);
    }
  };

  // ------------------------------------------------------------------ actions

  const controls = bindControls(settings, {
    toggleRun: () => {
      if (!running && settings.experimentSeconds > 0 && sim.metrics.time >= settings.experimentSeconds) {
        // re-running a finished timed experiment starts it over
        resetExperiment();
      }
      setRunning(!running);
    },
    step: () => {
      setRunning(false);
      sim.singleStep();
      recorder.push(sim);
      checkExperimentEnd();
      refreshUi();
    },
    reset: resetExperiment,
    newMap: regenerate,
    fitCamera: fit,
    toggleCalc: () => setShowCalc(!showCalc),
    openHow: () => modal.open(),
    onMapChange: regenerate,
    onAntCountChange: () => {
      if (selected && !sim.ants.includes(selected)) selected = null;
      sim.setAntCount(settings.antCount);
      refreshUi();
    },
    onFoodCountChange: () => {
      sim.setFoodCount(settings.foodCount);
      refreshUi();
    },
    onHint: hint,
    onDeselect: deselect,
  });

  // --------------------------------------------------------------- world editor

  const editor = bindEditor(canvas, {
    sim: () => sim,
    camera: () => camera,
    viewSize: () => {
      const rect = viewport.getBoundingClientRect();
      return { w: rect.width, h: rect.height };
    },
    onMutate: (kind) => {
      if (kind === 'new-map' || kind === 'config-loaded') {
        recorder.reset();
        recorder.forcePush(sim);
        // an imported file can change colony size: keep model and panel in sync
        sim.setAntCount(settings.antCount);
        if (selected && !sim.ants.includes(selected)) selected = null;
        deselect();
        experimentDone = false;
        syncSeedField(sim.seed);
        fit();
      }
      refreshUi();
    },
    onHint: hint,
    onInspect: (w) => pickAnt(w),
    onPan: (dx, dy) => {
      camera.pan(dx, dy);
      manualView = true;
      updateZoomChip();
    },
  });

  must('btnClearWalls').addEventListener('click', (e) => {
    const n = sim.clearWalls();
    hint(n > 0 ? `Removed ${n} wall${n === 1 ? '' : 's'}. Trails will fade into the new open space.` : 'No walls to clear.');
    refreshUi();
    (e.currentTarget as HTMLElement).blur?.();
  });

  must('btnRestoreMap').addEventListener('click', (e) => {
    sim.rebuild(sim.seed || undefined);
    recorder.reset();
    recorder.forcePush(sim);
    deselect();
    experimentDone = false;
    syncSeedField(sim.seed);
    fit();
    refreshUi();
    hint('Map restored from its seed — your edits were reverted.');
    (e.currentTarget as HTMLElement).blur?.();
  });

  // --------------------------------------------------------------- lab + runs

  bindLab({
    sim: () => sim,
    settings: () => settings,
    refreshControls: () => {
      controls.syncInputs();
      syncLabInputs(settings);
    },
    refreshChips,
    onMutate: (kind) => {
      if (kind === 'new-map' || kind === 'config-loaded') {
        recorder.reset();
        recorder.forcePush(sim);
        // an imported file can change colony size: keep model and panel in sync
        sim.setAntCount(settings.antCount);
        if (selected && !sim.ants.includes(selected)) selected = null;
        deselect();
        experimentDone = false;
        syncSeedField(sim.seed);
        fit();
      }
      refreshUi();
    },
    onHint: hint,
    onPresetApplied: (label) => {
      hint(`Preset “${label}” applied — live ants already steer by the new values.`);
      refreshUi();
    },
    onConfigLoaded: (name, warnings) => {
      hint(
        warnings.length > 0
          ? `Loaded ${name ?? 'config'} with ${warnings.length} fix${warnings.length === 1 ? '' : 'es'}: ${warnings[0]}`
          : `Loaded ${name ?? 'config'} — map and parameters applied.`,
      );
    },
    setRunning,
    isRunning,
    resetExperiment,
  });

  runs.bind();

  must('btnSaveRun').addEventListener('click', (e) => {
    recorder.forcePush(sim);
    const input = must<HTMLInputElement>('runName');
    const fallback = `Run ${runs.list.length + 1} · ${settings.scenario}${sim.customized ? '*' : ''} · ${Math.round(settings.antCount)} ants`;
    const label = (input.value || fallback).slice(0, 48);
    runs.add(summarize(sim, recorder, label));
    input.value = '';
    (e.currentTarget as HTMLElement).blur?.();
  });

  // --------------------------------------------------------------- interaction

  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      camera.zoomAt(e.clientX - rect.left, e.clientY - rect.top, Math.exp(-e.deltaY * 0.0016), rect.width, rect.height);
      manualView = true;
      updateZoomChip();
    },
    { passive: false },
  );

  canvas.addEventListener('pointermove', (e) => {
    if (editor.tool === 'pan') editor.clearHover();
    else editor.updateHover(e.clientX, e.clientY);
  });

  // touch pinch-zoom (two fingers): editor owns single-pointer gestures,
  // so a lightweight second-pointer distance tracker is enough here
  const pinch = new Map<number, { x: number; y: number }>();
  canvas.addEventListener('pointerdown', (e) => {
    pinch.set(e.pointerId, { x: e.clientX, y: e.clientY });
  });
  const pinchEnd = (e: PointerEvent): void => {
    pinch.delete(e.pointerId);
    pinchDist = 0;
  };
  canvas.addEventListener('pointerup', pinchEnd);
  canvas.addEventListener('pointercancel', pinchEnd);
  let pinchDist = 0;
  canvas.addEventListener(
    'pointermove',
    (e) => {
      if (!pinch.has(e.pointerId)) return;
      pinch.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch.size === 2) {
        const [p, q] = [...pinch.values()];
        const d = Math.hypot(p.x - q.x, p.y - q.y);
        if (pinchDist > 0 && Number.isFinite(d)) {
          const rect = canvas.getBoundingClientRect();
          camera.zoomAt(
            (p.x + q.x) / 2 - rect.left,
            (p.y + q.y) / 2 - rect.top,
            d / pinchDist,
            rect.width,
            rect.height,
          );
          manualView = true;
          updateZoomChip();
        }
        pinchDist = d;
      }
    },
    { passive: true },
  );

  function pickAnt(w: { x: number; y: number }): void {
    const maxDist2 = (14 / camera.scale) ** 2;
    let best: Ant | null = null;
    let bestD = maxDist2;
    const ants = sim.ants;
    for (let i = 0; i < ants.length; i++) {
      const d = dist2(w.x, w.y, ants[i].x, ants[i].y);
      if (d <= bestD) {
        bestD = d;
        best = ants[i];
      }
    }
    selected = best;
    inspector.update(selected, settings);
  }

  // --------------------------------------------------------- mobile transport

  must('btnStartMobile').addEventListener('click', (e) => {
    if (!running && settings.experimentSeconds > 0 && sim.metrics.time >= settings.experimentSeconds) {
      resetExperiment();
    }
    setRunning(!running);
    (e.currentTarget as HTMLElement).blur?.();
  });
  must('btnStepMobile').addEventListener('click', (e) => {
    setRunning(false);
    sim.singleStep();
    recorder.push(sim);
    checkExperimentEnd();
    refreshUi();
    (e.currentTarget as HTMLElement).blur?.();
  });
  must('btnFitMobile').addEventListener('click', (e) => {
    fit();
    (e.currentTarget as HTMLElement).blur?.();
  });

  // ---------------------------------------------------------------- shortcuts

  window.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement | null;
    const tag = target?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

    if (e.key === 'Escape') {
      if (modal.isOpen()) modal.close();
      else if (editor.tool !== 'pan') editor.setTool('pan');
      else deselect();
      return;
    }
    const tool = EDITOR_SHORTCUTS[e.key];
    if (tool) {
      editor.setTool(tool);
      return;
    }
    if (e.key === ' ' || e.code === 'Space') {
      if (tag === 'BUTTON') return; // let the focused button handle it
      e.preventDefault();
      setRunning(!running);
      return;
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      setRunning(false);
      sim.singleStep();
      recorder.push(sim);
      checkExperimentEnd();
      refreshUi();
      return;
    }
    const k = e.key.toLowerCase();
    if (k === 'r') {
      resetExperiment();
    } else if (k === 'c') {
      setShowCalc(!showCalc);
    } else if (k === 'f') {
      fit();
    }
  });

  // ----------------------------------------------------------------- main loop

  let lastFrame = performance.now();
  // EMA of the per-frame maintain+render cost (ms) — feeds the tick budget
  let workCost = 6;

  const frame = (now: number): void => {
    const dt = Math.min(0.25, (now - lastFrame) / 1000);
    lastFrame = now;
    if (dt > 0) fps = fps * 0.92 + (1 / dt) * 0.08;
    if (!REDUCED_MOTION) animTime += dt;

    let steps = 0;
    if (running) {
      accumulator += dt * 60 * settings.speed;
      if (accumulator > MAX_ACCUMULATOR) accumulator = MAX_ACCUMULATOR;

      const usable = Math.max(BUDGET_MIN_MS, Math.min(BUDGET_MAX_MS, FRAME_TARGET_MS - workCost - 1));
      const budget = now + usable;
      while (accumulator >= 1 && steps < MAX_STEPS_PER_FRAME && performance.now() < budget) {
        sim.tick();
        accumulator -= 1;
        steps++;
      }
    }

    const tWork = performance.now();
    if (steps > 0) {
      sim.maintain(steps);
      recorder.push(sim);
      checkExperimentEnd();
    }
    renderer.render(sim, camera, {
      showCalc,
      selected,
      time: animTime,
      ghostWall: editor.ghostWall,
      hover: editor.hoverWorld ? { ...editor.hoverWorld, tool: editor.tool } : null,
    });
    const tDone = performance.now();
    workCost += (tDone - tWork - workCost) * 0.1;

    statClock += dt;
    if (statClock >= 0.3) {
      statClock = 0;
      stats.update(sim, fps);
      updateExperimentProgress();
    }
    insClock += dt;
    if (insClock >= 0.1) {
      insClock = 0;
      if (selected) inspector.update(selected, settings);
    }

    requestAnimationFrame(frame);
  };

  new ResizeObserver(resize).observe(viewport);
  resize();
  recorder.forcePush(sim);
  controls.setRunning(false);
  controls.setCalc(false);
  refreshUi();
  requestAnimationFrame(frame);

  // exposed for manual poking in the console / automated checks
  (window as unknown as Record<string, unknown>).__antSim = {
    sim,
    camera,
    renderer,
    editor,
    runs,
    recorder,
    setRunning,
    setShowCalc,
  };
}

function must<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
}

main();
