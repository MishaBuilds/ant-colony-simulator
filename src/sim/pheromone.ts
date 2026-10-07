/**
 * A single scalar pheromone field stored on a square grid.
 * Deposits accumulate (capped at 1), the field evaporates exponentially and
 * diffuses slightly so trails read as smooth routes instead of dotted lines.
 */
export class PheromoneField {
  readonly n: number;
  readonly cell: number; // world units per cell
  readonly invCell: number;
  readonly size: number; // world units per side
  readonly data: Float32Array;
  private readonly scratch: Float32Array;

  constructor(n: number, cell: number) {
    this.n = n;
    this.cell = cell;
    this.invCell = 1 / cell;
    this.size = n * cell;
    this.data = new Float32Array(n * n);
    this.scratch = new Float32Array(n * n);
  }

  clear(): void {
    this.data.fill(0);
  }

  /** Add to a cell index (clamped to 1). Negative indexes are ignored. */
  add(index: number, value: number): void {
    if (index < 0) return;
    const v = this.data[index] + value;
    this.data[index] = v > 1 ? 1 : v;
  }

  /** Nearest-cell sample in world coordinates; 0 outside the world. */
  sample(wx: number, wy: number): number {
    if (!(wx >= 0 && wy >= 0 && wx < this.size && wy < this.size)) return 0;
    let cx = (wx * this.invCell) | 0;
    let cy = (wy * this.invCell) | 0;
    if (cx >= this.n) cx = this.n - 1;
    if (cy >= this.n) cy = this.n - 1;
    return this.data[cy * this.n + cx];
  }

  /**
   * Exponential decay for `steps` simulation steps.
   * Applied as a single multiply per cell so high playback speeds stay cheap.
   */
  evaporate(steps: number, rate: number): void {
    if (steps <= 0 || rate <= 0) return;
    const r = rate > 0.5 ? 0.5 : rate;
    const factor = Math.pow(1 - r, steps);
    const d = this.data;
    for (let i = 0; i < d.length; i++) {
      const v = d[i] * factor;
      d[i] = v < 1e-5 ? 0 : v;
    }
  }

  /** 4-neighbour heat diffusion for `steps` simulation steps (bounded). */
  diffuse(steps: number, rate: number): void {
    if (steps <= 0 || rate <= 0) return;
    const k = Math.min(0.5, 1 - Math.pow(1 - Math.min(rate, 0.5), steps));
    if (k < 1e-4) return;

    const n = this.n;
    const a = this.data;
    const b = this.scratch;
    b.set(a);

    for (let y = 1; y < n - 1; y++) {
      const row = y * n;
      for (let x = 1; x < n - 1; x++) {
        const i = row + x;
        const avg = (b[i - 1] + b[i + 1] + b[i - n] + b[i + n]) * 0.25;
        a[i] = b[i] + k * (avg - b[i]);
      }
    }
  }

  /** Highest concentration in the field (diagnostics + tests). */
  peak(): number {
    let max = 0;
    const d = this.data;
    for (let i = 0; i < d.length; i++) if (d[i] > max) max = d[i];
    return max;
  }
}
