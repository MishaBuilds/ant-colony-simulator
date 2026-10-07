import { dist2 } from './core/math.js';
import { DEFAULT_SETTINGS, sanitizeSettings } from './config/settings.js';
import { Camera } from './render/camera.js';
import { Renderer } from './render/renderer.js';
import { Ant } from './sim/ant.js';
import { Simulation } from './sim/simulation.js';
import { bindControls } from './ui/controls.js';
import { Inspector } from './ui/inspector.js';
import { bindModal } from './ui/modal.js';
import { StatsView } from './ui/stats.js';

const MAX_STEPS_PER_FRAME = 240;
/** Aim for a 60 fps frame; the tick budget is whatever is left after
 *  maintain + render, so slow machines degrade in speed, not in smoothness. */
const FRAME_TARGET_MS = 1000 / 60;
const BUDGET_MIN_MS = 2;
const BUDGET_MAX_MS = 14;
/** Simulation backlog allowed before we drop requested speed (~3 s at 60 Hz). */
const MAX_ACCUMULATOR = 180;

function main(): void {
  const settings = sanitizeSettings(DEFAULT_SETTINGS);
  const sim = new Simulation(settings);
  const camera = new Camera();

  const canvas = must<HTMLCanvasElement>('canvas');
  const viewport = must<HTMLElement>('viewport');
  const renderer = new Renderer(canvas);
  const stats = new StatsView();
  const inspector = new Inspector();
  const modal = bindModal();

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
  };

  const refreshUi = (): void => {
    stats.update(sim, fps);
    inspector.update(selected, settings);
  };

  const setRunning = (next: boolean): void => {
    running = next;
    controls.setRunning(running);
    if (!running) accumulator = 0;
  };

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
  const hint = (message: string): void => {
    const toast = must<HTMLElement>('toast');
    toast.textContent = message;
    toast.classList.add('show');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove('show'), 2600);
  };

  const regenerate = (): void => {
    sim.rebuild();
    deselect();
    fit();
    refreshUi();
  };

  // ------------------------------------------------------------------ actions

  const controls = bindControls(settings, {
    toggleRun: () => setRunning(!running),
    step: () => {
      setRunning(false);
      sim.singleStep();
      refreshUi();
    },
    reset: () => {
      sim.reset();
      deselect();
      fit();
      refreshUi();
    },
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

  // --------------------------------------------------------------- interaction

  let pointerDown = false;
  let pointerMoved = false;
  let lastX = 0;
  let lastY = 0;

  const localPoint = (e: PointerEvent | WheelEvent): { x: number; y: number } => {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    canvas.setPointerCapture(e.pointerId);
    const p = localPoint(e);
    pointerDown = true;
    pointerMoved = false;
    lastX = p.x;
    lastY = p.y;
    canvas.classList.add('dragging');
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!pointerDown) return;
    const p = localPoint(e);
    const dx = p.x - lastX;
    const dy = p.y - lastY;
    if (!pointerMoved && Math.hypot(dx, dy) > 4) pointerMoved = true;
    if (pointerMoved) {
      camera.pan(dx, dy);
      manualView = true;
      updateZoomChip();
    }
    lastX = p.x;
    lastY = p.y;
  });

  const endPointer = (e: PointerEvent): void => {
    if (!pointerDown) return;
    pointerDown = false;
    canvas.classList.remove('dragging');
    if (!pointerMoved) pickAnt(localPoint(e));
  };

  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', () => {
    pointerDown = false;
    canvas.classList.remove('dragging');
  });

  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const p = localPoint(e);
      const rect = canvas.getBoundingClientRect();
      camera.zoomAt(p.x, p.y, Math.exp(-e.deltaY * 0.0016), rect.width, rect.height);
      manualView = true;
      updateZoomChip();
    },
    { passive: false },
  );

  function pickAnt(p: { x: number; y: number }): void {
    const rect = canvas.getBoundingClientRect();
    const w = camera.screenToWorld(p.x, p.y, rect.width, rect.height);
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

  // ---------------------------------------------------------------- shortcuts

  window.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement | null;
    const tag = target?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

    if (e.key === 'Escape') {
      if (modal.isOpen()) modal.close();
      else deselect();
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
      refreshUi();
      return;
    }
    const k = e.key.toLowerCase();
    if (k === 'r') {
      sim.reset();
      deselect();
      fit();
      refreshUi();
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
    animTime += dt;

    let steps = 0;
    if (running) {
      accumulator += dt * 60 * settings.speed;
      if (accumulator > MAX_ACCUMULATOR) accumulator = MAX_ACCUMULATOR;

      const usable = Math.max(
        BUDGET_MIN_MS,
        Math.min(BUDGET_MAX_MS, FRAME_TARGET_MS - workCost - 1),
      );
      const budget = now + usable;
      while (accumulator >= 1 && steps < MAX_STEPS_PER_FRAME && performance.now() < budget) {
        sim.tick();
        accumulator -= 1;
        steps++;
      }
    }

    const tWork = performance.now();
    if (steps > 0) sim.maintain(steps);
    renderer.render(sim, camera, { showCalc, selected, time: animTime });
    const tDone = performance.now();
    workCost += (tDone - tWork - workCost) * 0.1;

    statClock += dt;
    if (statClock >= 0.3) {
      statClock = 0;
      stats.update(sim, fps);
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
  controls.setRunning(false);
  controls.setCalc(false);
  refreshUi();
  requestAnimationFrame(frame);

  // exposed for manual poking in the console / automated checks
  (window as unknown as Record<string, unknown>).__antSim = { sim, camera, renderer, setRunning, setShowCalc };
}

function must<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
}

main();
