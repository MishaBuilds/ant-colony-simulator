import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../js/sim/simulation.js';
import { sanitizeSettings, DEFAULT_SETTINGS } from '../js/config/settings.js';

function makeSim(over = {}) {
  const sim = new Simulation(sanitizeSettings({ ...DEFAULT_SETTINGS, ...over }));
  sim.rebuild(777);
  return sim;
}

// ------------------------------------------------------------ food editing

test('placeFood adds a source and keeps foodLeft in sync', () => {
  const sim = makeSim({ antCount: 20 });
  const before = sim.world.foods.length;
  const leftBefore = sim.world.foodLeft;
  const ok = sim.placeFood(sim.world.size * 0.2, sim.world.size * 0.2);
  assert.equal(ok, true);
  assert.equal(sim.world.foods.length, before + 1);
  assert.ok(sim.world.foodLeft > leftBefore);
  assert.equal(sim.customized, true);
});

test('removeFood deletes the source under the cursor', () => {
  const sim = makeSim({ antCount: 20 });
  const f = sim.world.foods[0];
  assert.equal(sim.removeFood(f.x, f.y), true);
  assert.equal(sim.world.foods.length, 2); // default foodCount is 3
  assert.equal(sim.removeFood(-50, -50), false);
});

test('placed food changes foraging: ants can pick it up', () => {
  const sim = makeSim({ antCount: 10 });
  sim.world.foods.length = 0;
  const ok = sim.placeFood(sim.world.size * 0.5 + 20, sim.world.size * 0.5);
  assert.equal(ok, true);
  const food = sim.world.foods[0];
  const ant = sim.ants[0];
  ant.x = food.x;
  ant.y = food.y;
  ant.state = 0;
  ant.hasFood = false;
  sim.tick();
  assert.equal(ant.state, 1, 'ant did not pick up editor-placed food');
});

// ------------------------------------------------------------ nest editing

test('moveNest relocates the nest and clamps it inside the world', () => {
  const sim = makeSim({ antCount: 20 });
  sim.moveNest(sim.world.size * 0.1, sim.world.size * 0.9);
  assert.ok(Math.abs(sim.world.nest.x - sim.world.size * 0.1) < 1e-9);
  assert.ok(Math.abs(sim.world.nest.y - sim.world.size * 0.9) < 1e-9);
  sim.moveNest(-1000, 99999);
  assert.ok(sim.world.nest.x >= 0 && sim.world.nest.x <= sim.world.size);
  assert.ok(sim.world.nest.y >= 0 && sim.world.nest.y <= sim.world.size);
  assert.equal(sim.customized, true);
});

// ------------------------------------------------------------ wall editing

test('placeWall blocks the spot and rescues buried ants', () => {
  const sim = makeSim({ antCount: 100, scenario: 'open' });
  const cx = sim.world.size * 0.3;
  const cy = sim.world.size * 0.3;
  const cell = sim.world.cell;
  assert.equal(sim.placeWall(cx, cy, cell * 12, cell * 12), true);
  assert.equal(sim.world.rects.length, 1);
  assert.equal(sim.world.blockedAt(cx, cy), true);
  for (const a of sim.ants) {
    assert.equal(sim.world.blockedAt(a.x, a.y), false, 'ant left inside a fresh wall');
  }
  assert.equal(sim.customized, true);
});

test('walls cannot bury the nest', () => {
  const sim = makeSim({ antCount: 50, scenario: 'open' });
  const nx = sim.world.nest.x;
  const ny = sim.world.nest.y;
  assert.equal(sim.placeWall(nx, ny, 30, 30), false);
  assert.equal(sim.world.rects.length, 0);
});

test('walls change movement: ants never end up inside them', () => {
  const sim = makeSim({ antCount: 200, scenario: 'open' });
  const s = sim.world.size;
  sim.placeWall(s * 0.5, s * 0.3, s * 0.3, s * 0.08);
  for (let i = 0; i < 200; i++) sim.tick();
  let inside = 0;
  for (const a of sim.ants) if (sim.world.blockedAt(a.x, a.y)) inside++;
  assert.equal(inside, 0);
});

test('eraseAt removes walls under the cursor', () => {
  const sim = makeSim({ antCount: 10, scenario: 'open' });
  const s = sim.world.size;
  sim.placeWall(s * 0.4, s * 0.4, 20, 20);
  assert.equal(sim.world.rects.length, 1);
  const res = sim.eraseAt(s * 0.4, s * 0.4);
  assert.equal(res.walls, 1);
  assert.equal(sim.world.rects.length, 0);
});

test('clearWalls removes everything and reports the count', () => {
  const sim = makeSim({ antCount: 10, scenario: 'maze' });
  assert.ok(sim.world.rects.length > 0);
  const n = sim.clearWalls();
  assert.ok(n > 0);
  assert.equal(sim.world.rects.length, 0);
  assert.equal(sim.clearWalls(), 0);
});

// ------------------------------------------------------------ layout snapshot

test('snapshotLayout round-trips through applyLayout', () => {
  const sim = makeSim({ antCount: 10, scenario: 'open' });
  sim.placeWall(sim.world.size * 0.3, sim.world.size * 0.3, 20, 10);
  sim.moveNest(sim.world.size * 0.2, sim.world.size * 0.2);
  const snap = sim.snapshotLayout();
  const sim2 = makeSim({ antCount: 10, scenario: 'open' });
  const fixes = sim2.applyLayout(snap);
  assert.deepEqual(fixes, []);
  assert.ok(Math.abs(sim2.world.nest.x - sim.world.nest.x) < 1e-9);
  assert.equal(sim2.world.rects.length, sim.world.rects.length);
  assert.equal(sim2.world.foods.length, sim.world.foods.length);
});

test('applyLayout repairs garbage instead of throwing', () => {
  const sim = makeSim({ antCount: 5 });
  const fixes = sim.applyLayout({
    nest: { x: NaN, y: Infinity },
    rects: new Array(100).fill({ x: 0, y: 0, w: 1e9, h: -5, angle: NaN }),
    foods: [],
  });
  assert.ok(fixes.length > 0);
  assert.equal(sim.world.rects.length, 64);
  assert.ok(sim.world.foods.length >= 1);
  for (let i = 0; i < 20; i++) sim.tick();
  assert.ok(sim.ants.every((a) => Number.isFinite(a.x) && Number.isFinite(a.y)));
});

// ------------------------------------------------------------ coverage + reset

test('coverage starts near zero and grows as ants explore', () => {
  const sim = makeSim({ antCount: 250 });
  const start = sim.coverage();
  assert.ok(start >= 0 && start < 0.02, `initial coverage ${start}`);
  for (let i = 0; i < 600; i++) sim.tick();
  const after = sim.coverage();
  assert.ok(after > start + 0.05, `coverage did not grow: ${start} -> ${after}`);
  assert.ok(after <= 1);
});

test('reset clears trails and coverage but keeps edited walls', () => {
  const sim = makeSim({ antCount: 60 });
  sim.placeWall(sim.world.size * 0.3, sim.world.size * 0.3, 20, 10);
  for (let i = 0; i < 300; i++) sim.tick();
  sim.maintain(300);
  assert.ok(sim.coverage() > 0);
  sim.reset();
  // fresh experiment: only the nest cell is marked (~1/walkableCells)
  assert.ok(sim.coverage() < 0.001, `coverage not cleared: ${sim.coverage()}`);
  assert.equal(sim.foodPhero.peak(), 0);
  assert.equal(sim.homePhero.peak(), 0);
  assert.equal(sim.metrics.steps, 0);
  assert.equal(sim.world.rects.length, 1, 'reset must not wipe editor walls');
});

test('rebuild clears the customized flag', () => {
  const sim = makeSim({ antCount: 10 });
  sim.placeFood(30, 30);
  assert.equal(sim.customized, true);
  sim.rebuild(999);
  assert.equal(sim.customized, false);
});

test('clearTrails empties pheromones without touching ants or food', () => {
  const sim = makeSim({ antCount: 60 });
  for (let i = 0; i < 120; i++) sim.tick();
  const antsBefore = sim.ants.length;
  const foodBefore = sim.world.foodLeft;
  sim.clearTrails();
  assert.equal(sim.foodPhero.peak(), 0);
  assert.equal(sim.homePhero.peak(), 0);
  assert.equal(sim.ants.length, antsBefore);
  assert.equal(sim.world.foodLeft, foodBefore);
});
