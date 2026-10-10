import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../js/sim/simulation.js';
import { sanitizeSettings, DEFAULT_SETTINGS } from '../js/config/settings.js';
import { HistoryRecorder, summarize, compareFinals } from '../js/lab/experiments.js';

function makeSim(over = {}) {
  const sim = new Simulation(sanitizeSettings({ ...DEFAULT_SETTINGS, ...over }));
  sim.rebuild(4242);
  return sim;
}

// ------------------------------------------------------------ recorder

test('recorder samples over time and always keeps the latest point', () => {
  const sim = makeSim({ antCount: 120 });
  const rec = new HistoryRecorder();
  rec.forcePush(sim);
  assert.equal(rec.samples.length, 1);
  assert.equal(rec.samples[0].t, 0);
  for (let i = 0; i < 600; i++) {
    sim.tick();
    if (i % 10 === 0) rec.push(sim);
  }
  assert.ok(rec.samples.length > 5, 'too few samples');
  assert.ok(rec.samples.length <= 600 / 30 + 3, `too many samples: ${rec.samples.length}`);
  for (const s of rec.samples) {
    assert.ok(s.t >= 0 && Number.isFinite(s.delivered) && s.coverage >= 0 && s.coverage <= 1);
  }
  for (let i = 1; i < rec.samples.length; i++) {
    assert.ok(rec.samples[i].t >= rec.samples[i - 1].t, 'samples out of order');
    assert.ok(rec.samples[i].delivered >= rec.samples[i - 1].delivered, 'delivered went backwards');
  }
});

// ------------------------------------------------------------ summarize

test('summarize freezes settings, seed, layout and final metrics', () => {
  const sim = makeSim({ antCount: 120 });
  const rec = new HistoryRecorder();
  for (let i = 0; i < 900; i++) {
    sim.tick();
    rec.push(sim);
  }
  rec.forcePush(sim);
  const snap = summarize(sim, rec, 'A · balanced');
  assert.equal(snap.label, 'A · balanced');
  assert.equal(snap.seed, sim.seed);
  assert.equal(snap.settings.antCount, 120);
  assert.equal(snap.final.delivered, sim.metrics.delivered);
  assert.equal(snap.final.coverage, Math.round(sim.coverage() * 10000) / 10000);
  assert.ok(snap.samples.length > 0);
  assert.ok(snap.samples.length <= 600);
  assert.equal(snap.layout.wallCount, sim.world.rects.length);
});

// ------------------------------------------------------------ compare

test('compareFinals picks the better setup per metric direction', () => {
  const a = { delivered: 100, firstFind: 20, bestRoute: 90, avgRoute: 110, coverage: 0.4, rate: 10, time: 300, steps: 18000 };
  const b = { delivered: 150, firstFind: 40, bestRoute: 80, avgRoute: 120, coverage: 0.3, rate: 15, time: 300, steps: 18000 };
  const rows = Object.fromEntries(compareFinals(a, b).map((r) => [r.key, r]));
  assert.equal(rows.delivered.better, 'B'); // higher wins
  assert.equal(rows.firstFind.better, 'A'); // lower wins
  assert.equal(rows.bestRoute.better, 'B'); // lower wins
  assert.equal(rows.avgRoute.better, 'A');
  assert.equal(rows.coverage.better, 'A');
  assert.equal(rows.rate.better, 'B');
  assert.equal(rows.delivered.diff, 50);
  assert.equal(rows.coverage.diff, -0.1);
});

test('compareFinals reports n/a when a metric is missing', () => {
  const a = { delivered: 0, firstFind: null, bestRoute: null, avgRoute: 0, coverage: 0.01, rate: 0, time: 10, steps: 600 };
  const b = { delivered: 5, firstFind: 8, bestRoute: 70, avgRoute: 70, coverage: 0.05, rate: 1, time: 60, steps: 3600 };
  const rows = Object.fromEntries(compareFinals(a, b).map((r) => [r.key, r]));
  assert.equal(rows.firstFind.better, 'n/a');
  assert.equal(rows.bestRoute.better, 'n/a');
  assert.equal(rows.delivered.better, 'B');
});

test('two runs with different parameters produce different snapshots', () => {
  const mk = (over) => {
    const sim = makeSim({ antCount: 150, ...over });
    const rec = new HistoryRecorder();
    for (let i = 0; i < 1200; i++) {
      sim.tick();
      rec.push(sim);
    }
    rec.forcePush(sim);
    return summarize(sim, rec, JSON.stringify(over));
  };
  const balanced = mk({ pheromoneStrength: 0.06, evaporation: 0.0025, following: 0.85, randomness: 0.45 });
  const explorer = mk({ pheromoneStrength: 0.03, evaporation: 0.006, following: 0.45, randomness: 1.0 });
  // settings must be frozen distinctly…
  assert.notDeepEqual(balanced.settings, explorer.settings);
  // …and the colony must behave differently (delivery curves diverge)
  const lastA = balanced.samples.at(-1).delivered;
  const lastB = explorer.samples.at(-1).delivered;
  assert.ok(
    lastA !== lastB || balanced.final.coverage !== explorer.final.coverage,
    'parameter change had zero measurable effect',
  );
});
