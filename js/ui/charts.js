/**
 * Minimal dependency-free line chart. Redrawn on demand only (no rAF loop),
 * HiDPI aware, readable at 280 px wide. Honors prefers-reduced-motion by
 * never animating — it simply paints the final state.
 */
export function drawChart(canvas, series, opts) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = canvas.clientWidth || canvas.parentElement?.clientWidth || 280;
    const cssH = canvas.clientHeight || 150;
    canvas.width = Math.max(1, Math.round(cssW * dpr));
    canvas.height = Math.max(1, Math.round(cssH * dpr));
    const ctx = canvas.getContext('2d');
    if (!ctx)
        return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = cssW;
    const H = cssH;
    const padL = 40;
    const padR = 8;
    const padT = 8;
    const padB = 20;
    const iw = Math.max(10, W - padL - padR);
    const ih = Math.max(10, H - padT - padB);
    let maxX = 1;
    let maxY = 1;
    for (const s of series) {
        for (const p of s.points) {
            if (p.x > maxX)
                maxX = p.x;
            if (p.y > maxY)
                maxY = p.y;
        }
    }
    if (opts.percent)
        maxY = Math.max(maxY, 0.05);
    maxX *= 1.04;
    maxY *= 1.12;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0d1218';
    ctx.fillRect(0, 0, W, H);
    // gridlines (3 horizontal)
    ctx.strokeStyle = 'rgba(214,232,245,0.08)';
    ctx.lineWidth = 1;
    ctx.fillStyle = '#626e7a';
    ctx.font = '9px ui-monospace, Menlo, monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let g = 0; g <= 3; g++) {
        const y = padT + (ih * g) / 3;
        ctx.beginPath();
        ctx.moveTo(padL, y);
        ctx.lineTo(padL + iw, y);
        ctx.stroke();
        const v = maxY * (1 - g / 3);
        ctx.fillText(opts.percent ? `${Math.round(v * 100)}%` : fmtTick(v), padL - 5, y);
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(`0 ${opts.xLabel}`, padL + 22, padT + ih + 6);
    ctx.fillText(`${fmtTick(maxX)} ${opts.xLabel}`, padL + iw - 30, padT + ih + 6);
    const X = (x) => padL + (x / maxX) * iw;
    const Y = (y) => padT + ih - (y / maxY) * ih;
    for (const s of series) {
        if (s.points.length === 0)
            continue;
        ctx.strokeStyle = s.color;
        ctx.lineWidth = 1.6;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        const step = Math.max(1, Math.floor(s.points.length / 400));
        let first = true;
        for (let i = 0; i < s.points.length; i += step) {
            const p = s.points[i];
            if (first) {
                ctx.moveTo(X(p.x), Y(p.y));
                first = false;
            }
            else
                ctx.lineTo(X(p.x), Y(p.y));
        }
        const last = s.points[s.points.length - 1];
        ctx.lineTo(X(last.x), Y(last.y));
        ctx.stroke();
    }
    // y label
    ctx.fillStyle = '#626e7a';
    ctx.textAlign = 'left';
    ctx.fillText(opts.yLabel, 4, 2);
}
function fmtTick(v) {
    if (v >= 1000)
        return `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k`;
    if (v >= 100)
        return v.toFixed(0);
    if (v >= 10)
        return v.toFixed(v >= 100 ? 0 : 1);
    return v.toFixed(1);
}
