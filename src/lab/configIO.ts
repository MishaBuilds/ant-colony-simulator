import { sanitizeSettings, type Settings } from '../config/settings.js';
import type { WorldLayout } from '../config/scenarios.js';
import { clamp } from '../core/math.js';

export const CONFIG_VERSION = 2;
export const CONFIG_APP = 'ant-colony-simulator';

export interface SavedConfig {
  app: string;
  version: number;
  name?: string;
  settings: Settings;
  /** Concrete map; null means "regenerate from seed + scenario on load". */
  layout: WorldLayout | null;
  seed: number;
}

export interface ImportResult {
  config: SavedConfig;
  warnings: string[];
}

/**
 * Builds an exportable snapshot. When `includeLayout` is false only the seed
 * + scenario travel in the file (smaller, still reproducible for generated
 * maps); edited maps should always travel with their layout.
 */
export function exportConfig(
  settings: Settings,
  seed: number,
  layout: WorldLayout | null,
  includeLayout: boolean,
  name?: string,
): SavedConfig {
  const clean = sanitizeSettings({ ...settings });
  return {
    app: CONFIG_APP,
    version: CONFIG_VERSION,
    ...(name ? { name: name.slice(0, 80) } : {}),
    settings: clean,
    layout: includeLayout && layout ? cloneLayout(layout) : null,
    seed: seed >>> 0,
  };
}

export function serializeConfig(config: SavedConfig): string {
  return JSON.stringify(config, null, 2);
}

function cloneLayout(layout: WorldLayout): WorldLayout {
  return {
    nest: { x: layout.nest.x, y: layout.nest.y },
    rects: layout.rects.map((r) => ({ ...r })),
    foods: layout.foods.map((f) => ({ ...f })),
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Parses and validates an imported file. Never throws for bad content —
 * returns warnings and repaired values instead; throws only when the input
 * is not JSON at all or is structurally unusable.
 */
export function parseConfig(text: string): ImportResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('File is not valid JSON.');
  }
  if (!isRecord(raw)) throw new Error('Config must be a JSON object.');

  const warnings: string[] = [];

  const version = raw.version;
  if (version !== CONFIG_VERSION) {
    if (typeof version === 'number' && version < CONFIG_VERSION) {
      warnings.push(`Older format v${version}: values were re-validated against v${CONFIG_VERSION} rules.`);
    } else {
      warnings.push(`Unknown format version (${String(version)}): attempting best-effort import.`);
    }
  }
  if (raw.app !== undefined && raw.app !== CONFIG_APP) {
    warnings.push('File was created by a different app; imported on a best-effort basis.');
  }

  const settings = sanitizeSettings(isRecord(raw.settings) ? (raw.settings as Partial<Settings>) : {});
  if (!isRecord(raw.settings)) warnings.push('Missing "settings": defaults were used.');

  let seed = 0;
  if (Number.isFinite(raw.seed)) seed = (raw.seed as number) >>> 0;
  else {
    seed = (Math.random() * 0xffffffff) >>> 0;
    warnings.push('Missing "seed": a random map seed was assigned.');
  }

  let layout: WorldLayout | null = null;
  if (raw.layout === null || raw.layout === undefined) {
    layout = null;
  } else if (isRecord(raw.layout)) {
    layout = sanitizeLayout(raw.layout, warnings);
  } else {
    warnings.push('Unrecognized "layout": it was ignored, the map will be regenerated.');
  }

  const name = typeof raw.name === 'string' ? raw.name.slice(0, 80) : undefined;

  return {
    config: { app: CONFIG_APP, version: CONFIG_VERSION, ...(name ? { name } : {}), settings, layout, seed },
    warnings,
  };
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function sanitizeLayout(raw: Record<string, unknown>, warnings: string[]): WorldLayout {
  const nestRaw = isRecord(raw.nest) ? raw.nest : {};
  const nest = { x: num(nestRaw.x, 125), y: num(nestRaw.y, 125) };

  let rects: WorldLayout['rects'] = [];
  if (Array.isArray(raw.rects)) {
    rects = raw.rects.slice(0, 64).map((r) => {
      const o = isRecord(r) ? r : {};
      return {
        x: num(o.x, 0),
        y: num(o.y, 0),
        w: clamp(num(o.w, 10), 1, 600),
        h: clamp(num(o.h, 5), 1, 600),
        angle: clamp(num(o.angle, 0), -Math.PI, Math.PI),
      };
    });
    if (raw.rects.length > 64) warnings.push('Wall list trimmed to 64 entries.');
  } else {
    warnings.push('Missing "layout.rects": no walls were imported.');
  }

  let foods: WorldLayout['foods'] = [];
  if (Array.isArray(raw.foods)) {
    foods = raw.foods.slice(0, 12).map((f) => {
      const o = isRecord(f) ? f : {};
      return {
        x: num(o.x, 0),
        y: num(o.y, 0),
        amount: clamp(Math.round(num(o.amount, 1200)), 1, 200000),
      };
    });
    if (raw.foods.length > 12) warnings.push('Food list trimmed to 12 entries.');
  } else {
    warnings.push('Missing "layout.foods": food sources will be regenerated.');
  }

  return { nest, rects, foods };
}
