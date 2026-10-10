import type { Settings } from '../config/settings.js';
import type { WorldLayout } from '../config/scenarios.js';
import type { Simulation } from '../sim/simulation.js';

/**
 * Metric definitions (how each number is actually computed):
 *
 * - delivered: counter incremented when a RETURNING ant reaches the nest.
 * - firstFind: sim-time (seconds) of the first pickup, null when nothing found yet.
 * - bestRoute: shortest carryDist (world units walked while carrying) ever
 *   delivered; moving average avgRoute covers the last 24 deliveries.
 * - coverage: fraction of walkable world-grid cells entered by >= 1 ant
 *   (Simulation.visited / walkable cells). 0 = nest only, 1 = whole arena.
 * - rate: delivered per simulated minute (delivered / (time / 60)).
 * - samples: recorder snapshots every 0.5 sim-second: { t, delivered, coverage }.
 */

export interface HistorySample {
  t: number;
  delivered: number;
  coverage: number;
  foodLeft: number;
}

export interface ExperimentFinal {
  delivered: number;
  firstFind: number | null;
  bestRoute: number | null;
  avgRoute: number;
  coverage: number;
  rate: number;
  time: number;
  steps: number;
}

export interface ExperimentSnapshot {
  id: string;
  label: string;
  createdAt: string;
  seed: number;
  scenario: string;
  customized: boolean;
  settings: Pick<
    Settings,
    | 'antCount'
    | 'foodCount'
    | 'mapSize'
    | 'scenario'
    | 'pheromoneStrength'
    | 'evaporation'
    | 'detectionRadius'
    | 'following'
    | 'randomness'
    | 'antSpeed'
    | 'obstacleCount'
  >;
  layout: { nest: { x: number; y: number }; wallCount: number; foodCount: number };
  samples: HistorySample[];
  final: ExperimentFinal;
}

const MAX_SAMPLES = 7200;

export class HistoryRecorder {
  samples: HistorySample[] = [];
  private lastT = -1;

  reset(): void {
    this.samples.length = 0;
    this.lastT = -1;
  }

  /** Records one point when >= 0.5 sim-second passed since the previous one. */
  push(sim: Simulation): void {
    const t = sim.metrics.time;
    if (t - this.lastT < 0.5 && this.samples.length > 0) return;
    this.lastT = t;
    this.samples.push({
      t: Math.round(t * 100) / 100,
      delivered: sim.metrics.delivered,
      coverage: Math.round(sim.coverage() * 10000) / 10000,
      foodLeft: Math.round(sim.world.foodLeft),
    });
    if (this.samples.length > MAX_SAMPLES) {
      // downsample in place: keep every 2nd point (oldest halves first)
      const kept: HistorySample[] = [];
      for (let i = 0; i < this.samples.length; i += 2) kept.push(this.samples[i]);
      this.samples = kept;
    }
  }

  forcePush(sim: Simulation): void {
    this.lastT = -1;
    this.push(sim);
  }
}

export function summarize(
  sim: Simulation,
  recorder: HistoryRecorder,
  label: string,
): ExperimentSnapshot {
  const m = sim.metrics;
  const settings = sim.settings;
  const layout: WorldLayout | null = sim.layout;
  return {
    id: `exp-${Date.now().toString(36)}-${Math.floor(Math.random() * 0xffff).toString(16)}`,
    label: label.slice(0, 48) || 'Experiment',
    createdAt: new Date().toISOString(),
    seed: sim.seed,
    scenario: settings.scenario,
    customized: sim.customized,
    settings: {
      antCount: Math.round(settings.antCount),
      foodCount: Math.round(settings.foodCount),
      mapSize: settings.mapSize,
      scenario: settings.scenario,
      pheromoneStrength: settings.pheromoneStrength,
      evaporation: settings.evaporation,
      detectionRadius: Math.round(settings.detectionRadius),
      following: settings.following,
      randomness: settings.randomness,
      antSpeed: settings.antSpeed,
      obstacleCount: Math.round(settings.obstacleCount),
    },
    layout: {
      nest: layout ? { ...layout.nest } : { x: sim.world.nest.x, y: sim.world.nest.y },
      wallCount: sim.world.rects.length,
      foodCount: sim.world.foods.length,
    },
    samples: recorder.samples.slice(-600),
    final: {
      delivered: m.delivered,
      firstFind: m.firstFind,
      coverage: Math.round(sim.coverage() * 10000) / 10000,
      rate: Math.round(sim.deliveryRate() * 100) / 100,
      bestRoute: m.bestRoute,
      avgRoute: Math.round(m.avgRoute * 100) / 100,
      time: Math.round(m.time * 100) / 100,
      steps: m.steps,
    },
  };
}

export interface MetricDelta {
  key: string;
  a: number | null;
  b: number | null;
  diff: number | null;
  better: 'A' | 'B' | 'tie' | 'n/a';
}

/** Higher is better except firstFind, bestRoute, avgRoute (lower wins). */
export function compareFinals(a: ExperimentFinal, b: ExperimentFinal): MetricDelta[] {
  const rows: { key: string; lower: boolean }[] = [
    { key: 'delivered', lower: false },
    { key: 'firstFind', lower: true },
    { key: 'bestRoute', lower: true },
    { key: 'avgRoute', lower: true },
    { key: 'coverage', lower: false },
    { key: 'rate', lower: false },
  ];
  return rows.map(({ key, lower }) => {
    const va = (a as unknown as Record<string, number | null>)[key] ?? null;
    const vb = (b as unknown as Record<string, number | null>)[key] ?? null;
    if (va === null || vb === null) {
      return { key, a: va, b: vb, diff: null, better: 'n/a' as const };
    }
    const diff = Math.round((vb - va) * 100) / 100;
    let better: MetricDelta['better'] = 'tie';
    if (diff !== 0) {
      const bWins = lower ? diff < 0 : diff > 0;
      better = bWins ? 'B' : 'A';
    }
    return { key, a: va, b: vb, diff, better };
  });
}

export function shortId(id: string): string {
  return id.length > 14 ? id.slice(-8) : id;
}
