/** Deterministic, fast, dependency-free random number generator (mulberry32). */
export class RNG {
    s;
    constructor(seed) {
        this.s = seed >>> 0 || 1;
    }
    /** Uniform float in [0, 1). */
    next() {
        this.s = (this.s + 0x6d2b79f5) >>> 0;
        let t = this.s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    /** Uniform float in [min, max). */
    range(min, max) {
        return min + this.next() * (max - min);
    }
    /** Uniform integer in [min, max] (inclusive). */
    int(min, max) {
        return Math.floor(this.range(min, max + 1));
    }
    /** Roughly normal-ish value in [-1, 1] (sum of two uniforms). */
    centered() {
        return this.next() + this.next() - 1;
    }
    pick(arr) {
        return arr[Math.floor(this.next() * arr.length) % arr.length];
    }
    get seed() {
        return this.s;
    }
}
