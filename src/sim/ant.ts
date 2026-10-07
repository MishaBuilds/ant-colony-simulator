export const STATE_SEARCHING = 0;
export const STATE_RETURNING = 1;
export type AntState = 0 | 1;

export const DECISION = {
  WANDER: 0,
  TRAIL: 1,
  AVOID: 2,
  HOME: 3,
  HOME_TRAIL: 4,
} as const;

export type Decision = (typeof DECISION)[keyof typeof DECISION];

export const DECISION_LABEL: Record<number, string> = {
  0: 'Random exploration',
  1: 'Following stronger trail',
  2: 'Avoiding obstacle',
  3: 'Walking straight home',
  4: 'Following home trail',
};

export const DECISION_SHORT: Record<number, string> = {
  0: 'explore',
  1: 'follow trail',
  2: 'avoid wall',
  3: 'go home',
  4: 'home trail',
};

/**
 * One ant. Deliberately a plain object allocated once per ant — the hot loop
 * only mutates existing fields, so no garbage is produced during simulation.
 *
 * The heading is stored as a unit vector (`ux`, `uy`) rather than an angle:
 * steering, sensing and movement become pure multiplies, which keeps the
 * per-ant hot loop free of `Math.cos` / `Math.sin` / `Math.atan2`.
 */
export class Ant {
  readonly id: number;

  x = 0;
  y = 0;
  /** Unit heading vector. Source of truth for orientation. */
  ux = 1;
  uy = 0;

  /** Heading in radians — display/inspection only (computed on demand). */
  get dir(): number {
    return Math.atan2(this.uy, this.ux);
  }

  state: AntState = STATE_SEARCHING;
  hasFood = false;

  /** Where this ant found its food (drives the trail gradient it lays). */
  foodX = 0;
  foodY = 0;
  routeLen = 1;
  carryDist = 0;

  /** Raw pheromone sampled by the three sensors — kept for the inspector. */
  senseL = 0;
  senseC = 0;
  senseR = 0;

  decision: Decision = DECISION.WANDER;

  /** Per-ant personality: some wander left-biased, some right-biased. */
  readonly wanderBias: number;
  readonly speedJitter: number;

  constructor(id: number, wanderBias = 0, speedJitter = 1) {
    this.id = id;
    this.wanderBias = wanderBias;
    this.speedJitter = speedJitter;
  }

  get isReturning(): boolean {
    return this.state === STATE_RETURNING;
  }
}
