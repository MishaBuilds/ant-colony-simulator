import { MAP_LABEL, SCENARIOS, sanitizeSettings, } from '../config/settings.js';
export function bindControls(settings, actions) {
    const btnStart = el('btnStart');
    const btnStartBig = el('btnStartBig');
    const btnStep = el('btnStep');
    const startHint = el('startHint');
    const selAnts = el('selAnts');
    const selFood = el('selFood');
    const selMap = el('selMap');
    const selScenario = el('selScenario');
    const selPheroView = el('selPheroView');
    const speedSeg = el('speedSeg');
    const speedVal = el('speedVal');
    const hudMap = el('hudMap');
    const hudScenario = el('hudScenario');
    /** Merge a patch into settings, clamping/repairing every value. */
    const apply = (patch) => {
        Object.assign(settings, sanitizeSettings({ ...settings, ...patch }));
        syncLabels();
    };
    function syncLabels() {
        setText('valStrength', settings.pheromoneStrength.toFixed(3));
        setText('valEvap', settings.evaporation.toFixed(4));
        setText('valSense', String(settings.detectionRadius));
        setText('valFollow', settings.following.toFixed(2));
        setText('valRandom', settings.randomness.toFixed(2));
        setText('valSpeed', settings.antSpeed.toFixed(2));
        setText('valObstacles', String(settings.obstacleCount));
        speedVal.textContent = `${settings.speed}×`;
    }
    function syncChips() {
        const label = MAP_LABEL[settings.mapSize];
        hudMap.textContent = `${label ?? 'Custom'} · ${settings.mapSize} × ${settings.mapSize}`;
        const scenario = SCENARIOS.find((s) => s.key === settings.scenario);
        hudScenario.textContent = scenario ? scenario.label : 'Custom';
    }
    /** Click, then drop focus so the space shortcut stays available. */
    const bind = (btn, fn) => {
        btn.addEventListener('click', () => {
            fn();
            btn.blur();
        });
    };
    bind(btnStart, actions.toggleRun);
    bind(btnStartBig, actions.toggleRun);
    bind(btnStep, actions.step);
    bind(el('btnReset'), actions.reset);
    bind(el('btnNewMap'), actions.newMap);
    bind(el('btnFit'), actions.fitCamera);
    bind(el('btnCalc'), actions.toggleCalc);
    bind(el('btnHow'), actions.openHow);
    bind(el('btnClearSel'), actions.onDeselect);
    // --- speed -----------------------------------------------------------------
    speedSeg.addEventListener('click', (e) => {
        const target = e.target.closest('button[data-speed]');
        if (!(target instanceof HTMLButtonElement))
            return;
        const speed = Number(target.dataset.speed);
        if (!Number.isFinite(speed))
            return;
        apply({ speed });
        for (const b of speedSeg.querySelectorAll('button'))
            b.classList.toggle('on', b === target);
    });
    // --- basic -----------------------------------------------------------------
    selAnts.value = String(settings.antCount);
    selAnts.addEventListener('change', () => {
        const n = Number(selAnts.value);
        if (!Number.isFinite(n))
            return;
        apply({ antCount: n });
        actions.onAntCountChange();
    });
    selFood.value = String(settings.foodCount);
    selFood.addEventListener('change', () => {
        const n = Number(selFood.value);
        if (!Number.isFinite(n))
            return;
        apply({ foodCount: n });
        actions.onFoodCountChange();
    });
    selMap.value = String(settings.mapSize);
    selMap.addEventListener('change', () => {
        const n = Number(selMap.value);
        if (!Number.isFinite(n))
            return;
        apply({ mapSize: n });
        syncChips();
        actions.onMapChange();
    });
    selScenario.value = settings.scenario;
    selScenario.addEventListener('change', () => {
        apply({ scenario: selScenario.value });
        syncChips();
        actions.onMapChange();
    });
    selPheroView.value = settings.pheroView;
    selPheroView.addEventListener('change', () => {
        apply({ pheroView: selPheroView.value });
    });
    // --- advanced --------------------------------------------------------------
    const sliders = [
        ['rngStrength', 'pheromoneStrength'],
        ['rngEvap', 'evaporation'],
        ['rngSense', 'detectionRadius'],
        ['rngFollow', 'following'],
        ['rngRandom', 'randomness'],
        ['rngSpeed', 'antSpeed'],
        ['rngObstacles', 'obstacleCount'],
    ];
    for (const [id, key] of sliders) {
        const input = el(id);
        input.value = String(settings[key]);
        input.addEventListener('input', () => {
            const v = Number(input.value);
            if (!Number.isFinite(v))
                return;
            apply({ [key]: v });
            if (key === 'obstacleCount')
                actions.onHint('Obstacle count applies to the next map.');
        });
    }
    syncLabels();
    syncChips();
    return {
        setRunning(running) {
            btnStart.textContent = running ? 'Pause' : 'Start';
            btnStart.classList.toggle('primary', !running);
            startHint.classList.toggle('gone', running);
            btnStep.disabled = running;
        },
        setCalc(on) {
            el('btnCalc').setAttribute('aria-pressed', String(on));
            el('calcFlag').hidden = !on;
            document.getElementById('canvas')?.classList.toggle('picking', on);
        },
        syncChips,
    };
}
function el(id) {
    const node = document.getElementById(id);
    if (!node)
        throw new Error(`Missing element #${id}`);
    return node;
}
function setText(id, value) {
    document.getElementById(id)?.replaceChildren(value);
}
