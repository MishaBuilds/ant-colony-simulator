import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TAU,
  clamp,
  dist2,
  angleDiff,
  turnToward,
  fastSin,
  fastCos,
  isFiniteNumber,
} from '../js/core/math.js';

test('clamp keeps values inside the range', () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-1, 0, 10), 0);
  assert.equal(clamp(11, 0, 10), 10);
  assert.equal(clamp(0, 0, 10), 0);
});

test('dist2 is squared euclidean distance', () => {
  assert.equal(dist2(0, 0, 3, 4), 25);
  assert.equal(dist2(1, 1, 1, 1), 0);
});

test('angleDiff returns the shortest signed difference', () => {
  assert.ok(Math.abs(angleDiff(0, Math.PI / 2) - Math.PI / 2) < 1e-12);
  assert.ok(Math.abs(angleDiff(Math.PI / 2, 0) + Math.PI / 2) < 1e-12);
  // wrapping across the 2π boundary: from 350° to 10° is +20°
  const across = angleDiff((350 * Math.PI) / 180, (10 * Math.PI) / 180);
  assert.ok(Math.abs(across - (20 * Math.PI) / 180) < 1e-9);
  // result always within (-π, π]
  const d = angleDiff(0.1, 0.1 + 1.5 * Math.PI);
  assert.ok(d > -Math.PI && d <= Math.PI);
});

test('turnToward respects the per-step limit', () => {
  const max = 0.4;
  // small correction is applied exactly
  assert.equal(turnToward(0, 0.2, max), 0.2);
  // large correction is capped
  const out = turnToward(0, 2, max);
  assert.ok(Math.abs(out - max) < 1e-12);
  // turning the other way is symmetric
  const back = turnToward(0, -2, max);
  assert.ok(Math.abs(back + max) < 1e-12);
});

test('fastSin/fastCos track the real functions within 0.01 rad', () => {
  let maxErr = 0;
  for (let a = -20; a < 20; a += 0.0137) {
    maxErr = Math.max(maxErr, Math.abs(fastSin(a) - Math.sin(a)));
    maxErr = Math.max(maxErr, Math.abs(fastCos(a) - Math.cos(a)));
  }
  assert.ok(maxErr < 0.01, `max trig error ${maxErr}`);
});

test('fastSin keeps the unit circle (sin² + cos² ≈ 1)', () => {
  for (let i = 0; i < 1000; i++) {
    const a = (i / 1000) * TAU;
    const m = fastSin(a) ** 2 + fastCos(a) ** 2;
    assert.ok(Math.abs(m - 1) < 1e-4, `norm ${m} at ${a}`);
  }
});

test('isFiniteNumber rejects junk', () => {
  assert.equal(isFiniteNumber(0), true);
  assert.equal(isFiniteNumber(-3.5), true);
  assert.equal(isFiniteNumber(NaN), false);
  assert.equal(isFiniteNumber(Infinity), false);
  assert.equal(isFiniteNumber('7'), false);
  assert.equal(isFiniteNumber(null), false);
  assert.equal(isFiniteNumber(undefined), false);
});
