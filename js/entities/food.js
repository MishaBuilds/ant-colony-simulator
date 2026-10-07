import { clamp } from '../core/math.js';
const DOTS = 18; // visual seeds per source at full size
/**
 * A single food source. Shrinks as pieces are taken and disappears when empty.
 * Rendering uses a fixed set of seeded dot offsets so the cluster stays stable.
 */
export class FoodSource {
    x;
    y;
    maxAmount;
    baseRadius;
    amount;
    gone = false;
    /** Current visual radius in world units (shrinks as pieces are taken).
     *  A plain field instead of a getter because the hot pickup loop reads it. */
    radius;
    /** Dot offsets in [-1, 1], pairs of x/y. */
    dots;
    constructor(x, y, amount, baseRadius, rng) {
        this.x = x;
        this.y = y;
        this.amount = Math.max(1, amount);
        this.maxAmount = this.amount;
        this.baseRadius = baseRadius;
        this.radius = baseRadius;
        const dots = new Float32Array(DOTS * 2);
        for (let i = 0; i < DOTS; i++) {
            const a = rng.next() * Math.PI * 2;
            const r = Math.sqrt(rng.next()) * 0.72;
            dots[i * 2] = Math.cos(a) * r;
            dots[i * 2 + 1] = Math.sin(a) * r;
        }
        this.dots = dots;
    }
    /** How many dots are still drawn (0..DOTS). */
    get visibleDots() {
        const t = this.amount / this.maxAmount;
        return clamp(Math.ceil(DOTS * (0.15 + 0.85 * t)), 1, DOTS);
    }
    dot(i) {
        return { x: this.dots[i * 2], y: this.dots[i * 2 + 1] };
    }
    take(n = 1) {
        const got = Math.min(n, this.amount);
        this.amount -= got;
        if (this.amount <= 0) {
            this.amount = 0;
            this.gone = true;
        }
        const t = this.amount / this.maxAmount;
        this.radius = this.baseRadius * (0.4 + 0.6 * t);
        return got;
    }
}
