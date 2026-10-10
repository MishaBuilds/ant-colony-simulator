import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../js/sim/simulation.js';
import { sanitizeSettings, DEFAULT_SETTINGS } from '../js/config/settings.js';
import { exportConfig, serializeConfig, parseConfig } from '../js/lab/configIO.js';
import { LAB_PRESETS, presetByKey } from '../js/lab/presets.js';

function makeSim(over = {}) {
  const sim = new Simulation(sanitizeSettings({ ...DEFAULT_SETTINGS, ...over }));
  sim.rebuild(31337);
  return sim;
}

function fillField(sim, value) {
  sim.foodPhero.data.fill(value);
}

function singleSearcher(sim) {
  sim.setAntCount(1);
  sim.foodPhero.clear();
  sim.homePhero.clear();
  const a = sim.ants[0];
  a.state = 0;
  a.hasFood = false;
  a.x = sim.world.size * 0.5;
  a.y = sim.world.size * 0.5;
  a.ux = 1;
  a.uy = 0;
  return a;
}

// ------------------------------------------------------------ presets

test('presets exist and each touches only real model parameters', () => {
  assert.equal(LAB_PRESETS.length, 3);
  const allowed = new Set([
    'pheromoneStrength',
    'evaporation',
    'detectionRadius',
    'following',
    'randomness',
    'antSpeed',
  ]);
  for (const p of LAB_PRESETS) {
    assert.ok(p.label && p.hint);
    assert.ok(Object.keys(p.patch).length >= 5, `${p.key} changes too little`);
    for (const k of Object.keys(p.patch)) assert.ok(allowed.has(k), `${p.key} touches unknown param ${k}`);
    // every preset value survives sanitizing (i.e. it is in range)
    const merged = sanitizeSettings({ ...DEFAULT_SETTINGS, ...p.patch });
    for (const [k, v] of Object.entries(p.patch)) assert.equal(merged[k], v, `${p.key}.${k} out of range`);
  }
  assert.ok(presetByKey('explorer'));
  assert.equal(presetByKey('nope'), null);
});

test('explorer and highway presets pull in opposite directions', () => {
  const ex = presetByKey('explorer').patch;
  const hw = presetByKey('highway').patch;
  assert.ok(ex.following < hw.following);
  assert.ok(ex.randomness > hw.randomness);
  assert.ok(ex.pheromoneStrength < hw.pheromoneStrength);
  assert.ok(ex.evaporation > hw.evaporation);
});

// ------------------------------------------------------------ parameter influence

test('pheromoneStrength scales the deposit of a single tick', () => {
  const weak = makeSim({ antCount: 1, pheromoneStrength: 0.03 });
  const strong = makeSim({ antCount: 1, pheromoneStrength: 0.12 });
  for (const sim of [weak, strong]) {
    for (const a of sim.ants) {
      a.state = 1; // RETURNING deposits food pheromone
      a.hasFood = true;
      a.foodX = a.x - 40;
      a.foodY = a.y - 40;
      a.routeLen = 60;
    }
    sim.foodPhero.clear();
    sim.homePhero.clear();
  }
  weak.tick();
  strong.tick();
  assert.ok(strong.foodPhero.peak() > weak.foodPhero.peak() * 2, 'stronger deposit should leave a stronger trail');
});

test('evaporation scales field decay in maintain', () => {
  const slow = makeSim({ antCount: 1, evaporation: 0.0002 });
  const fast = makeSim({ antCount: 1, evaporation: 0.02 });
  slow.foodPhero.data[10] = 1;
  fast.foodPhero.data[10] = 1;
  slow.maintain(60);
  fast.maintain(60);
  assert.ok(fast.foodPhero.peak() < slow.foodPhero.peak(), 'faster evaporation should decay more');
});

test('following switches the steering decision on a uniform trail', () => {
  const follower = makeSim({ antCount: 1, following: 1 });
  const drifter = makeSim({ antCount: 1, following: 0 });
  const aF = singleSearcher(follower);
  const aD = singleSearcher(drifter);
  void aF;
  void aD;
  fillField(follower, 0.5);
  fillField(drifter, 0.5);
  follower.tick();
  drifter.tick();
  assert.equal(follower.ants[0].decision, 1, 'following=1 must commit to the trail (TRAIL)');
  assert.equal(drifter.ants[0].decision, 0, 'following=0 must ignore the trail (WANDER)');
});

test('detectionRadius changes what the sensors can reach', () => {
  const near = makeSim({ antCount: 1, following: 1, detectionRadius: 3 });
  const far = makeSim({ antCount: 1, following: 1, detectionRadius: 16 });
  const aN = singleSearcher(near);
  const aF = singleSearcher(far);
  // blob exactly at the far ant's centre-sensor point (16 cells ahead):
  // visible at radius 16, far out of reach at radius 3
  const s = near.world.size;
  void s;
  const aheadX = aN.x + far.world.cell * 16;
  const aheadY = aN.y;
  for (const sim of [near, far]) {
    const f = sim.foodPhero;
    const cx = Math.min(f.n - 1, Math.floor(aheadX * f.invCell));
    const cy = Math.min(f.n - 1, Math.floor(aheadY * f.invCell));
    f.data[cy * f.n + cx] = 1;
  }
  near.tick();
  far.tick();
  assert.equal(far.ants[0].decision, 1, 'wide sensors should see the distant blob');
  assert.notEqual(near.ants[0].decision, 1, 'narrow sensors should miss the distant blob');
  void aF;
});

test('model parameters apply live without a rebuild', () => {
  const sim = makeSim({ antCount: 1, pheromoneStrength: 0.03 });
  const setup = () => {
    for (const a of sim.ants) {
      a.state = 1;
      a.hasFood = true;
      a.foodX = a.x - 40;
      a.foodY = a.y - 40;
      a.routeLen = 60;
    }
    sim.foodPhero.clear();
    sim.homePhero.clear();
  };
  setup();
  sim.tick();
  const before = sim.foodPhero.peak();
  Object.assign(sim.settings, sanitizeSettings({ ...sim.settings, pheromoneStrength: 0.2 }));
  setup();
  sim.tick();
  assert.ok(sim.foodPhero.peak() > before * 2, 'raising strength mid-run must raise deposits');
});

// ------------------------------------------------------------ config IO

test('export/parse round-trips settings, seed and layout', () => {
  const sim = makeSim({ antCount: 500, scenario: 'obstacle' });
  sim.placeWall(40, 40, 20, 10);
  const cfg = exportConfig(sim.settings, sim.seed, sim.snapshotLayout(), true, 'roundtrip');
  const { config, warnings } = parseConfig(serializeConfig(cfg));
  assert.deepEqual(warnings, []);
  assert.equal(config.seed, sim.seed);
  assert.equal(config.settings.antCount, 500);
  assert.equal(config.layout.rects.length, sim.world.rects.length);
  assert.equal(config.layout.foods.length, sim.world.foods.length);
  const sim2 = makeSim({});
  const fixes = sim2.applyLayout(config.layout);
  assert.deepEqual(fixes, []);
  assert.equal(sim2.world.rects.length, sim.world.rects.length);
});

test('imported garbage is repaired with warnings, never throws', () => {
  const { config, warnings } = parseConfig(
    JSON.stringify({
      app: 'ant-colony-simulator',
      version: 2,
      settings: { antCount: 999999, evaporation: -5, scenario: 'nope', pheroView: 'nope' },
      layout: { nest: { x: -50, y: 1e9 }, rects: new Array(200).fill({}), foods: 'junk' },
      seed: -3,
    }),
  );
  assert.ok(warnings.length >= 2, `expected warnings, got ${warnings}`);
  assert.equal(config.settings.antCount, 5000);
  assert.equal(config.settings.scenario, 'open');
  assert.equal(config.layout.rects.length, 64);
  const sim = makeSim({});
  sim.applyLayout(config.layout); // must not throw
});

test('broken files fail loudly but safely', () => {
  assert.throws(() => parseConfig('definitely not json'), /not valid JSON/);
  assert.throws(() => parseConfig('[1,2,3]'), /must be a JSON object/);
  const { config, warnings } = parseConfig('{}');
  assert.ok(warnings.length > 0);
  assert.equal(config.layout, null);
  assert.equal(config.settings.antCount, DEFAULT_SETTINGS.antCount);
});

test('unknown versions import on a best-effort basis', () => {
  const cfg = exportConfig(DEFAULT_SETTINGS, 42, null, false);
  const future = { ...cfg, version: 99 };
  const { config, warnings } = parseConfig(JSON.stringify(future));
  assert.ok(warnings.some((w) => w.includes('99')));
  assert.equal(config.version, 2);
  assert.equal(config.layout, null);
});
