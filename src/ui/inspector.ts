import { DECISION_LABEL, STATE_RETURNING, type Ant } from '../sim/ant.js';
import type { Settings } from '../config/settings.js';

const DEG = 180 / Math.PI;

/** The selected-ant panel: state, goal, decision and the three sensor values. */
export class Inspector {
  private readonly panel = node('inspectPanel');
  private readonly id = node('insId');
  private readonly state = node('insState');
  private readonly food = node('insFood');
  private readonly goal = node('insGoal');
  private readonly dir = node('insDir');
  private readonly speed = node('insSpeed');
  private readonly decision = node('insDec');
  private readonly field = node('insField');
  private readonly barL = node('barL');
  private readonly barC = node('barC');
  private readonly barR = node('barR');

  update(ant: Ant | null, settings: Settings): void {
    if (!ant) {
      this.panel.hidden = true;
      return;
    }
    this.panel.hidden = false;

    const returning = ant.state === STATE_RETURNING;
    this.id.textContent = `#${ant.id}`;
    this.state.textContent = returning ? 'RETURNING' : 'SEARCHING';
    this.state.className = `v ${returning ? 'state-returning' : 'state-searching'}`;
    this.food.textContent = ant.hasFood ? 'carrying' : 'no';
    this.goal.textContent = returning ? 'Deliver to nest' : 'Find food';

    const degrees = ((ant.dir * DEG) % 360 + 360) % 360;
    this.dir.textContent = `${degrees.toFixed(0)}°`;
    this.speed.textContent = `${(settings.antSpeed * ant.speedJitter).toFixed(2)} cells/step`;
    this.decision.textContent = DECISION_LABEL[ant.decision] ?? '—';
    this.field.textContent = returning ? 'home' : 'food';

    // sqrt scaling: real pheromone values are small but still readable here
    this.barL.style.width = `${barWidth(ant.senseL)}%`;
    this.barC.style.width = `${barWidth(ant.senseC)}%`;
    this.barR.style.width = `${barWidth(ant.senseR)}%`;
  }
}

function barWidth(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(100, Math.sqrt(Math.min(1, value)) * 100);
}

function node(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el;
}
