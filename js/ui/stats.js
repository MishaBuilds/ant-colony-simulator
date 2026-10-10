import { formatTime } from '../sim/metrics.js';
const nf = new Intl.NumberFormat('en-US');
/** Compact top-bar statistics, refreshed a few times per second. */
export class StatsView {
    ants = node('stAnts');
    delivered = node('stDelivered');
    food = node('stFood');
    time = node('stTime');
    steps = node('stSteps');
    fps = node('stFps');
    best = node('stBest');
    avg = node('stAvg');
    coverage = node('stCoverage');
    update(sim, fps) {
        const m = sim.metrics;
        this.ants.textContent = nf.format(sim.ants.length);
        this.delivered.textContent = nf.format(m.delivered);
        this.food.textContent = nf.format(Math.max(0, Math.round(m.foodLeft)));
        this.time.textContent = formatTime(m.time);
        this.steps.textContent = nf.format(m.steps);
        this.coverage.textContent = `${(sim.coverage() * 100).toFixed(sim.coverage() < 0.1 ? 1 : 0)}%`;
        this.fps.textContent = String(Math.round(fps));
        this.best.textContent = m.bestRoute === null ? '—' : nf.format(Math.round(m.bestRoute));
        this.avg.textContent = m.delivered === 0 ? '—' : nf.format(Math.round(m.avgRoute));
        this.delivered.classList.toggle('hot', m.delivered > 0);
        this.best.classList.toggle('hot', m.bestRoute !== null);
    }
}
function node(id) {
    const el = document.getElementById(id);
    if (!el)
        throw new Error(`Missing element #${id}`);
    return el;
}
