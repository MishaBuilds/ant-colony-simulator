import type { Simulation } from '../sim/simulation.js';
import { formatTime } from '../sim/metrics.js';

const nf = new Intl.NumberFormat('en-US');

/** Compact top-bar statistics, refreshed a few times per second. */
export class StatsView {
  private readonly ants = node('stAnts');
  private readonly delivered = node('stDelivered');
  private readonly food = node('stFood');
  private readonly time = node('stTime');
  private readonly steps = node('stSteps');
  private readonly fps = node('stFps');
  private readonly best = node('stBest');
  private readonly avg = node('stAvg');

  update(sim: Simulation, fps: number): void {
    const m = sim.metrics;
    this.ants.textContent = nf.format(sim.ants.length);
    this.delivered.textContent = nf.format(m.delivered);
    this.food.textContent = nf.format(Math.max(0, Math.round(m.foodLeft)));
    this.time.textContent = formatTime(m.time);
    this.steps.textContent = nf.format(m.steps);
    this.fps.textContent = String(Math.round(fps));
    this.best.textContent = m.bestRoute === null ? '—' : nf.format(Math.round(m.bestRoute));
    this.avg.textContent = m.delivered === 0 ? '—' : nf.format(Math.round(m.avgRoute));

    this.delivered.classList.toggle('hot', m.delivered > 0);
    this.best.classList.toggle('hot', m.bestRoute !== null);
  }
}

function node(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el;
}
