import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PheromoneField } from '../js/sim/pheromone.js';

test('a new field is empty', () => {
  const f = new PheromoneField(32, 1);
  assert.equal(f.n, 32);
  assert.equal(f.size, 32);
  assert.equal(f.peak(), 0);
  assert.equal(f.sample(5, 5), 0);
});

test('add accumulates and caps at 1', () => {
  const f = new PheromoneField(8, 1);
  f.add(10, 0.3);
  f.add(10, 0.3);
  assert.ok(Math.abs(f.data[10] - 0.6) < 1e-6);
  f.add(10, 0.9);
  assert.equal(f.data[10], 1);
});

test('add ignores negative indexes (outside world)', () => {
  const f = new PheromoneField(8, 1);
  f.add(-1, 5);
  f.add(-100, 5);
  assert.equal(f.peak(), 0);
});

test('sample returns 0 outside the world and the value inside', () => {
  const f = new PheromoneField(8, 1);
  f.add(9, 0.5); // x=1, y=1
  assert.equal(f.sample(1.5, 1.5), 0.5);
  assert.equal(f.sample(-1, 3), 0);
  assert.equal(f.sample(3, -1), 0);
  assert.equal(f.sample(8.5, 3), 0);
  assert.equal(f.sample(3, 8.5), 0);
});

test('evaporation is exponential over steps and clamps wild rates', () => {
  const f = new PheromoneField(8, 1);
  f.add(0, 1);
  f.evaporate(10, 0.1);
  const expected = Math.pow(0.9, 10);
  assert.ok(Math.abs(f.data[0] - expected) < 1e-5);

  // rate above 0.5 is treated as 0.5, never negative growth
  const g = new PheromoneField(8, 1);
  g.add(0, 1);
  g.evaporate(1, 5);
  assert.ok(Math.abs(g.data[0] - 0.5) < 1e-6);
});

test('evaporation with zero steps or zero rate is a no-op', () => {
  const f = new PheromoneField(8, 1);
  f.add(0, 0.7);
  f.evaporate(0, 0.2);
  f.evaporate(5, 0);
  assert.ok(Math.abs(f.data[0] - 0.7) < 1e-6);
});

test('diffusion spreads a hot cell to its neighbours', () => {
  const f = new PheromoneField(16, 1);
  const centre = 8 * 16 + 8;
  f.data[centre] = 1;
  f.diffuse(1, 0.05);

  assert.ok(f.data[centre] < 1, 'centre should lose some mass');
  assert.ok(f.data[centre - 1] > 0, 'left neighbour gains');
  assert.ok(f.data[centre + 1] > 0, 'right neighbour gains');
  assert.ok(f.data[centre - 16] > 0, 'top neighbour gains');
  assert.ok(f.data[centre + 16] > 0, 'bottom neighbour gains');

  // mass is (nearly) conserved — the 4-neighbour blur only moves it around
  let total = 0;
  for (const v of f.data) total += v;
  assert.ok(Math.abs(total - 1) < 0.05, `total ${total}`);
});

test('diffusion with negligible k is skipped safely', () => {
  const f = new PheromoneField(8, 1);
  f.add(20, 1);
  f.diffuse(1, 0);
  f.diffuse(0, 0.5);
  assert.equal(f.data[20], 1);
});

test('clear empties the field', () => {
  const f = new PheromoneField(8, 1);
  f.add(1, 1);
  f.add(40, 0.5);
  f.clear();
  assert.equal(f.peak(), 0);
});
