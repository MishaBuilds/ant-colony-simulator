import { clamp } from '../core/math.js';

/**
 * View over the world: which point sits at the viewport centre and how many
 * screen pixels one world unit takes. All input is in CSS pixels.
 */
export class Camera {
  /** World point at the centre of the viewport. */
  x = 0;
  y = 0;
  /** Screen pixels per world unit. */
  scale = 1;
  /** Scale that exactly fits the world — the reference for zoom limits. */
  fitScale = 1;

  private minScale = 0.1;
  private maxScale = 100;
  private worldSize = 100;

  fit(viewW: number, viewH: number, worldSize: number): void {
    this.refit(viewW, viewH, worldSize, false);
  }

  private refreshLimits(): void {
    this.minScale = Math.max(0.0001, this.fitScale * 0.45);
    this.maxScale = Math.max(this.fitScale * 150, 8);
  }

  clamp(): void {
    this.scale = clamp(this.scale, this.minScale, this.maxScale);
    // keep the world on screen (allow a small over-pan)
    const slack = this.worldSize * 0.6;
    this.x = clamp(this.x, -slack, this.worldSize + slack);
    this.y = clamp(this.y, -slack, this.worldSize + slack);
  }

  /**
   * Re-anchors the fit reference after a viewport change.
   * `keepView` is true when the user has already zoomed or panned manually.
   */
  refit(viewW: number, viewH: number, worldSize: number, keepView: boolean): void {
    this.worldSize = worldSize;
    const s = (Math.min(viewW, viewH) * 0.94) / worldSize;
    this.fitScale = s;
    this.refreshLimits();
    if (!keepView) {
      this.scale = s;
      this.x = worldSize / 2;
      this.y = worldSize / 2;
    }
    this.clamp();
  }

  /** Zoom keeping the world point under the cursor fixed. */
  zoomAt(screenX: number, screenY: number, factor: number, viewW: number, viewH: number): void {
    const before = this.screenToWorld(screenX, screenY, viewW, viewH);
    this.scale = clamp(this.scale * factor, this.minScale, this.maxScale);
    const after = this.screenToWorld(screenX, screenY, viewW, viewH);
    this.x += before.x - after.x;
    this.y += before.y - after.y;
    this.clamp();
  }

  pan(deltaScreenX: number, deltaScreenY: number): void {
    this.x -= deltaScreenX / this.scale;
    this.y -= deltaScreenY / this.scale;
    this.clamp();
  }

  screenToWorld(screenX: number, screenY: number, viewW: number, viewH: number): { x: number; y: number } {
    return {
      x: (screenX - viewW / 2) / this.scale + this.x,
      y: (screenY - viewH / 2) / this.scale + this.y,
    };
  }

  worldToScreen(worldX: number, worldY: number, viewW: number, viewH: number): { x: number; y: number } {
    return {
      x: (worldX - this.x) * this.scale + viewW / 2,
      y: (worldY - this.y) * this.scale + viewH / 2,
    };
  }

  /** Zoom percentage relative to the fitted view. */
  get zoomPercent(): number {
    if (this.fitScale <= 0) return 100;
    return Math.round((this.scale / this.fitScale) * 100);
  }
}
