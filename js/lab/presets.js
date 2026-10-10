function fmt(n) {
    return String(n);
}
/**
 * Three meaningful starting points. Every value maps 1:1 onto a real
 * simulation parameter (see Simulation.tick / PheromoneField.maintain),
 * so applying a preset always changes colony behaviour, not just labels.
 */
export const LAB_PRESETS = [
    {
        key: 'balanced',
        label: 'Balanced search',
        hint: 'Even trade-off: trails form reliably but exploration continues.',
        patch: {
            pheromoneStrength: 0.06,
            evaporation: 0.0025,
            detectionRadius: 6,
            following: 0.85,
            randomness: 0.45,
            antSpeed: 0.3,
        },
    },
    {
        key: 'explorer',
        label: 'Intense exploration',
        hint: 'Weak fast-fading trails, low following, high wander: the colony maps the whole arena before committing.',
        patch: {
            pheromoneStrength: 0.03,
            evaporation: 0.006,
            detectionRadius: 8,
            following: 0.45,
            randomness: 1.0,
            antSpeed: 0.34,
        },
    },
    {
        key: 'highway',
        label: 'Fast reinforcement',
        hint: 'Strong slow-fading trails, near-deterministic following: first success locks in a highway quickly.',
        patch: {
            pheromoneStrength: 0.12,
            evaporation: 0.0012,
            detectionRadius: 6,
            following: 0.95,
            randomness: 0.25,
            antSpeed: 0.3,
        },
    },
];
export function presetByKey(key) {
    return LAB_PRESETS.find((p) => p.key === key) ?? null;
}
export function describePatch(patch) {
    return Object.entries(patch)
        .map(([k, v]) => `${k}=${fmt(v)}`)
        .join(', ');
}
