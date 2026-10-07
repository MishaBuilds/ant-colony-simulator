import { clamp, isFiniteNumber } from '../core/math.js';
export const SCENARIOS = [
    { key: 'open', label: 'Open field' },
    { key: 'obstacle', label: 'Obstacle' },
    { key: 'corridor', label: 'Narrow passage' },
    { key: 'multiple', label: 'Multiple sources' },
    { key: 'maze', label: 'Maze' },
    { key: 'random', label: 'Random' },
];
export const MAP_LABEL = {
    100: 'Small',
    250: 'Medium',
    500: 'Large',
    1000: 'Huge',
};
export const DEFAULT_SETTINGS = {
    antCount: 250,
    foodCount: 3,
    mapSize: 250,
    scenario: 'open',
    speed: 1,
    pheromoneStrength: 0.06,
    evaporation: 0.0025,
    detectionRadius: 6,
    following: 0.85,
    randomness: 0.45,
    antSpeed: 0.3,
    obstacleCount: 6,
    pheroView: 'food',
};
/** Bounds for every numeric setting — used for live sanitising. */
export const RANGES = {
    antCount: [10, 5000],
    foodCount: [1, 12],
    mapSize: [100, 1000],
    scenario: null,
    speed: [0.25, 50],
    pheromoneStrength: [0.01, 0.2],
    evaporation: [0.0002, 0.02],
    detectionRadius: [3, 16],
    following: [0, 1],
    randomness: [0, 1.5],
    antSpeed: [0.08, 0.9],
    obstacleCount: [0, 24],
    pheroView: null,
};
const SCENARIO_KEYS = ['open', 'obstacle', 'corridor', 'multiple', 'maze', 'random'];
const PHERO_VIEWS = ['food', 'both', 'home', 'off'];
const MAP_SIZES = [100, 250, 500, 1000];
/**
 * Defensive copy of a settings object: replaces NaN/Infinity/out-of-range
 * values with safe ones so a bad input can never poison the simulation.
 */
export function sanitizeSettings(raw) {
    const out = { ...DEFAULT_SETTINGS };
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
        const value = raw[key] ?? DEFAULT_SETTINGS[key];
        if (key === 'scenario') {
            out.scenario = SCENARIO_KEYS.includes(value)
                ? value
                : DEFAULT_SETTINGS.scenario;
            continue;
        }
        if (key === 'pheroView') {
            out.pheroView = PHERO_VIEWS.includes(value)
                ? value
                : DEFAULT_SETTINGS.pheroView;
            continue;
        }
        const range = RANGES[key];
        let n = isFiniteNumber(value) ? value : DEFAULT_SETTINGS[key];
        if (range)
            n = clamp(n, range[0], range[1]);
        out[key] = n;
    }
    // map size snaps to the four supported presets
    if (!MAP_SIZES.includes(out.mapSize)) {
        out.mapSize = MAP_SIZES.reduce((best, s) => Math.abs(s - out.mapSize) < Math.abs(best - out.mapSize) ? s : best);
    }
    out.foodCount = Math.round(out.foodCount);
    out.obstacleCount = Math.round(out.obstacleCount);
    out.detectionRadius = Math.round(out.detectionRadius);
    return out;
}
/**
 * Pheromone / obstacle grid resolution for a given world size.
 * Kept modest so the heatmap stays cheap to update and smooth to look at.
 */
export function gridSizeFor(mapSize) {
    if (mapSize <= 100)
        return 160;
    if (mapSize <= 250)
        return 256;
    if (mapSize <= 500)
        return 384;
    return 512;
}
/**
 * Pheromone field resolution: half the obstacle grid. Trails are diffuse by
 * nature, so a coarser field reads identically while cutting evaporation,
 * diffusion and heatmap cost to a quarter.
 */
export function pheroGridFor(mapSize) {
    return Math.max(64, gridSizeFor(mapSize) >> 1);
}
