import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SETTINGS,
  RANGES,
  sanitizeSettings,
  gridSizeFor,
  pheroGridFor,
} from '../js/config/settings.js';

test('empty input yields the defaults', () => {
  const s = sanitizeSettings({});
  assert.deepEqual(s, DEFAULT_SETTINGS);
});

test('NaN / Infinity fall back to defaults', () => {
  const s = sanitizeSettings({
    antCount: NaN,
    speed: Infinity,
    pheromoneStrength: -Infinity,
    randomness: NaN,
  });
  assert.equal(s.antCount, DEFAULT_SETTINGS.antCount);
  assert.equal(s.speed, DEFAULT_SETTINGS.speed);
  assert.equal(s.pheromoneStrength, DEFAULT_SETTINGS.pheromoneStrength);
  assert.equal(s.randomness, DEFAULT_SETTINGS.randomness);
});

test('numeric values are clamped into their ranges', () => {
  const s = sanitizeSettings({
    speed: 5000,
    antCount: 10 ** 9,
    evaporation: -5,
    detectionRadius: 999,
    following: 42,
    randomness: -1,
    antSpeed: 0,
    obstacleCount: 100,
  });
  assert.equal(s.speed, RANGES.speed[1]);
  assert.equal(s.antCount, RANGES.antCount[1]);
  assert.equal(s.evaporation, RANGES.evaporation[0]);
  assert.equal(s.detectionRadius, RANGES.detectionRadius[1]);
  assert.equal(s.following, RANGES.following[1]);
  assert.equal(s.randomness, RANGES.randomness[0]);
  assert.equal(s.antSpeed, RANGES.antSpeed[0]);
  assert.equal(s.obstacleCount, RANGES.obstacleCount[1]);
});

test('invalid enums fall back to safe keys', () => {
  const s = sanitizeSettings({ scenario: 'nope', pheroView: 'rainbow' });
  assert.equal(s.scenario, DEFAULT_SETTINGS.scenario);
  assert.equal(s.pheroView, DEFAULT_SETTINGS.pheroView);
  const ok = sanitizeSettings({ scenario: 'maze', pheroView: 'both' });
  assert.equal(ok.scenario, 'maze');
  assert.equal(ok.pheroView, 'both');
});

test('map size snaps to one of the four presets', () => {
  assert.equal(sanitizeSettings({ mapSize: 333 }).mapSize, 250);
  assert.equal(sanitizeSettings({ mapSize: 100 }).mapSize, 100);
  assert.equal(sanitizeSettings({ mapSize: 1000 }).mapSize, 1000);
  assert.equal(sanitizeSettings({ mapSize: NaN }).mapSize, DEFAULT_SETTINGS.mapSize);
});

test('counts are rounded to integers', () => {
  const s = sanitizeSettings({ foodCount: 3.7, obstacleCount: 5.2, detectionRadius: 6.9 });
  assert.equal(s.foodCount, 4);
  assert.equal(s.obstacleCount, 5);
  assert.equal(s.detectionRadius, 7);
});

test('grid sizing: pheromone grid is half the obstacle grid', () => {
  assert.equal(gridSizeFor(100), 160);
  assert.equal(gridSizeFor(250), 256);
  assert.equal(gridSizeFor(500), 384);
  assert.equal(gridSizeFor(1000), 512);
  assert.equal(pheroGridFor(100), 80);
  assert.equal(pheroGridFor(250), 128);
  assert.equal(pheroGridFor(500), 192);
  assert.equal(pheroGridFor(1000), 256);
});
