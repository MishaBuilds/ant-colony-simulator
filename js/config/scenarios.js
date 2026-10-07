import { dist2 } from '../core/math.js';
export const FOOD_AMOUNT = 1200;
/**
 * Builds a layout in normalised coordinates (fractions of the map size) so the
 * same scenario works at any world size. Food positions may later be nudged by
 * the world if they happen to overlap a wall.
 */
export function createLayout(key, opts) {
    const { size, foodCount, obstacleCount, rng } = opts;
    const amount = Math.max(1, Math.round(opts.foodAmount ?? FOOD_AMOUNT));
    const S = (f) => f * size;
    const R = (x, y, w, h, angle = 0) => ({
        x: S(x),
        y: S(y),
        w: S(w),
        h: S(h),
        angle,
    });
    const ringFoods = (cx, cy, count, rMin, rMax, jitter = 0.04) => {
        const out = [];
        const base = rng.range(0, Math.PI * 2);
        for (let i = 0; i < count; i++) {
            const a = base + (i / count) * Math.PI * 2 + rng.range(-jitter, jitter) * Math.PI;
            const r = rng.range(rMin, rMax);
            out.push({ x: S(cx + Math.cos(a) * r), y: S(cy + Math.sin(a) * r), amount });
        }
        return out;
    };
    const scatterFoods = (count, rMin, rMax) => {
        const out = [];
        let guard = 0;
        while (out.length < count && guard++ < 400) {
            const a = rng.range(0, Math.PI * 2);
            const r = rng.range(rMin, rMax);
            const x = S(0.5 + Math.cos(a) * r);
            const y = S(0.5 + Math.sin(a) * r);
            if (x < size * 0.06 || y < size * 0.06 || x > size * 0.94 || y > size * 0.94)
                continue;
            const minSep = size * 0.16;
            if (out.some((f) => dist2(f.x, f.y, x, y) < minSep * minSep))
                continue;
            out.push({ x, y, amount });
        }
        while (out.length < count) {
            out.push({
                x: S(rng.range(0.12, 0.88)),
                y: S(rng.range(0.12, 0.88)),
                amount,
            });
        }
        return out;
    };
    switch (key) {
        case 'obstacle': {
            // A single tall wall between the nest (left) and the food (right).
            const rects = [R(0.5, 0.5, 0.045, 0.72)];
            const foods = [
                { x: S(0.79), y: S(0.3), amount },
                { x: S(0.81), y: S(0.72), amount },
            ];
            for (let i = 2; i < foodCount; i++)
                foods.push(...scatterFoods(1, 0.24, 0.4));
            return { nest: { x: S(0.17), y: S(0.5) }, rects, foods };
        }
        case 'corridor': {
            // Two offset bars — the only way through is the diagonal gap between them.
            const rects = [R(0.34, 0.4, 0.52, 0.05), R(0.66, 0.6, 0.52, 0.05)];
            const foods = [{ x: S(0.84), y: S(0.84), amount }];
            for (let i = 1; i < foodCount; i++) {
                foods.push({ x: S(0.8), y: S(0.16), amount });
                if (foods.length >= foodCount)
                    break;
                foods.push({ x: S(0.18), y: S(0.82), amount });
            }
            return { nest: { x: S(0.16), y: S(0.18) }, rects, foods: foods.slice(0, Math.max(1, foodCount)) };
        }
        case 'multiple': {
            const rects = [];
            const pillars = Math.max(2, Math.round(obstacleCount / 2));
            for (let i = 0; i < pillars; i++) {
                const a = rng.range(0, Math.PI * 2);
                const r = rng.range(0.16, 0.4);
                rects.push(R(0.5 + Math.cos(a) * r, 0.5 + Math.sin(a) * r, rng.range(0.06, 0.13), rng.range(0.06, 0.13), rng.range(0, Math.PI)));
            }
            return {
                nest: { x: S(0.5), y: S(0.5) },
                rects,
                foods: ringFoods(0.5, 0.5, foodCount, 0.24, 0.4),
            };
        }
        case 'maze': {
            const rects = [];
            const cells = 4;
            const step = 1 / cells;
            const thickness = 0.032;
            for (let i = 0; i < cells; i++) {
                for (let j = 0; j < cells; j++) {
                    const cx = i * step + step * 0.5;
                    const cy = j * step + step * 0.5;
                    // keep the centre clear for the nest
                    if (Math.abs(cx - 0.5) < 0.16 && Math.abs(cy - 0.5) < 0.16)
                        continue;
                    if (rng.next() < 0.55) {
                        rects.push(R(cx, cy, step * 0.82, thickness));
                    }
                    else if (rng.next() < 0.75) {
                        rects.push(R(cx, cy, thickness, step * 0.82));
                    }
                }
            }
            return {
                nest: { x: S(0.5), y: S(0.5) },
                rects,
                foods: ringFoods(0.5, 0.5, foodCount, 0.3, 0.44),
            };
        }
        case 'random': {
            const rects = [];
            const count = obstacleCount;
            let guard = 0;
            while (rects.length < count && guard++ < 300) {
                const horizontal = rng.next() < 0.5;
                const len = rng.range(0.1, 0.3);
                const thick = rng.range(0.026, 0.05);
                const cx = rng.range(0.12, 0.88);
                const cy = rng.range(0.12, 0.88);
                // keep the area around the nest open
                if (dist2(cx, cy, 0.5, 0.5) < 0.16 * 0.16)
                    continue;
                rects.push(R(cx, cy, horizontal ? len : thick, horizontal ? thick : len, rng.range(-0.35, 0.35)));
            }
            return {
                nest: { x: S(0.5), y: S(0.5) },
                rects,
                foods: scatterFoods(foodCount, 0.2, 0.42),
            };
        }
        case 'open':
        default: {
            return {
                nest: { x: S(0.5), y: S(0.5) },
                rects: [],
                foods: ringFoods(0.5, 0.5, foodCount, 0.26, 0.42),
            };
        }
    }
}
