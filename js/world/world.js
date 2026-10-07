import { clamp, dist2 } from '../core/math.js';
import { FoodSource } from '../entities/food.js';
export const NEST_CELLS = 6;
export const FOOD_CELLS = 5;
/**
 * The static part of the world: bounds, obstacle grid, nest and food sources.
 * World coordinates are "units" (0..size); everything dynamic is stored in
 * those units, while wall lookups happen on a coarse cell grid.
 */
export class World {
    size;
    n; // grid resolution per axis
    cell; // world units per cell
    invCell;
    walls;
    nest = { x: 0, y: 0, r: 0 };
    rects = [];
    foods = [];
    constructor(size, n) {
        this.size = size;
        this.n = n;
        this.cell = size / n;
        this.invCell = n / size;
        this.walls = new Uint8Array(n * n);
    }
    // ------------------------------------------------------------------ queries
    cellX(wx) {
        return Math.floor(wx * this.invCell);
    }
    cellY(wy) {
        return Math.floor(wy * this.invCell);
    }
    cellIndex(wx, wy) {
        const cx = Math.floor(wx * this.invCell);
        const cy = Math.floor(wy * this.invCell);
        if (cx < 0 || cy < 0 || cx >= this.n || cy >= this.n)
            return -1;
        return cy * this.n + cx;
    }
    inside(wx, wy, margin = 0) {
        return wx >= margin && wy >= margin && wx <= this.size - margin && wy <= this.size - margin;
    }
    /** True when the point sits inside a wall or outside the world. */
    blockedAt(wx, wy) {
        if (wx < 0 || wy < 0 || wx >= this.size || wy >= this.size)
            return true;
        const cx = Math.floor(wx * this.invCell);
        const cy = Math.floor(wy * this.invCell);
        return this.walls[cy * this.n + cx] === 1;
    }
    // ------------------------------------------------------------------- build
    loadLayout(layout, rng) {
        this.nest.x = layout.nest.x;
        this.nest.y = layout.nest.y;
        this.nest.r = NEST_CELLS * this.cell;
        this.rects = layout.rects.slice();
        this.rasterize();
        this.foods = [];
        for (const spec of layout.foods) {
            const spot = this.findFreeSpot(spec.x, spec.y, FOOD_CELLS * this.cell, rng);
            if (spot)
                this.foods.push(new FoodSource(spot.x, spot.y, spec.amount, FOOD_CELLS * this.cell, rng));
        }
    }
    rasterize() {
        this.walls.fill(0);
        const n = this.n;
        for (const r of this.rects) {
            const cos = Math.cos(-r.angle);
            const sin = Math.sin(-r.angle);
            const hw = r.w * 0.5;
            const hh = r.h * 0.5;
            const cornersX = [-hw, hw, hw, -hw];
            const cornersY = [-hh, -hh, hh, hh];
            let minX = Infinity;
            let maxX = -Infinity;
            let minY = Infinity;
            let maxY = -Infinity;
            for (let i = 0; i < 4; i++) {
                const px = r.x + cornersX[i] * cos - cornersY[i] * sin;
                const py = r.y + cornersX[i] * sin + cornersY[i] * cos;
                if (px < minX)
                    minX = px;
                if (px > maxX)
                    maxX = px;
                if (py < minY)
                    minY = py;
                if (py > maxY)
                    maxY = py;
            }
            const x0 = Math.max(0, Math.floor(minX * this.invCell));
            const x1 = Math.min(n - 1, Math.ceil(maxX * this.invCell));
            const y0 = Math.max(0, Math.floor(minY * this.invCell));
            const y1 = Math.min(n - 1, Math.ceil(maxY * this.invCell));
            for (let cy = y0; cy <= y1; cy++) {
                const wy = (cy + 0.5) * this.cell;
                for (let cx = x0; cx <= x1; cx++) {
                    const wx = (cx + 0.5) * this.cell;
                    const dx = wx - r.x;
                    const dy = wy - r.y;
                    const lx = dx * cos + dy * sin;
                    const ly = -dx * sin + dy * cos;
                    if (Math.abs(lx) <= hw && Math.abs(ly) <= hh)
                        this.walls[cy * n + cx] = 1;
                }
            }
        }
    }
    /** Returns a position near the requested one that is free of walls and nest. */
    findFreeSpot(x, y, radius, rng) {
        const margin = radius + this.cell;
        const minNestDist = this.nest.r * 1.8 + radius;
        const tryPoint = (px, py) => {
            if (!this.inside(px, py, margin))
                return false;
            if (dist2(px, py, this.nest.x, this.nest.y) < minNestDist * minNestDist)
                return false;
            const probes = 8;
            for (let i = 0; i < probes; i++) {
                const a = (i / probes) * Math.PI * 2;
                if (this.blockedAt(px + Math.cos(a) * radius, py + Math.sin(a) * radius))
                    return false;
            }
            return !this.blockedAt(px, py);
        };
        if (tryPoint(x, y))
            return { x, y };
        for (let attempt = 0; attempt < 120; attempt++) {
            const px = rng.range(margin, this.size - margin);
            const py = rng.range(margin, this.size - margin);
            if (tryPoint(px, py))
                return { x: px, y: py };
        }
        return null;
    }
    /** Adds a fresh food source at a free location (used by the "food sources" control). */
    addRandomFood(amount, rng) {
        const radius = FOOD_CELLS * this.cell;
        const spot = this.findFreeSpot(rng.range(this.size * 0.15, this.size * 0.85), rng.range(this.size * 0.15, this.size * 0.85), radius, rng);
        if (!spot)
            return null;
        const food = new FoodSource(spot.x, spot.y, amount, radius, rng);
        this.foods.push(food);
        return food;
    }
    /** Keeps the food source count in sync with a target (adds or trims). */
    setFoodCount(count, amount, rng) {
        while (this.foods.length > count)
            this.foods.pop();
        while (this.foods.length < count) {
            if (!this.addRandomFood(amount, rng))
                break;
        }
    }
    get foodLeft() {
        let total = 0;
        for (const f of this.foods)
            total += f.amount;
        return total;
    }
    get aliveFoods() {
        let count = 0;
        for (const f of this.foods)
            if (!f.gone)
                count++;
        return count;
    }
    /** Removes depleted sources. Returns true when something was removed. */
    sweepDepleted() {
        let any = false;
        for (let i = 0; i < this.foods.length; i++) {
            if (this.foods[i].gone) {
                any = true;
                break;
            }
        }
        if (!any)
            return false;
        this.foods = this.foods.filter((f) => !f.gone);
        return true;
    }
}
/** Clamp helper re-exported for renderers that need safe world coordinates. */
export function clampWorld(v, size) {
    return clamp(v, 0, size);
}
