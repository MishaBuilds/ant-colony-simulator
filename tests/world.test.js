import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World, NEST_CELLS, FOOD_CELLS } from '../js/world/world.js';
import { RNG } from '../js/core/rng.js';

const SIZE = 250;
const GRID = 256;

function makeLayout() {
  return {
    nest: { x: 60, y: 125 },
    rects: [{ x: 150, y: 125, w: 20, h: 180, angle: 0 }],
    foods: [
      { x: 200, y: 60, amount: 1200 },
      { x: 210, y: 190, amount: 1200 },
      { x: 40, y: 40, amount: 1200 },
    ],
  };
}

test('loadLayout rasterises walls and keeps nest/food free', () => {
  const w = new World(SIZE, GRID);
  w.loadLayout(makeLayout(), new RNG(1));

  // wall centre is blocked, nest and open floor are not
  assert.equal(w.blockedAt(150, 125), true);
  assert.equal(w.blockedAt(60, 125), false);
  assert.equal(w.blockedAt(10, 10), false);

  // nest geometry
  assert.equal(w.nest.x, 60);
  assert.equal(w.nest.r, NEST_CELLS * w.cell);

  // all three foods placed and reachable (not inside a wall)
  assert.equal(w.foods.length, 3);
  for (const f of w.foods) {
    assert.equal(w.blockedAt(f.x, f.y), false, 'food inside a wall');
    assert.equal(f.radius, FOOD_CELLS * w.cell, 'fresh source has full radius');
  }
});

test('blockedAt treats the outside world as blocked', () => {
  const w = new World(SIZE, GRID);
  w.loadLayout({ nest: { x: 60, y: 125 }, rects: [], foods: [] }, new RNG(1));
  assert.equal(w.blockedAt(-1, 50), true);
  assert.equal(w.blockedAt(50, -1), true);
  assert.equal(w.blockedAt(SIZE + 1, 50), true);
  assert.equal(w.blockedAt(50, SIZE + 1), true);
  assert.equal(w.blockedAt(50, 50), false);
});

test('cellIndex clamps to -1 outside the world', () => {
  const w = new World(SIZE, GRID);
  assert.ok(w.cellIndex(0, 0) >= 0);
  assert.ok(w.cellIndex(SIZE - 0.01, SIZE - 0.01) >= 0);
  assert.equal(w.cellIndex(-5, 10), -1);
  assert.equal(w.cellIndex(10, -5), -1);
  assert.equal(w.cellIndex(SIZE + 5, 10), -1);
  assert.equal(w.cellIndex(10, SIZE + 5), -1);
});

test('setFoodCount grows and shrinks the source list', () => {
  const w = new World(SIZE, GRID);
  w.loadLayout(makeLayout(), new RNG(2));
  const rng = new RNG(3);

  w.setFoodCount(6, 1200, rng);
  assert.equal(w.foods.length, 6);

  w.setFoodCount(2, 1200, rng);
  assert.equal(w.foods.length, 2);
  assert.equal(w.foodLeft, 2400);
});

test('sweepDepleted removes eaten sources', () => {
  const w = new World(SIZE, GRID);
  w.loadLayout(makeLayout(), new RNG(4));
  assert.equal(w.aliveFoods, 3);

  w.foods[0].take(10 ** 6);
  assert.equal(w.foods[0].gone, true);
  assert.equal(w.sweepDepleted(), true);
  assert.equal(w.foods.length, 2);
  assert.equal(w.aliveFoods, 2);
  assert.equal(w.sweepDepleted(), false, 'nothing left to sweep');
});

test('foodLeft sums remaining units', () => {
  const w = new World(SIZE, GRID);
  w.loadLayout(makeLayout(), new RNG(5));
  assert.equal(w.foodLeft, 3600);
  w.foods[1].take(200);
  assert.equal(w.foodLeft, 3400);
});
