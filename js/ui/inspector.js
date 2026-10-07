import { DECISION_LABEL, STATE_RETURNING } from '../sim/ant.js';
const DEG = 180 / Math.PI;
/** The selected-ant panel: state, goal, decision and the three sensor values. */
export class Inspector {
    panel = node('inspectPanel');
    id = node('insId');
    state = node('insState');
    food = node('insFood');
    goal = node('insGoal');
    dir = node('insDir');
    speed = node('insSpeed');
    decision = node('insDec');
    field = node('insField');
    barL = node('barL');
    barC = node('barC');
    barR = node('barR');
    update(ant, settings) {
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
function barWidth(value) {
    if (!Number.isFinite(value) || value <= 0)
        return 0;
    return Math.min(100, Math.sqrt(Math.min(1, value)) * 100);
}
function node(id) {
    const el = document.getElementById(id);
    if (!el)
        throw new Error(`Missing element #${id}`);
    return el;
}
