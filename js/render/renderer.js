import { SENSOR_SPREAD } from '../sim/simulation.js';
import { DECISION, STATE_SEARCHING } from '../sim/ant.js';
/* ------------------------------------------------------------------ palette */
const BG_OUTSIDE = '#06080a';
const BG_PLATE = '#0b0f13';
const GRID_COLOR = 'rgba(214, 232, 245, 0.035)';
const GRID_COLOR_STRONG = 'rgba(214, 232, 245, 0.06)';
const WALL_FILL = '#141a20';
const WALL_EDGE = '#28323c';
const ANT_SEARCH = 'rgba(184, 199, 214, 0.95)';
const ANT_RETURN = 'rgba(233, 171, 80, 0.95)';
const NEST_COLOR = '#e8a94e';
const FOOD_FILL = '#cfe98d';
const BEST_ROUTE = 'rgba(88, 214, 168, 0.8)';
const TRAIL_FOOD = [64, 224, 172];
const TRAIL_HOME = [104, 146, 255];
/** Intensity response: faint trails stay dim, strong ones saturate. */
const FR = new Uint8Array(256);
const FG = new Uint8Array(256);
const FB = new Uint8Array(256);
const HR = new Uint8Array(256);
const HG = new Uint8Array(256);
const HB = new Uint8Array(256);
for (let i = 0; i < 256; i++) {
    const v = i / 255;
    const g = Math.pow(Math.min(1, v * 1.75), 0.9);
    const out = Math.round(g * 255);
    FR[i] = Math.round((TRAIL_FOOD[0] * out) / 255);
    FG[i] = Math.round((TRAIL_FOOD[1] * out) / 255);
    FB[i] = Math.round((TRAIL_FOOD[2] * out) / 255);
    HR[i] = Math.round((TRAIL_HOME[0] * out) / 255);
    HG[i] = Math.round((TRAIL_HOME[1] * out) / 255);
    HB[i] = Math.round((TRAIL_HOME[2] * out) / 255);
}
const RAY_COLORS = {
    [DECISION.WANDER]: 'rgba(158, 170, 182, 0.7)',
    [DECISION.TRAIL]: 'rgba(88, 214, 168, 0.85)',
    [DECISION.AVOID]: 'rgba(224, 112, 95, 0.9)',
    [DECISION.HOME]: 'rgba(111, 155, 255, 0.8)',
    [DECISION.HOME_TRAIL]: 'rgba(111, 155, 255, 0.8)',
};
/* ---------------------------------------------------------------- renderer */
export class Renderer {
    canvas;
    ctx;
    pherCanvas;
    pherCtx;
    pherImage = null;
    pherN = 0;
    cssW = 1;
    cssH = 1;
    dpr = 1;
    constructor(canvas) {
        this.canvas = canvas;
        const ctx = canvas.getContext('2d', { alpha: false });
        if (!ctx)
            throw new Error('Canvas 2D is not available in this browser');
        this.ctx = ctx;
        this.pherCanvas = document.createElement('canvas');
        const pctx = this.pherCanvas.getContext('2d');
        if (!pctx)
            throw new Error('Canvas 2D is not available in this browser');
        this.pherCtx = pctx;
    }
    resize(cssW, cssH) {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        this.cssW = Math.max(1, Math.round(cssW));
        this.cssH = Math.max(1, Math.round(cssH));
        this.dpr = dpr;
        this.canvas.width = Math.round(this.cssW * dpr);
        this.canvas.height = Math.round(this.cssH * dpr);
    }
    get viewWidth() {
        return this.cssW;
    }
    get viewHeight() {
        return this.cssH;
    }
    render(sim, cam, opts) {
        const ctx = this.ctx;
        const dpr = this.dpr;
        const size = sim.world.size;
        const scale = cam.scale;
        // ---- screen space: clear everything ----
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = BG_OUTSIDE;
        ctx.fillRect(0, 0, this.cssW, this.cssH);
        // ---- world space ----
        ctx.setTransform(scale * dpr, 0, 0, scale * dpr, (this.cssW / 2 - cam.x * scale) * dpr, (this.cssH / 2 - cam.y * scale) * dpr);
        ctx.lineJoin = 'round';
        const unit = 1 / scale; // world units per CSS pixel
        // world plate
        ctx.fillStyle = BG_PLATE;
        ctx.fillRect(0, 0, size, size);
        this.drawGrid(sim, scale, unit);
        this.drawPheromones(sim, sim.settings.pheroView);
        this.drawWalls(sim, unit);
        this.drawNest(sim, opts.time, unit);
        this.drawFoods(sim, unit);
        this.drawBestPath(sim, unit);
        this.drawAnts(sim, scale, unit, opts.showCalc);
        if (opts.selected)
            this.drawSelection(sim, opts.selected, unit);
        // world outline
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.strokeStyle = 'rgba(255,255,255,0.10)';
        ctx.lineWidth = 1;
        const tl = cam.worldToScreen(0, 0, this.cssW, this.cssH);
        ctx.strokeRect(Math.round(tl.x) + 0.5, Math.round(tl.y) + 0.5, Math.round(size * scale), Math.round(size * scale));
        ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
    /* ---------------------------------------------------------------- layers */
    drawGrid(sim, scale, unit) {
        const ctx = this.ctx;
        const size = sim.world.size;
        const candidates = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500];
        let major = candidates[candidates.length - 1];
        for (const c of candidates) {
            if (c * scale >= 64) {
                major = c;
                break;
            }
        }
        const minor = major >= 10 ? major / 5 : major / 2;
        const drawMinor = minor * scale >= 8;
        const stroke = (step, strong) => {
            ctx.strokeStyle = strong ? GRID_COLOR_STRONG : GRID_COLOR;
            ctx.beginPath();
            for (let k = 1; k * step < size; k++) {
                const v = k * step;
                ctx.moveTo(v, 0);
                ctx.lineTo(v, size);
                ctx.moveTo(0, v);
                ctx.lineTo(size, v);
            }
            ctx.stroke();
        };
        ctx.lineWidth = unit;
        if (drawMinor)
            stroke(minor, false);
        stroke(major, true);
    }
    drawPheromones(sim, view) {
        if (view === 'off')
            return;
        const n = sim.foodPhero.n;
        if (n !== this.pherN) {
            this.pherCanvas.width = n;
            this.pherCanvas.height = n;
            this.pherImage = this.pherCtx.createImageData(n, n);
            this.pherN = n;
        }
        const image = this.pherImage;
        if (!image)
            return;
        const withFood = view === 'food' || view === 'both';
        const withHome = view === 'home' || view === 'both';
        const fd = sim.foodPhero.data;
        const hd = sim.homePhero.data;
        const px = image.data;
        const count = n * n;
        for (let i = 0; i < count; i++) {
            let r = 0;
            let g = 0;
            let b = 0;
            if (withFood) {
                const v = fd[i];
                if (v > 0.004) {
                    const t = v >= 1 ? 255 : (v * 255) | 0;
                    r += FR[t];
                    g += FG[t];
                    b += FB[t];
                }
            }
            if (withHome) {
                const v = hd[i];
                if (v > 0.004) {
                    const t = v >= 1 ? 255 : (v * 255) | 0;
                    r += HR[t];
                    g += HG[t];
                    b += HB[t];
                }
            }
            const o = i * 4;
            px[o] = r > 255 ? 255 : r;
            px[o + 1] = g > 255 ? 255 : g;
            px[o + 2] = b > 255 ? 255 : b;
            px[o + 3] = 255;
        }
        this.pherCtx.putImageData(image, 0, 0);
        const ctx = this.ctx;
        const size = sim.world.size;
        ctx.globalCompositeOperation = 'screen';
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(this.pherCanvas, 0, 0, size, size);
        ctx.globalCompositeOperation = 'source-over';
    }
    drawWalls(sim, unit) {
        const ctx = this.ctx;
        ctx.fillStyle = WALL_FILL;
        ctx.strokeStyle = WALL_EDGE;
        ctx.lineWidth = Math.max(1.2 * unit, sim.world.cell * 0.12);
        for (const r of sim.world.rects) {
            ctx.save();
            ctx.translate(r.x, r.y);
            ctx.rotate(r.angle);
            const rad = Math.min(r.w, r.h) * 0.28;
            ctx.beginPath();
            roundRect(ctx, -r.w / 2, -r.h / 2, r.w, r.h, rad);
            ctx.fill();
            ctx.stroke();
            ctx.restore();
        }
    }
    drawNest(sim, time, unit) {
        const ctx = this.ctx;
        const { x, y, r } = sim.world.nest;
        const glow = ctx.createRadialGradient(x, y, r * 0.2, x, y, r * 2.1);
        glow.addColorStop(0, 'rgba(232, 169, 78, 0.26)');
        glow.addColorStop(0.55, 'rgba(232, 169, 78, 0.08)');
        glow.addColorStop(1, 'rgba(232, 169, 78, 0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(x, y, r * 2.1, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#0d1217';
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(232, 169, 78, 0.9)';
        ctx.lineWidth = Math.max(1.4 * unit, r * 0.07);
        ctx.stroke();
        // slow rotating ticks — reads as "the colony is active"
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(time * 0.25);
        ctx.strokeStyle = 'rgba(232, 169, 78, 0.32)';
        ctx.lineWidth = Math.max(1 * unit, r * 0.05);
        const tickR = r * 1.16;
        for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2;
            ctx.beginPath();
            ctx.moveTo(Math.cos(a) * tickR, Math.sin(a) * tickR);
            ctx.lineTo(Math.cos(a) * tickR * 1.14, Math.sin(a) * tickR * 1.14);
            ctx.stroke();
        }
        ctx.restore();
        ctx.fillStyle = NEST_COLOR;
        ctx.beginPath();
        ctx.arc(x, y, r * 0.2, 0, Math.PI * 2);
        ctx.fill();
    }
    drawFoods(sim, unit) {
        const ctx = this.ctx;
        const foods = sim.world.foods;
        for (const f of foods) {
            const R = f.radius;
            const glow = ctx.createRadialGradient(f.x, f.y, R * 0.3, f.x, f.y, R * 2.2);
            glow.addColorStop(0, 'rgba(207, 233, 141, 0.20)');
            glow.addColorStop(1, 'rgba(207, 233, 141, 0)');
            ctx.fillStyle = glow;
            ctx.beginPath();
            ctx.arc(f.x, f.y, R * 2.2, 0, Math.PI * 2);
            ctx.fill();
            // extent ring
            ctx.setLineDash([Math.max(2 * unit, R * 0.18), Math.max(2 * unit, R * 0.16)]);
            ctx.strokeStyle = 'rgba(207, 233, 141, 0.35)';
            ctx.lineWidth = Math.max(1 * unit, R * 0.05);
            ctx.beginPath();
            ctx.arc(f.x, f.y, R, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);
            // seeds
            ctx.fillStyle = FOOD_FILL;
            const count = f.visibleDots;
            const dotR = Math.max(R * 0.16, 0.6 * unit);
            ctx.beginPath();
            for (let i = 0; i < count; i++) {
                const d = f.dot(i);
                ctx.moveTo(f.x + d.x * R + dotR, f.y + d.y * R);
                ctx.arc(f.x + d.x * R, f.y + d.y * R, dotR, 0, Math.PI * 2);
            }
            ctx.fill();
        }
    }
    drawBestPath(sim, unit) {
        const path = sim.bestPath;
        if (!path)
            return;
        const ctx = this.ctx;
        ctx.save();
        ctx.setLineDash([Math.max(5 * unit, 3 * sim.world.cell), Math.max(4 * unit, 2 * sim.world.cell)]);
        ctx.strokeStyle = BEST_ROUTE;
        ctx.lineWidth = Math.max(1.4 * unit, sim.world.cell * 0.22);
        ctx.beginPath();
        ctx.moveTo(path.x[0], path.y[0]);
        for (let i = 1; i < path.len; i++)
            ctx.lineTo(path.x[i], path.y[i]);
        ctx.stroke();
        ctx.restore();
    }
    drawAnts(sim, scale, unit, showCalc) {
        const ctx = this.ctx;
        const ants = sim.ants;
        const cell = sim.world.cell;
        const half = 1.4 * cell;
        const widthWorld = Math.max(1.3, 0.95 * cell * scale) / scale;
        ctx.lineCap = 'round';
        ctx.lineWidth = widthWorld;
        ctx.strokeStyle = ANT_SEARCH;
        ctx.beginPath();
        for (let i = 0; i < ants.length; i++) {
            const a = ants[i];
            if (a.state !== STATE_SEARCHING)
                continue;
            const c = a.ux * half;
            const s = a.uy * half;
            ctx.moveTo(a.x - c, a.y - s);
            ctx.lineTo(a.x + c, a.y + s);
        }
        ctx.stroke();
        ctx.strokeStyle = ANT_RETURN;
        ctx.beginPath();
        for (let i = 0; i < ants.length; i++) {
            const a = ants[i];
            if (a.state === STATE_SEARCHING)
                continue;
            const c = a.ux * half;
            const s = a.uy * half;
            ctx.moveTo(a.x - c, a.y - s);
            ctx.lineTo(a.x + c, a.y + s);
        }
        ctx.stroke();
        if (showCalc)
            this.drawDecisionRays(sim, unit);
    }
    /** SHOW CALCULATION: what each ant is about to do, colour coded. */
    drawDecisionRays(sim, unit) {
        const ctx = this.ctx;
        const ants = sim.ants;
        const ray = 3.4 * sim.world.cell;
        ctx.lineWidth = unit;
        const groups = [[], [], [], []];
        for (let i = 0; i < ants.length; i++) {
            const d = ants[i].decision;
            if (d === DECISION.TRAIL)
                groups[0].push(i);
            else if (d === DECISION.AVOID)
                groups[1].push(i);
            else if (d === DECISION.WANDER)
                groups[2].push(i);
            else
                groups[3].push(i);
        }
        const colors = [
            RAY_COLORS[DECISION.TRAIL],
            RAY_COLORS[DECISION.AVOID],
            RAY_COLORS[DECISION.WANDER],
            RAY_COLORS[DECISION.HOME],
        ];
        for (let g = 0; g < groups.length; g++) {
            const list = groups[g];
            if (!list.length)
                continue;
            ctx.strokeStyle = colors[g];
            ctx.beginPath();
            for (let k = 0; k < list.length; k++) {
                const a = ants[list[k]];
                ctx.moveTo(a.x, a.y);
                ctx.lineTo(a.x + a.ux * ray, a.y + a.uy * ray);
            }
            ctx.stroke();
        }
    }
    drawSelection(sim, ant, unit) {
        const ctx = this.ctx;
        const w = sim.world;
        const sense = sim.settings.detectionRadius * w.cell;
        const cell = w.cell;
        // perception radius
        ctx.save();
        ctx.setLineDash([4 * unit, 5 * unit]);
        ctx.strokeStyle = 'rgba(88, 214, 168, 0.55)';
        ctx.lineWidth = Math.max(1 * unit, cell * 0.1);
        ctx.beginPath();
        ctx.arc(ant.x, ant.y, sense, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        // sensor positions + sampled strength (rotated from the heading vector)
        const values = [ant.senseL, ant.senseC, ant.senseR];
        const cosS = Math.cos(SENSOR_SPREAD);
        const sinS = Math.sin(SENSOR_SPREAD);
        const ux = ant.ux;
        const uy = ant.uy;
        const sensors = [
            [ux * cosS + uy * sinS, uy * cosS - ux * sinS],
            [ux, uy],
            [ux * cosS - uy * sinS, ux * sinS + uy * cosS],
        ];
        ctx.lineWidth = Math.max(1 * unit, cell * 0.08);
        for (let i = 0; i < 3; i++) {
            const sx = ant.x + sensors[i][0] * sense;
            const sy = ant.y + sensors[i][1] * sense;
            const v = values[i];
            ctx.strokeStyle = 'rgba(88, 214, 168, 0.28)';
            ctx.beginPath();
            ctx.moveTo(ant.x, ant.y);
            ctx.lineTo(sx, sy);
            ctx.stroke();
            const intensity = Math.min(1, v * 1.6);
            ctx.fillStyle = `rgba(${Math.round(70 + 150 * intensity)}, ${Math.round(120 + 110 * intensity)}, ${Math.round(150 + 70 * intensity)}, ${0.55 + 0.45 * intensity})`;
            ctx.beginPath();
            ctx.arc(sx, sy, Math.max(3 * unit, cell * 0.42), 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = 'rgba(8, 12, 15, 0.9)';
            ctx.lineWidth = Math.max(1 * unit, cell * 0.1);
            ctx.stroke();
            ctx.lineWidth = Math.max(1 * unit, cell * 0.08);
        }
        // heading
        ctx.strokeStyle = 'rgba(233, 171, 80, 0.95)';
        ctx.lineWidth = Math.max(1.6 * unit, cell * 0.2);
        ctx.beginPath();
        ctx.moveTo(ant.x, ant.y);
        ctx.lineTo(ant.x + ant.ux * cell * 5, ant.y + ant.uy * cell * 5);
        ctx.stroke();
        // ring
        ctx.strokeStyle = 'rgba(88, 214, 168, 0.95)';
        ctx.lineWidth = Math.max(1.5 * unit, cell * 0.18);
        ctx.beginPath();
        ctx.arc(ant.x, ant.y, cell * 2.6, 0, Math.PI * 2);
        ctx.stroke();
    }
}
function roundRect(ctx, x, y, w, h, r) {
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}
