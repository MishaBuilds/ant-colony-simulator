export const TAU = Math.PI * 2;
export function clamp(v, min, max) {
    return v < min ? min : v > max ? max : v;
}
export function lerp(a, b, t) {
    return a + (b - a) * t;
}
export function dist2(ax, ay, bx, by) {
    const dx = ax - bx;
    const dy = ay - by;
    return dx * dx + dy * dy;
}
export function dist(ax, ay, bx, by) {
    return Math.sqrt(dist2(ax, ay, bx, by));
}
/** Shortest signed difference between two angles, in (-PI, PI]. */
export function angleDiff(from, to) {
    let d = (to - from) % TAU;
    if (d > Math.PI)
        d -= TAU;
    if (d < -Math.PI)
        d += TAU;
    return d;
}
/** Rotate `current` toward `target` by at most `maxStep` radians. */
export function turnToward(current, target, maxStep) {
    const d = angleDiff(current, target);
    if (Math.abs(d) <= maxStep)
        return target;
    return current + Math.sign(d) * maxStep;
}
/** Guard against values that escaped the math pipeline (NaN / Infinity). */
export function isFiniteNumber(v) {
    return typeof v === 'number' && Number.isFinite(v);
}
/* ------------------------------------------------------------------ fast trig
   Math.sin / Math.cos are far too slow for a per-ant hot loop, so angles are
   resolved through a lookup table. Error stays below 0.002 rad. */
const TABLE = 2048;
const QUARTER = TABLE / 4;
const ANGLES_PER_RAD = TABLE / TAU;
const SIN_TABLE = new Float32Array(TABLE);
for (let i = 0; i < TABLE; i++)
    SIN_TABLE[i] = Math.sin((i * TAU) / TABLE);
export function fastSin(angle) {
    return SIN_TABLE[((angle * ANGLES_PER_RAD) | 0) & (TABLE - 1)];
}
export function fastCos(angle) {
    return SIN_TABLE[(((angle * ANGLES_PER_RAD) | 0) + QUARTER) & (TABLE - 1)];
}
