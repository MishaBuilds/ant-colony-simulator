import { clamp, dist2 } from '../core/math.js';
import { RNG } from '../core/rng.js';
import type { FoodSpec, RectSpec, WorldLayout } from '../config/scenarios.js';
import { FoodSource } from '../entities/food.js';

export const NEST_CELLS = 6;
export const FOOD_CELLS = 5;

/**
 * The static part of the world: bounds, obstacle grid, nest and food sources.
 * World coordinates are "units" (0..size); everything dynamic is stored in
 * those units, while wall lookups happen on a coarse cell grid.
 */
export class World {
  readonly size: number;
  readonly n: number; // grid resolution per axis
  readonly cell: number; // world units per cell
  readonly invCell: number;

  readonly walls: Uint8Array;
  readonly nest = { x: 0, y: 0, r: 0 };
  rects: RectSpec[] = [];
  foods: FoodSource[] = [];

  constructor(size: number, n: number) {
    this.size = size;
    this.n = n;
    this.cell = size / n;
    this.invCell = n / size;
    this.walls = new Uint8Array(n * n);
  }

  // ------------------------------------------------------------------ queries

  cellX(wx: number): number {
    return Math.floor(wx * this.invCell);
  }

  cellY(wy: number): number {
    return Math.floor(wy * this.invCell);
  }

  cellIndex(wx: number, wy: number): number {
    const cx = Math.floor(wx * this.invCell);
    const cy = Math.floor(wy * this.invCell);
    if (cx < 0 || cy < 0 || cx >= this.n || cy >= this.n) return -1;
    return cy * this.n + cx;
  }

  inside(wx: number, wy: number, margin = 0): boolean {
    return wx >= margin && wy >= margin && wx <= this.size - margin && wy <= this.size - margin;
  }

  /** True when the point sits inside a wall or outside the world. */
  blockedAt(wx: number, wy: number): boolean {
    if (wx < 0 || wy < 0 || wx >= this.size || wy >= this.size) return true;
    const cx = Math.floor(wx * this.invCell);
    const cy = Math.floor(wy * this.invCell);
    return this.walls[cy * this.n + cx] === 1;
  }

  // ------------------------------------------------------------------- build

  loadLayout(layout: WorldLayout, rng: RNG): void {
    this.nest.x = layout.nest.x;
    this.nest.y = layout.nest.y;
    this.nest.r = NEST_CELLS * this.cell;
    this.rects = layout.rects.slice();

    this.refreshWalls();

    this.foods = [];
    for (const spec of layout.foods) {
      const spot = this.findFreeSpot(spec.x, spec.y, FOOD_CELLS * this.cell, rng);
      if (spot) this.foods.push(new FoodSource(spot.x, spot.y, spec.amount, FOOD_CELLS * this.cell, rng));
    }
  }

  /** Re-rasterizes obstacle rects onto the wall grid (call after editing rects). */
  refreshWalls(): void {
    this.rasterize();
  }

  // ------------------------------------------------------------ editor (v2)

  /** Moves the nest, clamped inside the world. Returns the applied position. */
  setNest(x: number, y: number): { x: number; y: number } {
    const r = this.nest.r + this.cell;
    this.nest.x = clamp(x, r, this.size - r);
    this.nest.y = clamp(y, r, this.size - r);
    return { x: this.nest.x, y: this.nest.y };
  }

  /**
   * Adds an axis-aligned wall rect centred at (x, y). Size is clamped so the
   * wall always stays inside the world. Returns the stored rect, or null when
   * the requested size is degenerate.
   */
  addWall(x: number, y: number, w: number, h: number, angle = 0): RectSpec | null {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(w) || !Number.isFinite(h)) return null;
    const cw = clamp(w, this.cell * 2, this.size * 0.6);
    const ch = clamp(h, this.cell * 2, this.size * 0.6);
    if (!(cw > 0 && ch > 0)) return null;
    const cx = clamp(x, 0, this.size);
    const cy = clamp(y, 0, this.size);
    const rect: RectSpec = { x: cx, y: cy, w: cw, h: ch, angle: Number.isFinite(angle) ? angle : 0 };
    this.rects.push(rect);
    this.refreshWalls();
    return rect;
  }

  /** Removes every wall rect containing (x, y). Returns how many were removed. */
  removeWallsAt(x: number, y: number): number {
    const before = this.rects.length;
    if (before === 0) return 0;
    const cos = (a: number): number => Math.cos(a);
    const sin = (a: number): number => Math.sin(a);
    this.rects = this.rects.filter((r) => {
      const dx = x - r.x;
      const dy = y - r.y;
      const c = cos(-r.angle);
      const s = sin(-r.angle);
      const lx = Math.abs(dx * c - dy * s);
      const ly = Math.abs(dx * s + dy * c);
      return !(lx <= r.w / 2 && ly <= r.h / 2);
    });
    const removed = before - this.rects.length;
    if (removed > 0) this.refreshWalls();
    return removed;
  }

  /** Removes all walls. Returns how many were removed. */
  clearWalls(): number {
    const n = this.rects.length;
    if (n === 0) return 0;
    this.rects = [];
    this.refreshWalls();
    return n;
  }

  /**
   * Adds a food source at (x, y). When the spot is blocked, searches nearby
   * for a free spot the same way generated maps do. Returns null if none found.
   */
  addFoodAt(x: number, y: number, amount: number, rng: RNG): FoodSource | null {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const safe = Math.max(1, Math.round(Number.isFinite(amount) ? amount : 1200));
    const radius = FOOD_CELLS * this.cell;
    const spot = this.findFreeSpot(x, y, radius, rng);
    if (!spot) return null;
    const food = new FoodSource(spot.x, spot.y, safe, radius, rng);
    this.foods.push(food);
    return food;
  }

  /** Removes the food source whose extent contains (x, y). Returns true when removed. */
  removeFoodAt(x: number, y: number): boolean {
    for (let i = 0; i < this.foods.length; i++) {
      const f = this.foods[i];
      const reach = f.radius * 1.4;
      const dx = x - f.x;
      const dy = y - f.y;
      if (dx * dx + dy * dy <= reach * reach) {
        this.foods.splice(i, 1);
        return true;
      }
    }
    return false;
  }

  /** Moves food `index` to (x, y) when the destination is free. Returns success. */
  moveFood(index: number, x: number, y: number, rng: RNG): boolean {
    const f = this.foods[index];
    if (!f || !Number.isFinite(x) || !Number.isFinite(y)) return false;
    const radius = FOOD_CELLS * this.cell;
    const spot = this.findFreeSpot(x, y, radius, rng);
    if (!spot) return false;
    const replacement = new FoodSource(spot.x, spot.y, f.amount, radius, rng);
    this.foods[index] = replacement;
    return true;
  }

  /** Index of the food source containing (x, y), or -1. */
  foodIndexAt(x: number, y: number): number {
    for (let i = 0; i < this.foods.length; i++) {
      const f = this.foods[i];
      const reach = f.radius * 1.4;
      const dx = x - f.x;
      const dy = y - f.y;
      if (dx * dx + dy * dy <= reach * reach) return i;
    }
    return -1;
  }

  private rasterize(): void {
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
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
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
          if (Math.abs(lx) <= hw && Math.abs(ly) <= hh) this.walls[cy * n + cx] = 1;
        }
      }
    }
  }

  /** Returns a position near the requested one that is free of walls and nest. */
  findFreeSpot(x: number, y: number, radius: number, rng: RNG): { x: number; y: number } | null {
    const margin = radius + this.cell;
    const minNestDist = this.nest.r * 1.8 + radius;

    const tryPoint = (px: number, py: number): boolean => {
      if (!this.inside(px, py, margin)) return false;
      if (dist2(px, py, this.nest.x, this.nest.y) < minNestDist * minNestDist) return false;
      const probes = 8;
      for (let i = 0; i < probes; i++) {
        const a = (i / probes) * Math.PI * 2;
        if (this.blockedAt(px + Math.cos(a) * radius, py + Math.sin(a) * radius)) return false;
      }
      return !this.blockedAt(px, py);
    };

    if (tryPoint(x, y)) return { x, y };

    for (let attempt = 0; attempt < 120; attempt++) {
      const px = rng.range(margin, this.size - margin);
      const py = rng.range(margin, this.size - margin);
      if (tryPoint(px, py)) return { x: px, y: py };
    }
    return null;
  }

  /** Adds a fresh food source at a free location (used by the "food sources" control). */
  addRandomFood(amount: number, rng: RNG): FoodSource | null {
    const radius = FOOD_CELLS * this.cell;
    const spot = this.findFreeSpot(
      rng.range(this.size * 0.15, this.size * 0.85),
      rng.range(this.size * 0.15, this.size * 0.85),
      radius,
      rng,
    );
    if (!spot) return null;
    const food = new FoodSource(spot.x, spot.y, amount, radius, rng);
    this.foods.push(food);
    return food;
  }

  /** Keeps the food source count in sync with a target (adds or trims). */
  setFoodCount(count: number, amount: number, rng: RNG): void {
    while (this.foods.length > count) this.foods.pop();
    while (this.foods.length < count) {
      if (!this.addRandomFood(amount, rng)) break;
    }
  }

  get foodLeft(): number {
    let total = 0;
    for (const f of this.foods) total += f.amount;
    return total;
  }

  get aliveFoods(): number {
    let count = 0;
    for (const f of this.foods) if (!f.gone) count++;
    return count;
  }

  /** Removes depleted sources. Returns true when something was removed. */
  sweepDepleted(): boolean {
    let any = false;
    for (let i = 0; i < this.foods.length; i++) {
      if (this.foods[i].gone) {
        any = true;
        break;
      }
    }
    if (!any) return false;
    this.foods = this.foods.filter((f) => !f.gone);
    return true;
  }
}

/** Clamp helper re-exported for renderers that need safe world coordinates. */
export function clampWorld(v: number, size: number): number {
  return clamp(v, 0, size);
}

export type { FoodSpec };
