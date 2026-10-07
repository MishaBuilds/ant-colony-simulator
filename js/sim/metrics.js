/** Rolling delivery statistics used by the top bar. */
const WINDOW = 24;
export class Metrics {
    steps = 0;
    time = 0;
    delivered = 0;
    foodLeft = 0;
    ants = 0;
    /** Shortest delivery path discovered so far (world units). */
    bestRoute = null;
    /** Moving average of the last deliveries. */
    avgRoute = 0;
    /** Simulation time of the first successful find. */
    firstFind = null;
    recent = [];
    sum = 0;
    recordDelivery(distance) {
        if (!Number.isFinite(distance) || distance <= 0)
            return;
        if (this.bestRoute === null || distance < this.bestRoute)
            this.bestRoute = distance;
        this.recent.push(distance);
        this.sum += distance;
        if (this.recent.length > WINDOW)
            this.sum -= this.recent.shift();
        this.avgRoute = this.sum / this.recent.length;
    }
    reset() {
        this.steps = 0;
        this.time = 0;
        this.delivered = 0;
        this.foodLeft = 0;
        this.bestRoute = null;
        this.avgRoute = 0;
        this.firstFind = null;
        this.recent.length = 0;
        this.sum = 0;
    }
}
export function formatTime(seconds) {
    const s = Math.max(0, Math.floor(seconds));
    const m = Math.floor(s / 60);
    const rest = s % 60;
    return `${m}:${rest < 10 ? '0' : ''}${rest}`;
}
