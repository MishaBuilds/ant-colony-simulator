import { sanitizeSettings, type Settings } from '../config/settings.js';
import { LAB_PRESETS } from '../lab/presets.js';
import { exportConfig, parseConfig, serializeConfig } from '../lab/configIO.js';
import type { Simulation } from '../sim/simulation.js';

export interface LabCallbacks {
  sim(): Simulation;
  settings(): Settings;
  refreshControls(): void;
  refreshChips(): void;
  onMutate(kind: string): void;
  onHint(message: string): void;
  onPresetApplied(label: string): void;
  onConfigLoaded(name: string | undefined, warnings: string[]): void;
  setRunning(next: boolean): void;
  isRunning(): boolean;
  resetExperiment(): void;
}

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node as T;
}

/**
 * Lab panel wiring: presets, seed, timed runs and JSON import/export.
 * All parameter changes go through sanitizeSettings so the model and the
 * panel can never disagree.
 */
export function bindLab(cb: LabCallbacks): void {
  const presetWrap = el('presetRow');
  const seedInput = el<HTMLInputElement>('labSeed');
  const durSelect = el<HTMLSelectElement>('selDuration');
  const fileInput = el<HTMLInputElement>('fileImport');

  seedInput.value = String(cb.sim().seed >>> 0);
  durSelect.value = String(cb.settings().experimentSeconds);

  // --- presets -------------------------------------------------------------
  presetWrap.replaceChildren();
  for (const preset of LAB_PRESETS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn preset';
    b.dataset.preset = preset.key;
    b.title = preset.hint;
    b.textContent = preset.label;
    b.addEventListener('click', () => {
      Object.assign(cb.settings(), sanitizeSettings({ ...cb.settings(), ...preset.patch }));
      cb.refreshControls();
      cb.onPresetApplied(preset.label);
      b.blur();
    });
    presetWrap.appendChild(b);
  }
  const presetHint = document.createElement('p');
  presetHint.className = 'mini-hint';
  presetHint.textContent = 'Presets rewrite the six model parameters that steer trails and wandering. Hover a preset for what it does.';
  presetWrap.appendChild(presetHint);

  // --- seed ------------------------------------------------------------------
  el('btnSeedApply').addEventListener('click', (e) => {
    const v = Number(seedInput.value);
    const seed = Number.isFinite(v) ? Math.max(0, Math.min(4294967295, Math.round(v))) : 0;
    if (seed === 0) {
      cb.onHint('Seed 0 means “random on next map”. Enter a value ≥ 1 to reproduce a map.');
      return;
    }
    cb.sim().rebuild(seed);
    seedInput.value = String(cb.sim().seed >>> 0);
    cb.onMutate('new-map');
    cb.onHint(`Map rebuilt from seed ${cb.sim().seed}. Same seed + settings = same map.`);
    (e.target as HTMLElement).blur?.();
  });

  el('btnSeedRandom').addEventListener('click', (e) => {
    cb.sim().rebuild();
    seedInput.value = String(cb.sim().seed >>> 0);
    cb.onMutate('new-map');
    (e.currentTarget as HTMLElement).blur?.();
  });

  // --- duration ----------------------------------------------------------------
  durSelect.addEventListener('change', () => {
    const v = Number(durSelect.value);
    Object.assign(cb.settings(), sanitizeSettings({ ...cb.settings(), experimentSeconds: v }));
    cb.onHint(
      v === 0
        ? 'Timed stop off — the colony runs until you pause it.'
        : `Experiment will auto-pause after ${v}s of simulated time. Save a snapshot from Runs to compare.`,
    );
  });

  el('btnRunTimed').addEventListener('click', (e) => {
    cb.resetExperiment();
    cb.setRunning(true);
    (e.currentTarget as HTMLElement).blur?.();
  });

  // --- export / import ------------------------------------------------------------
  el('btnExport').addEventListener('click', (e) => {
    const sim = cb.sim();
    const layout = sim.snapshotLayout();
    const cfg = exportConfig(cb.settings(), sim.seed, layout, true, 'ant-colony-2.0');
    const blob = new Blob([serializeConfig(cfg)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    a.href = url;
    a.download = `ant-colony-seed${sim.seed}-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    cb.onHint('Configuration downloaded as JSON — share it or reload it later.');
    (e.currentTarget as HTMLElement).blur?.();
  });

  el('btnImport').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const { config, warnings } = parseConfig(String(reader.result ?? ''));
        Object.assign(cb.settings(), config.settings);
        const sim = cb.sim();
        if (config.layout && (config.layout.foods.length > 0 || config.layout.rects.length > 0)) {
          sim.applyLayout(config.layout);
        } else {
          sim.rebuild(config.seed || undefined);
        }
        seedInput.value = String(sim.seed >>> 0);
        cb.refreshControls();
        cb.refreshChips();
        cb.onMutate('config-loaded');
        cb.onConfigLoaded(config.name, warnings);
      } catch (err) {
        cb.onHint(err instanceof Error ? `Import failed: ${err.message}` : 'Import failed: unreadable file.');
      } finally {
        fileInput.value = '';
      }
    };
    reader.readAsText(file);
  });
}

/** Keeps the seed field in sync after external rebuilds (e.g. New map). */
export function syncSeedField(seed: number): void {
  const input = document.getElementById('labSeed') as HTMLInputElement | null;
  if (input && document.activeElement !== input) input.value = String(seed >>> 0);
}

/** Re-reads lab inputs from settings (used after presets / imports). */
export function syncLabInputs(settings: Settings): void {
  syncSeedField(settings.seed);
  const dur = document.getElementById('selDuration') as HTMLSelectElement | null;
  if (dur) dur.value = String(settings.experimentSeconds);
}
