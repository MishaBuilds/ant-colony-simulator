import { clamp, dist2, fastCos, fastSin, TAU } from '../core/math.js';
import { RNG } from '../core/rng.js';
import { createLayout, FOOD_AMOUNT } from '../config/scenarios.js';
import { gridSizeFor, pheroGridFor } from '../config/settings.js';
import { FoodSource } from '../entities/food.js';
import { FOOD_CELLS, World } from '../world/world.js';
import { Ant, DECISION, STATE_RETURNING, STATE_SEARCHING } from './ant.js';
import { Metrics } from './metrics.js';
import { PheromoneField } from './pheromone.js';
export const STEP_SECONDS = 1 / 60;
export const SENSOR_SPREAD = 0.7; // angle between the three sensors (rad)
const FOLLOW_THRESHOLD = 0.012; // minimum pheromone worth reacting to
const MAX_TURN = 0.38; // steering limit (rad per step)
const ANT_CELLS = 1.1; // ant radius, in grid cells
const HOME_REF_FACTOR = 0.6; // home gradient reference distance (× map size)
const DIFFUSION = 0.05; // pheromone smoothing per step
const REC_CAPACITY = 1024; // recorded points of a candidate route
/* Precomputed trig. The hot loop steers unit vectors by rotation instead of
   calling Math.cos/sin/atan2 per ant per step — the single biggest win in
   the simulation loop. */
const COS_SPREAD = Math.cos(SENSOR_SPREAD);
const SIN_SPREAD = Math.sin(SENSOR_SPREAD);
const COS_MAX_TURN = Math.cos(MAX_TURN);
const SIN_MAX_TURN = Math.sin(MAX_TURN);
/** World-grid cell index of a point, or -1 when it lies outside the world. */
function cellAt(size, n, inv, wx, wy) {
    if (!(wx >= 0 && wy >= 0 && wx < size && wy < size))
        return -1;
    return ((wy * inv) | 0) * n + ((wx * inv) | 0);
}
/**
 * The DOM-free simulation core: world, ants, pheromone fields and metrics.
 * One `tick()` is exactly one logical step; `maintain()` applies field decay
 * for the number of steps that were ticked (cheap at high playback speeds).
 */
export class Simulation {
    settings;
    metrics = new Metrics();
    world;
    ants = [];
    foodPhero;
    homePhero;
    layout = null;
    seed = 0;
    rng;
    /** Shortest path found so far, kept as a polyline for the renderer. */
    bestPath = null;
    antId = 0;
    initialFoods = [];
    /** Food units per source for the current colony size. */
    foodUnit = FOOD_AMOUNT;
    recAnt = null;
    recLen = 0;
    recX = new Float32Array(REC_CAPACITY);
    recY = new Float32Array(REC_CAPACITY);
    constructor(settings) {
        this.settings = settings;
        const n = gridSizeFor(settings.mapSize);
        const pn = pheroGridFor(settings.mapSize);
        this.world = new World(settings.mapSize, n);
        this.foodPhero = new PheromoneField(pn, settings.mapSize / pn);
        this.homePhero = new PheromoneField(pn, settings.mapSize / pn);
        this.rng = new RNG(1);
        this.rebuild();
    }
    // ----------------------------------------------------------------- lifecycle
    /** Generates a brand new map (layout + food + obstacles) and resets state. */
    rebuild(seed) {
        const s = this.settings;
        this.seed = seed ?? ((Math.random() * 0xffffffff) >>> 0);
        this.rng = new RNG(this.seed);
        const n = gridSizeFor(s.mapSize);
        const pn = pheroGridFor(s.mapSize);
        if (this.world.size !== s.mapSize || this.world.n !== n) {
            this.world = new World(s.mapSize, n);
            this.foodPhero = new PheromoneField(pn, s.mapSize / pn);
            this.homePhero = new PheromoneField(pn, s.mapSize / pn);
        }
        // Scale food with the colony: a huge colony would otherwise strip the map
        // bare in the first minutes and every trail would die with it.
        this.foodUnit = FOOD_AMOUNT * Math.max(1, Math.round(s.antCount / 250));
        this.layout = createLayout(s.scenario, {
            size: s.mapSize,
            foodCount: Math.round(s.foodCount),
            obstacleCount: Math.round(s.obstacleCount),
            foodAmount: this.foodUnit,
            rng: this.rng,
        });
        this.world.loadLayout(this.layout, this.rng);
        this.initialFoods = this.world.foods.map((f) => ({ x: f.x, y: f.y, amount: f.maxAmount }));
        this.resetState();
    }
    /** Restores the current map: full food, empty trails, ants back at the nest. */
    reset() {
        const wanted = gridSizeFor(this.settings.mapSize);
        if (this.world.size !== this.settings.mapSize || this.world.n !== wanted) {
            this.rebuild();
            return;
        }
        this.resetState();
    }
    resetState() {
        const w = this.world;
        this.foodPhero.clear();
        this.homePhero.clear();
        const radius = FOOD_CELLS * w.cell;
        w.foods = this.initialFoods.map((f) => new FoodSource(f.x, f.y, f.amount, radius, this.rng));
        this.ants = [];
        this.antId = 0;
        const count = Math.round(this.settings.antCount);
        for (let i = 0; i < count; i++)
            this.spawnAnt();
        this.metrics.reset();
        this.metrics.ants = this.ants.length;
        this.metrics.foodLeft = w.foodLeft;
        this.bestPath = null;
        this.recAnt = null;
        this.recLen = 0;
    }
    spawnAnt() {
        const w = this.world;
        const ant = new Ant(this.antId++, this.rng.range(-0.6, 0.6), this.rng.range(0.88, 1.12));
        const a = this.rng.range(0, TAU);
        const r = this.rng.range(0, w.nest.r * 0.9);
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        ant.x = w.nest.x + ca * r;
        ant.y = w.nest.y + sa * r;
        ant.ux = ca;
        ant.uy = sa;
        this.ants.push(ant);
        return ant;
    }
    // ------------------------------------------------------------ live settings
    setAntCount(count) {
        if (!Number.isFinite(count))
            return;
        const target = Math.max(0, Math.round(count));
        while (this.ants.length > target)
            this.ants.pop();
        while (this.ants.length < target)
            this.spawnAnt();
        if (this.recAnt && !this.ants.includes(this.recAnt))
            this.recAnt = null;
        this.metrics.ants = this.ants.length;
    }
    setFoodCount(count) {
        if (!Number.isFinite(count))
            return;
        this.world.setFoodCount(Math.round(count), this.foodUnit, this.rng);
        this.metrics.foodLeft = this.world.foodLeft;
    }
    // --------------------------------------------------------------- simulation
    /** One logical step: ants sense, decide, move, deposit, pick up and deliver. */
    tick() {
        const w = this.world;
        const s = this.settings;
        // world (obstacle) grid geometry
        const size = w.size;
        const n = w.n;
        const inv = w.invCell;
        const cell = w.cell;
        // pheromone grid geometry (may be coarser than the obstacle grid)
        const pn = this.foodPhero.n;
        const pinv = this.foodPhero.invCell;
        const sense = s.detectionRadius * cell;
        const stepLen = s.antSpeed * cell;
        const strength = s.pheromoneStrength;
        const randomness = s.randomness;
        const following = s.following;
        const antR = ANT_CELLS * cell;
        const nestX = w.nest.x;
        const nestY = w.nest.y;
        const nestR2 = w.nest.r * w.nest.r;
        const homeRef = Math.max(1, size * HOME_REF_FACTOR);
        const probe = sense * 1.25;
        const walls = w.walls;
        const ants = this.ants;
        const foodData = this.foodPhero.data;
        const homeData = this.homePhero.data;
        const rng = this.rng;
        const metrics = this.metrics;
        for (let i = 0; i < ants.length; i++) {
            const ant = ants[i];
            const ax = ant.x;
            const ay = ant.y;
            let dirX = ant.ux;
            let dirY = ant.uy;
            // --- local perception: three sensors rotated around the heading ---
            const lx = ax + (dirX * COS_SPREAD + dirY * SIN_SPREAD) * sense;
            const ly = ay + (dirY * COS_SPREAD - dirX * SIN_SPREAD) * sense;
            const cx = ax + dirX * sense;
            const cy = ay + dirY * sense;
            const rx = ax + (dirX * COS_SPREAD - dirY * SIN_SPREAD) * sense;
            const ry = ay + (dirY * COS_SPREAD + dirX * SIN_SPREAD) * sense;
            const searching = ant.state === STATE_SEARCHING;
            const sdata = searching ? foodData : homeData;
            // one index lookup per sensor serves both the wall test and the sample
            const iL = cellAt(size, n, inv, lx, ly);
            const iC = cellAt(size, n, inv, cx, cy);
            const iR = cellAt(size, n, inv, rx, ry);
            const rawL = iL < 0 ? 0 : sdata[iL];
            const rawC = iC < 0 ? 0 : sdata[iC];
            const rawR = iR < 0 ? 0 : sdata[iR];
            const vL = iL < 0 || walls[iL] === 1 ? -1 : rawL;
            const vC = iC < 0 || walls[iC] === 1 ? -1 : rawC;
            const vR = iR < 0 || walls[iR] === 1 ? -1 : rawR;
            ant.senseL = rawL;
            ant.senseC = rawC;
            ant.senseR = rawR;
            // --- decide where to go next (target is a unit vector) ---
            let tX = dirX;
            let tY = dirY;
            let decision = DECISION.WANDER;
            if (searching) {
                const best = vC > vL ? (vC > vR ? vC : vR) : vL > vR ? vL : vR;
                if (best > FOLLOW_THRESHOLD && rng.next() < following) {
                    if (vL >= vC && vL >= vR) {
                        tX = dirX * COS_SPREAD + dirY * SIN_SPREAD;
                        tY = dirY * COS_SPREAD - dirX * SIN_SPREAD;
                    }
                    else if (vR >= vC && vR > vL) {
                        tX = dirX * COS_SPREAD - dirY * SIN_SPREAD;
                        tY = dirX * SIN_SPREAD + dirY * COS_SPREAD;
                    }
                    decision = DECISION.TRAIL;
                }
                else if (vC < 0) {
                    if (vL > vR) {
                        tX = dirX * COS_SPREAD + dirY * SIN_SPREAD;
                        tY = dirY * COS_SPREAD - dirX * SIN_SPREAD;
                    }
                    else {
                        tX = dirX * COS_SPREAD - dirY * SIN_SPREAD;
                        tY = dirX * SIN_SPREAD + dirY * COS_SPREAD;
                    }
                    decision = DECISION.AVOID;
                }
                else {
                    const delta = ant.wanderBias * 0.1 * randomness + (rng.next() - 0.5) * 0.8 * randomness;
                    const c = fastCos(delta);
                    const si = fastSin(delta);
                    const nx = dirX * c - dirY * si;
                    const ny = dirX * si + dirY * c;
                    tX = nx;
                    tY = ny;
                    decision = DECISION.WANDER;
                }
            }
            else {
                const ndx = nestX - ax;
                const ndy = nestY - ay;
                const ndl = Math.sqrt(ndx * ndx + ndy * ndy);
                const nX = ndl > 1e-6 ? ndx / ndl : 1;
                const nY = ndl > 1e-6 ? ndy / ndl : 0;
                const probeN = cellAt(size, n, inv, ax + nX * probe, ay + nY * probe);
                const probeA = cellAt(size, n, inv, ax + dirX * probe, ay + dirY * probe);
                const nestBlocked = probeN < 0 || walls[probeN] === 1;
                const aheadBlocked = probeA < 0 || walls[probeA] === 1;
                if (!nestBlocked && !aheadBlocked) {
                    const delta = (rng.next() - 0.5) * 0.12 * randomness;
                    const c = fastCos(delta);
                    const si = fastSin(delta);
                    tX = nX * c - nY * si;
                    tY = nX * si + nY * c;
                    decision = DECISION.HOME;
                }
                else {
                    const best = vC > vL ? (vC > vR ? vC : vR) : vL > vR ? vL : vR;
                    if (best > FOLLOW_THRESHOLD && rng.next() < following) {
                        if (vL >= vC && vL >= vR) {
                            tX = dirX * COS_SPREAD + dirY * SIN_SPREAD;
                            tY = dirY * COS_SPREAD - dirX * SIN_SPREAD;
                        }
                        else if (vR >= vC && vR > vL) {
                            tX = dirX * COS_SPREAD - dirY * SIN_SPREAD;
                            tY = dirX * SIN_SPREAD + dirY * COS_SPREAD;
                        }
                        decision = DECISION.HOME_TRAIL;
                    }
                    else {
                        // slide along the wall, preferring the side that leans toward the
                        // nest — sign of the angle from heading to nest, no atan2 needed
                        const sgn = dirX * nY - dirY * nX >= 0 ? 1 : -1;
                        let pX;
                        let pY;
                        if (sgn > 0) {
                            pX = dirX * COS_SPREAD - dirY * SIN_SPREAD;
                            pY = dirX * SIN_SPREAD + dirY * COS_SPREAD;
                        }
                        else {
                            pX = dirX * COS_SPREAD + dirY * SIN_SPREAD;
                            pY = dirY * COS_SPREAD - dirX * SIN_SPREAD;
                        }
                        const idxP = cellAt(size, n, inv, ax + pX * sense, ay + pY * sense);
                        if (idxP >= 0 && walls[idxP] !== 1) {
                            tX = pX;
                            tY = pY;
                        }
                        else {
                            let oX;
                            let oY;
                            if (sgn > 0) {
                                oX = dirX * COS_SPREAD + dirY * SIN_SPREAD;
                                oY = dirY * COS_SPREAD - dirX * SIN_SPREAD;
                            }
                            else {
                                oX = dirX * COS_SPREAD - dirY * SIN_SPREAD;
                                oY = dirX * SIN_SPREAD + dirY * COS_SPREAD;
                            }
                            const idxO = cellAt(size, n, inv, ax + oX * sense, ay + oY * sense);
                            if (idxO >= 0 && walls[idxO] !== 1) {
                                tX = oX;
                                tY = oY;
                            }
                            else {
                                const delta = rng.next() - 0.5;
                                const c = fastCos(delta);
                                const si = fastSin(delta);
                                tX = -(dirX * c - dirY * si);
                                tY = -(dirX * si + dirY * c);
                            }
                        }
                        decision = DECISION.AVOID;
                    }
                }
            }
            ant.decision = decision;
            // --- steer toward the target with a turn limit (vector space) ---
            const dot = dirX * tX + dirY * tY;
            if (dot >= COS_MAX_TURN) {
                dirX = tX;
                dirY = tY;
            }
            else {
                const cross = dirX * tY - dirY * tX;
                const sc = cross >= 0 ? SIN_MAX_TURN : -SIN_MAX_TURN;
                const nx = dirX * COS_MAX_TURN - dirY * sc;
                const ny = dirX * sc + dirY * COS_MAX_TURN;
                dirX = nx;
                dirY = ny;
            }
            // --- move with wall collision resolution ---
            const spd = stepLen * ant.speedJitter;
            const dx = dirX * spd;
            const dy = dirY * spd;
            const px = dirX * antR;
            const py = dirY * antR;
            let x = ax;
            let y = ay;
            let moved = 0;
            let idx = cellAt(size, n, inv, x + dx + px, y + dy + py);
            if (!(idx >= 0 && walls[idx] === 1)) {
                x += dx;
                y += dy;
                moved = spd;
            }
            else {
                idx = cellAt(size, n, inv, x + dx + px, y + py);
                if (!(idx >= 0 && walls[idx] === 1)) {
                    x += dx;
                    moved = spd * 0.7;
                }
                else {
                    idx = cellAt(size, n, inv, x + px, y + dy + py);
                    if (!(idx >= 0 && walls[idx] === 1)) {
                        y += dy;
                        moved = spd * 0.7;
                    }
                    else {
                        const delta = (rng.next() - 0.5) * 1.2;
                        const c = fastCos(delta);
                        const si = fastSin(delta);
                        const nx = dirX * c - dirY * si;
                        const ny = dirX * si + dirY * c;
                        dirX = -nx;
                        dirY = -ny;
                    }
                }
            }
            // --- stay inside the world (reflect at the border) ---
            const m = antR;
            if (x < m) {
                x = m;
                if (dirX < 0)
                    dirX = -dirX;
            }
            else if (x > size - m) {
                x = size - m;
                if (dirX > 0)
                    dirX = -dirX;
            }
            if (y < m) {
                y = m;
                if (dirY < 0)
                    dirY = -dirY;
            }
            else if (y > size - m) {
                y = size - m;
                if (dirY > 0)
                    dirY = -dirY;
            }
            // numerical safety net — a bad value can never remove an ant from play
            const norm2 = dirX * dirX + dirY * dirY;
            if (!(x >= 0 && x <= size && y >= 0 && y <= size) || !(norm2 >= 0.5 && norm2 <= 2)) {
                x = nestX;
                y = nestY;
                const a = rng.range(0, TAU);
                dirX = Math.cos(a);
                dirY = Math.sin(a);
                moved = 0;
            }
            ant.x = x;
            ant.y = y;
            // --- record a candidate route for the "best route" overlay ---
            if (this.recAnt === ant && this.recLen < REC_CAPACITY) {
                this.recX[this.recLen] = x;
                this.recY[this.recLen] = y;
                this.recLen++;
            }
            // --- deposit pheromone ---
            if (x >= 0 && x < size && y >= 0 && y < size) {
                const ci = ((y * pinv) | 0) * pn + ((x * pinv) | 0);
                if (searching) {
                    const ddx = x - nestX;
                    const ddy = y - nestY;
                    const d = Math.sqrt(ddx * ddx + ddy * ddy);
                    const dep = strength * clamp(1 - d / homeRef, 0.08, 1);
                    const v = homeData[ci] + dep;
                    homeData[ci] = v > 1 ? 1 : v;
                }
                else {
                    const ddx = x - ant.foodX;
                    const ddy = y - ant.foodY;
                    const d = Math.sqrt(ddx * ddx + ddy * ddy);
                    const routeLen = ant.routeLen < 1 ? 1 : ant.routeLen;
                    const dep = strength * clamp(1 - d / routeLen, 0.15, 1);
                    const v = foodData[ci] + dep;
                    foodData[ci] = v > 1 ? 1 : v;
                    ant.carryDist += moved;
                }
            }
            // --- pick up food / deliver it ---
            if (searching) {
                const foods = w.foods;
                for (let k = 0; k < foods.length; k++) {
                    const f = foods[k];
                    if (f.gone)
                        continue;
                    const reach = f.radius + antR;
                    const fdx = x - f.x;
                    if (fdx > reach || fdx < -reach)
                        continue;
                    const fdy = y - f.y;
                    if (fdy > reach || fdy < -reach)
                        continue;
                    if (fdx * fdx + fdy * fdy <= reach * reach) {
                        f.take(1);
                        ant.state = STATE_RETURNING;
                        ant.hasFood = true;
                        ant.foodX = f.x;
                        ant.foodY = f.y;
                        ant.routeLen = Math.max(1, Math.sqrt(dist2(f.x, f.y, nestX, nestY)));
                        ant.carryDist = 0;
                        dirX = -dirX;
                        dirY = -dirY;
                        ant.decision = DECISION.HOME;
                        if (metrics.firstFind === null)
                            metrics.firstFind = metrics.time;
                        this.beginRecord(ant);
                        break;
                    }
                }
            }
            else {
                const ddx = x - nestX;
                const ddy = y - nestY;
                if (ddx * ddx + ddy * ddy <= nestR2) {
                    metrics.delivered++;
                    metrics.recordDelivery(ant.carryDist);
                    this.endRecord(ant);
                    ant.state = STATE_SEARCHING;
                    ant.hasFood = false;
                    ant.carryDist = 0;
                    const delta = (rng.next() - 0.5) * 0.9;
                    const c = fastCos(delta);
                    const si = fastSin(delta);
                    const nx = dirX * c - dirY * si;
                    const ny = dirX * si + dirY * c;
                    dirX = -nx;
                    dirY = -ny;
                }
            }
            // publish the (possibly flipped) heading
            ant.ux = dirX;
            ant.uy = dirY;
        }
        metrics.steps++;
        metrics.time += STEP_SECONDS;
        metrics.ants = ants.length;
        metrics.foodLeft = w.foodLeft;
    }
    /** Field decay/diffusion for `steps` ticks — called once per rendered frame. */
    maintain(steps) {
        if (steps <= 0)
            return;
        const rate = this.settings.evaporation;
        this.foodPhero.evaporate(steps, rate);
        this.homePhero.evaporate(steps, rate);
        this.foodPhero.diffuse(steps, DIFFUSION);
        this.homePhero.diffuse(steps, DIFFUSION);
        this.world.sweepDepleted();
    }
    /** Exactly one logical step including field maintenance (the Step button). */
    singleStep() {
        this.tick();
        this.maintain(1);
    }
    // ------------------------------------------------------------ route capture
    beginRecord(ant) {
        if (this.recAnt)
            return;
        this.recAnt = ant;
        this.recLen = 1;
        this.recX[0] = ant.x;
        this.recY[0] = ant.y;
    }
    endRecord(ant) {
        if (this.recAnt !== ant)
            return;
        const best = this.metrics.bestRoute;
        if (this.recLen > 4 && (best === null || ant.carryDist <= best * 1.1)) {
            this.bestPath = {
                x: this.recX.slice(0, this.recLen),
                y: this.recY.slice(0, this.recLen),
                len: this.recLen,
            };
        }
        this.recAnt = null;
        this.recLen = 0;
    }
}
