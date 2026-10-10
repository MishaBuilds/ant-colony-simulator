import { compareFinals } from '../lab/experiments.js';
import { drawChart } from './charts.js';
const STORE_KEY = 'acs2.runs.v1';
const MAX_RUNS = 8;
function el(id) {
    const node = document.getElementById(id);
    if (!node)
        throw new Error(`Missing element #${id}`);
    return node;
}
const METRIC_META = {
    delivered: { label: 'Food delivered', format: fmtInt, lower: false },
    firstFind: { label: 'First find (sim s)', format: fmtTime, lower: true },
    bestRoute: { label: 'Best route (units)', format: fmtNum, lower: true },
    avgRoute: { label: 'Avg route (units)', format: fmtNum, lower: true },
    coverage: { label: 'Explored (share)', format: fmtPct, lower: false },
    rate: { label: 'Rate (units/min)', format: fmtNum, lower: false },
};
function fmtInt(v) {
    return v === null ? '—' : new Intl.NumberFormat('en-US').format(Math.round(v));
}
function fmtNum(v) {
    return v === null ? '—' : String(Math.round(v * 100) / 100);
}
function fmtTime(v) {
    if (v === null)
        return '—';
    const m = Math.floor(v / 60);
    const s = Math.floor(v % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
}
function fmtPct(v) {
    return v === null ? '—' : `${(v * 100).toFixed(1)}%`;
}
/**
 * Saved-runs store + A/B comparison. Snapshots live in memory and in
 * localStorage (no server). Charts are painted on demand with plain canvas.
 */
export class RunsPanel {
    cb;
    runs = [];
    selA = '';
    selB = '';
    constructor(cb) {
        this.cb = cb;
        this.load();
    }
    get list() {
        return this.runs;
    }
    add(snapshot) {
        this.runs.unshift(snapshot);
        if (this.runs.length > MAX_RUNS)
            this.runs.length = MAX_RUNS;
        if (!this.selA)
            this.selA = snapshot.id;
        else if (!this.selB)
            this.selB = snapshot.id;
        else {
            this.selA = this.selB;
            this.selB = snapshot.id;
        }
        this.persist();
        this.render();
        this.cb.onHint(`Snapshot “${snapshot.label}” saved. Pick A and B to compare.`);
    }
    clear() {
        this.runs = [];
        this.selA = '';
        this.selB = '';
        this.persist();
        this.render();
    }
    remove(id) {
        this.runs = this.runs.filter((r) => r.id !== id);
        if (this.selA === id)
            this.selA = '';
        if (this.selB === id)
            this.selB = '';
        this.persist();
        this.render();
    }
    bind() {
        el('btnClearRuns').addEventListener('click', (e) => {
            this.clear();
            this.cb.onHint('Saved runs cleared.');
            e.currentTarget.blur?.();
        });
        el('selRunA').addEventListener('change', (e) => {
            this.selA = e.target.value;
            this.renderCompare();
        });
        el('selRunB').addEventListener('change', (e) => {
            this.selB = e.target.value;
            this.renderCompare();
        });
        window.addEventListener('resize', () => this.renderCompare());
        this.render();
    }
    load() {
        try {
            const raw = localStorage.getItem(STORE_KEY);
            if (!raw)
                return;
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                this.runs = parsed.filter((r) => r && Array.isArray(r.samples) && r.final).slice(0, MAX_RUNS);
                if (this.runs[0])
                    this.selA = this.runs[0].id;
                if (this.runs[1])
                    this.selB = this.runs[1].id;
            }
        }
        catch {
            this.runs = [];
        }
    }
    persist() {
        try {
            localStorage.setItem(STORE_KEY, JSON.stringify(this.runs));
        }
        catch {
            /* storage full or blocked — memory copy still works */
        }
    }
    find(id) {
        return this.runs.find((r) => r.id === id);
    }
    render() {
        const list = el('runsList');
        list.replaceChildren();
        if (this.runs.length === 0) {
            const p = document.createElement('p');
            p.className = 'mini-hint';
            p.textContent = 'No saved runs yet. Run the colony, then “Save snapshot” to freeze this experiment for comparison.';
            list.appendChild(p);
        }
        for (const run of this.runs) {
            const row = document.createElement('div');
            row.className = 'run-row';
            const info = document.createElement('div');
            info.className = 'run-info';
            const title = document.createElement('strong');
            title.textContent = run.label;
            const sub = document.createElement('span');
            const when = run.createdAt.slice(11, 19);
            sub.textContent = `${fmtInt(run.final.delivered)} delivered · ${fmtPct(run.final.coverage)} explored · seed ${run.seed} · ${when}`;
            info.append(title, sub);
            const del = document.createElement('button');
            del.type = 'button';
            del.className = 'icon-btn';
            del.title = `Delete ${run.label}`;
            del.setAttribute('aria-label', `Delete ${run.label}`);
            del.textContent = '×';
            del.addEventListener('click', () => this.remove(run.id));
            row.append(info, del);
            list.appendChild(row);
        }
        const selA = el('selRunA');
        const selB = el('selRunB');
        for (const sel of [selA, selB]) {
            const prev = sel.value;
            sel.replaceChildren();
            const none = document.createElement('option');
            none.value = '';
            none.textContent = '—';
            sel.appendChild(none);
            for (const run of this.runs) {
                const o = document.createElement('option');
                o.value = run.id;
                o.textContent = `${run.label} (${fmtInt(run.final.delivered)})`;
                sel.appendChild(o);
            }
            sel.value = prev;
        }
        if (!selA.value && this.selA)
            selA.value = this.selA;
        if (!selB.value && this.selB)
            selB.value = this.selB;
        this.selA = selA.value;
        this.selB = selB.value;
        this.renderCompare();
    }
    renderCompare() {
        const a = this.find(this.selA);
        const b = this.find(this.selB);
        const empty = el('compareEmpty');
        const body = el('compareBody');
        empty.hidden = !!(a && b);
        const chartDel = el('chartDelivered');
        const chartCov = el('chartCoverage');
        const legend = el('chartLegend');
        legend.replaceChildren();
        if (!a || !b) {
            body.replaceChildren();
            const ctxs = [chartDel, chartCov].map((c) => c.getContext('2d'));
            for (const ctx of ctxs) {
                if (ctx) {
                    ctx.clearRect(0, 0, chartDel.width || 10, chartDel.height || 10);
                }
            }
            // paint empty placeholders so layout stays stable
            drawChart(chartDel, [], { xLabel: 's', yLabel: 'delivered' });
            drawChart(chartCov, [], { xLabel: 's', yLabel: 'explored' });
            return;
        }
        const COLORS = ['#58d6a8', '#e8a94e'];
        const runs = [a, b];
        drawChart(chartDel, runs.map((r, i) => ({
            label: r.label,
            color: COLORS[i],
            points: r.samples.map((s) => ({ x: s.t, y: s.delivered })),
        })), { xLabel: 'sim s', yLabel: 'food delivered' });
        drawChart(chartCov, runs.map((r, i) => ({
            label: r.label,
            color: COLORS[i],
            points: r.samples.map((s) => ({ x: s.t, y: s.coverage })),
        })), { xLabel: 'sim s', yLabel: 'share explored', percent: true });
        for (let i = 0; i < runs.length; i++) {
            const chip = document.createElement('span');
            chip.className = 'lg';
            const dot = document.createElement('i');
            dot.className = 'sw';
            dot.style.background = COLORS[i];
            chip.append(dot, document.createTextNode(`${i === 0 ? 'A' : 'B'} · ${runs[i].label}`));
            legend.appendChild(chip);
        }
        const deltas = compareFinals(a.final, b.final);
        const table = document.createElement('table');
        table.className = 'cmp-table';
        const head = document.createElement('tr');
        head.innerHTML = '<th>Metric</th><th>A</th><th>B</th><th>B − A</th><th></th>';
        table.appendChild(head);
        for (const d of deltas) {
            const meta = METRIC_META[d.key];
            const tr = document.createElement('tr');
            const tdK = document.createElement('td');
            tdK.textContent = meta.label;
            const tdA = document.createElement('td');
            tdA.textContent = meta.format(d.a);
            const tdB = document.createElement('td');
            tdB.textContent = meta.format(d.b);
            const tdD = document.createElement('td');
            if (d.diff === null)
                tdD.textContent = '—';
            else {
                const sign = d.diff > 0 ? '+' : '';
                tdD.textContent = `${sign}${meta.format(Math.abs(d.diff) * (d.key === 'delivered' ? 1 : 1) * (d.diff < 0 ? -1 : 1))}`;
                if (d.key === 'coverage')
                    tdD.textContent = `${sign}${(d.diff * 100).toFixed(1)}pp`;
                if (d.key === 'firstFind')
                    tdD.textContent = `${sign}${d.diff.toFixed(1)}s`;
            }
            const tdW = document.createElement('td');
            tdW.textContent = d.better === 'tie' ? '=' : d.better === 'n/a' ? '·' : d.better;
            tdW.className = `better-${d.better}`;
            tr.append(tdK, tdA, tdB, tdD, tdW);
            table.appendChild(tr);
        }
        body.replaceChildren(table);
        const note = document.createElement('p');
        note.className = 'mini-hint';
        const betterCountA = deltas.filter((d) => d.better === 'A').length;
        const betterCountB = deltas.filter((d) => d.better === 'B').length;
        note.textContent =
            betterCountA === betterCountB
                ? 'Trade-off: each setup wins on some metrics. Check the curves — speed of first find vs total haul rarely agree.'
                : betterCountB > betterCountA
                    ? `Setup B leads on ${betterCountB} of ${deltas.length} metrics.`
                    : `Setup A leads on ${betterCountA} of ${deltas.length} metrics.`;
        body.appendChild(note);
    }
}
