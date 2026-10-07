import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation, STEP_SECONDS } from '../js/sim/simulation.js';
import { sanitizeSettings, DEFAULT_SETTINGS, pheroGridFor } from '../js/config/settings.js';
import { STATE_SEARCHING, STATE_RETURNING } from '../js/sim/ant.js';

function makeSettings(over = {}) {
  return sanitizeSettings({ ...DEFAULT_SETTINGS, ...over });
}

function makeSim(over = {}) {
  const sim = new Simulation(makeSettings(over));
  sim.rebuild(12345); // deterministic map
  return sim;
}

function allFinite(sim) {
  for (const a of sim.ants) {
    if (!Number.isFinite(a.x) || !Number.isFinite(a.y)) return false;
    if (!Number.isFinite(a.ux) || !Number.isFinite(a.uy)) return false;
    if (a.x < 0 || a.x > sim.world.size || a.y < 0 || a.y > sim.world.size) return false;
  }
  return true;
}

// ---------------------------------------------------------------- lifecycle

test('tick advances steps and time exactly one logical step', () => {
  const sim = makeSim({ antCount: 100 });
  assert.equal(sim.metrics.steps, 0);
  assert.equal(sim.metrics.time, 0);

  sim.tick();
  assert.equal(sim.metrics.steps, 1);
  assert.ok(Math.abs(sim.metrics.time - STEP_SECONDS) < 1e-12);

  for (let i = 0; i < 9; i++) sim.tick();
  assert.equal(sim.metrics.steps, 10);
  assert.ok(Math.abs(sim.metrics.time - 10 * STEP_SECONDS) < 1e-12);
});

test('singleStep does one tick plus one maintain', () => {
  const sim = makeSim({ antCount: 50 });
  const before = sim.foodPhero.peak();
  sim.singleStep();
  assert.equal(sim.metrics.steps, 1);
  // a fresh field has nothing to evaporate, but must stay valid
  assert.ok(Number.isFinite(sim.foodPhero.peak()));
  assert.ok(sim.foodPhero.peak() <= before + 1e-9);
});

test('ants stay in-bounds, finite and moving after many ticks', () => {
  const sim = makeSim({ antCount: 250, scenario: 'maze' });
  for (let i = 0; i < 300; i++) sim.tick();
  assert.ok(allFinite(sim), 'ant left the world or became NaN');

  // ants actually move (chaos is not a frozen scene)
  const moved = sim.ants.filter((a) => {
    const dx = a.x - sim.world.nest.x;
    const dy = a.y - sim.world.nest.y;
    return Math.hypot(dx, dy) > sim.world.nest.r * 2;
  });
  assert.ok(moved.length > sim.ants.length / 4, 'ants appear not to move');
});

test('ants never sit inside an obstacle', () => {
  const sim = makeSim({ antCount: 300, scenario: 'obstacle' });
  for (let i = 0; i < 300; i++) sim.tick();
  let inside = 0;
  for (const a of sim.ants) if (sim.world.blockedAt(a.x, a.y)) inside++;
  assert.equal(inside, 0, `${inside} ants inside walls`);
});

// ------------------------------------------------------------- food mechanics

test('food pickup flips an ant to RETURNING and decrements the source', () => {
  const sim = makeSim({ antCount: 10, foodCount: 3 });
  const food = sim.world.foods[0];
  const leftBefore = sim.world.foodLeft;

  // teleport an ant onto the food and step once
  const ant = sim.ants[0];
  ant.x = food.x;
  ant.y = food.y;
  ant.state = STATE_SEARCHING;
  ant.hasFood = false;
  sim.tick();

  assert.equal(ant.state, STATE_RETURNING);
  assert.equal(ant.hasFood, true);
  assert.equal(ant.foodX, food.x);
  assert.ok(sim.world.foodLeft <= leftBefore - 1, 'food was not consumed');
});

test('delivery at the nest increments metrics and flips the ant back', () => {
  const sim = makeSim({ antCount: 10 });
  const ant = sim.ants[0];
  ant.state = STATE_RETURNING;
  ant.hasFood = true;
  ant.foodX = sim.world.foods[0].x;
  ant.foodY = sim.world.foods[0].y;
  ant.routeLen = 50;
  ant.carryDist = 42;
  ant.x = sim.world.nest.x;
  ant.y = sim.world.nest.y;

  sim.tick();

  assert.equal(sim.metrics.delivered, 1);
  assert.equal(ant.state, STATE_SEARCHING);
  assert.equal(ant.hasFood, false);
  // the same tick also moves the ant, so the recorded route is >= the value
  // it had when the tick began
  assert.ok(sim.metrics.bestRoute >= 42 && sim.metrics.bestRoute < 43.5,
    `bestRoute ${sim.metrics.bestRoute} outside expected range`);
});

test('returning ants deposit food pheromone, searching ants deposit home pheromone', () => {
  const sim = makeSim({ antCount: 40 });
  sim.foodPhero.clear();
  sim.homePhero.clear();

  for (const a of sim.ants) {
    a.state = STATE_SEARCHING;
    a.x = sim.world.nest.x + 30;
    a.y = sim.world.nest.y + 30;
  }
  sim.tick();
  const homePeakA = sim.homePhero.peak();
  const foodPeakA = sim.foodPhero.peak();
  assert.ok(homePeakA > 0, 'searching ants left no home pheromone');
  assert.equal(foodPeakA, 0, 'searching ants must not lay food pheromone');

  sim.foodPhero.clear();
  sim.homePhero.clear();
  for (const a of sim.ants) {
    a.state = STATE_RETURNING;
    a.hasFood = true;
    a.foodX = a.x - 40;
    a.foodY = a.y - 40;
    a.routeLen = 60;
  }
  sim.tick();
  assert.ok(sim.foodPhero.peak() > 0, 'returning ants left no food pheromone');
  assert.equal(sim.homePhero.peak(), 0, 'returning ants must not lay home pheromone');
});

// ------------------------------------------------------------ field dynamics

test('maintain evaporates and reduces the pheromone peak', () => {
  const sim = makeSim({ antCount: 1, evaporation: 0.02 });
  sim.foodPhero.clear();
  sim.foodPhero.data[10] = 1;
  const before = sim.foodPhero.peak();
  assert.equal(before, 1);

  sim.maintain(60);
  const after = sim.foodPhero.peak();
  assert.ok(after < before, `peak did not decay: ${before} -> ${after}`);
  assert.ok(after >= 0, 'negative pheromone');
});

test('pheromone values stay inside [0, 1] under heavy deposit', () => {
  const sim = makeSim({ antCount: 200, pheromoneStrength: 0.2 });
  for (let i = 0; i < 120; i++) {
    sim.tick();
    sim.maintain(1);
  }
  assert.ok(sim.foodPhero.peak() <= 1 + 1e-9, 'food pheromone exceeded 1');
  assert.ok(sim.homePhero.peak() <= 1 + 1e-9, 'home pheromone exceeded 1');
  assert.ok(sim.foodPhero.peak() >= 0 && sim.homePhero.peak() >= 0);
});

// ------------------------------------------------------------- robustness

test('corrupt ant positions are recovered on the next tick', () => {
  const sim = makeSim({ antCount: 20 });
  const a = sim.ants[3];
  a.x = NaN;
  a.y = Infinity;
  a.ux = 0;
  a.uy = 0; // degenerate heading
  sim.tick();
  assert.ok(Number.isFinite(a.x) && Number.isFinite(a.y), 'NaN survived a tick');
  assert.ok(a.x >= 0 && a.x <= sim.world.size && a.y >= 0 && a.y <= sim.world.size);
  const n2 = a.ux * a.ux + a.uy * a.uy;
  assert.ok(n2 >= 0.5 && n2 <= 2, `heading not a sane unit vector: ${n2}`);
});

test('garbage settings are ignored or clamped, never poison the sim', () => {
  const sim = makeSim({ antCount: 50 });
  sim.setAntCount(NaN);
  sim.setAntCount(Infinity);
  sim.setAntCount(-100);
  assert.ok(sim.ants.length >= 0 && Number.isFinite(sim.ants.length));

  sim.setFoodCount(NaN);
  sim.setFoodCount(Infinity);
  assert.ok(sim.world.foods.length >= 0);

  for (let i = 0; i < 60; i++) sim.tick();
  assert.ok(allFinite(sim));
  assert.ok(Number.isFinite(sim.metrics.delivered) && sim.metrics.delivered >= 0);
});

test('setAntCount grows and shrinks the colony', () => {
  const sim = makeSim({ antCount: 100 });
  sim.setAntCount(300);
  assert.equal(sim.ants.length, 300);
  assert.equal(sim.metrics.ants, 300);
  sim.setAntCount(25);
  assert.equal(sim.ants.length, 25);
});

test('setFoodCount updates sources and foodLeft', () => {
  const sim = makeSim({ antCount: 250, foodCount: 3 });
  sim.setFoodCount(8);
  assert.equal(sim.world.foods.length, 8);
  assert.equal(sim.world.foodLeft, 8 * sim.world.foods[0].maxAmount);
});

// ------------------------------------------------------------------ reset

test('reset restores food, counters and puts ants back at the nest', () => {
  const sim = makeSim({ antCount: 120 });
  const startFood = sim.world.foodLeft;

  for (let i = 0; i < 600; i++) sim.tick();
  sim.maintain(600);
  assert.ok(sim.metrics.steps === 600 && sim.metrics.delivered >= 0);

  sim.reset();
  assert.equal(sim.metrics.steps, 0);
  assert.equal(sim.metrics.time, 0);
  assert.equal(sim.metrics.delivered, 0);
  assert.equal(sim.world.foodLeft, startFood);
  assert.equal(sim.ants.length, 120);
  assert.equal(sim.bestPath, null);
  assert.equal(sim.foodPhero.peak(), 0);
  assert.equal(sim.homePhero.peak(), 0);

  const w = sim.world;
  for (const a of sim.ants) {
    assert.ok(Math.hypot(a.x - w.nest.x, a.y - w.nest.y) <= w.nest.r + 1e-9, 'ant not at nest');
    assert.equal(a.state, STATE_SEARCHING);
    assert.equal(a.hasFood, false);
  }
});

test('rebuild with the same seed produces the same map', () => {
  const a = makeSim({ scenario: 'random' });
  const b = makeSim({ scenario: 'random' });
  assert.equal(a.seed, b.seed);
  assert.equal(a.world.foods.length, b.world.foods.length);
  assert.deepEqual(a.layout.rects, b.layout.rects);
});

// ------------------------------------------------------------ determinism

test('same seed and settings give identical trajectories', () => {
  const run = () => {
    const sim = makeSim({ antCount: 60, scenario: 'obstacle' });
    for (let i = 0; i < 120; i++) sim.tick();
    return sim.ants.map((x) => [x.x, x.y, x.ux, x.uy, x.state]);
  };
  assert.deepEqual(run(), run());
});

// ---------------------------------------------------------- colony scaling

test('food scales with colony size', () => {
  const small = makeSim({ antCount: 250, foodCount: 2 });
  const big = makeSim({ antCount: 1200, foodCount: 2 });
  assert.equal(small.world.foods[0].maxAmount, 1200);
  assert.equal(big.world.foods[0].maxAmount, 1200 * Math.round(1200 / 250)); // ×5
  assert.ok(big.world.foodLeft > small.world.foodLeft);
});

test('pheromone grid is half the obstacle grid for every map size', () => {
  for (const mapSize of [100, 250, 500, 1000]) {
    const sim = makeSim({ mapSize });
    assert.equal(sim.foodPhero.n, pheroGridFor(mapSize));
    assert.equal(sim.homePhero.n, pheroGridFor(mapSize));
    assert.equal(sim.world.n % sim.foodPhero.n, 0, 'grids must nest');
  }
});

// ------------------------------------------------ self-organization (smoke)

test('a colony delivers food and builds a trail (self-organization smoke test)', () => {
  const sim = makeSim({ antCount: 250, scenario: 'open', evaporation: 0.0025 });
  for (let i = 0; i < 90 * 60; i++) sim.tick(); // 90 simulated seconds

  assert.ok(sim.metrics.delivered > 20, `only ${sim.metrics.delivered} delivered`);
  assert.notEqual(sim.metrics.firstFind, null, 'food never found');
  assert.ok(sim.foodPhero.peak() > 0.02, 'no food trail built');
  assert.ok(sim.metrics.bestRoute > 0, 'no route measured');
  assert.ok(allFinite(sim));
});
