export const EDITOR_TOOLS = [
    { key: 'pan', label: 'Inspect', hint: 'Drag to pan · scroll to zoom · click an ant', shortcut: '1' },
    { key: 'food', label: 'Food', hint: 'Click to place a food source · click food again to remove', shortcut: '2' },
    { key: 'nest', label: 'Nest', hint: 'Click to move the nest', shortcut: '3' },
    { key: 'wall', label: 'Wall', hint: 'Drag to draw a wall', shortcut: '4' },
    { key: 'erase', label: 'Erase', hint: 'Click a wall or food to remove it', shortcut: '5' },
];
/**
 * Pointer gestures for the world editor. Pan/zoom behaviour is preserved by
 * delegating to the host callbacks when the Inspect tool is active; every
 * other tool consumes the gesture and mutates the live world so ants react
 * immediately (no rebuild, no trail wipe).
 */
export function bindEditor(canvas, cb) {
    const api = {
        tool: 'pan',
        setTool,
        ghostWall: null,
        hoverWorld: null,
        updateHover,
        clearHover,
    };
    let wallStart = null;
    let pointerDown = false;
    let panMoved = false;
    let lastX = 0;
    let lastY = 0;
    let eraseDown = false;
    const buttons = Array.from(document.querySelectorAll('[data-tool]'));
    function setTool(tool) {
        api.tool = tool;
        wallStart = null;
        api.ghostWall = null;
        for (const b of buttons) {
            const active = b.dataset.tool === tool;
            b.classList.toggle('on', active);
            b.setAttribute('aria-pressed', String(active));
        }
        const meta = EDITOR_TOOLS.find((t) => t.key === tool);
        const flag = document.getElementById('editorHint');
        if (flag && meta)
            flag.textContent = meta.hint;
        canvas.classList.toggle('editing', tool !== 'pan');
    }
    for (const b of buttons) {
        b.addEventListener('click', () => {
            setTool(b.dataset.tool ?? 'pan');
            b.blur();
        });
    }
    function toWorld(clientX, clientY) {
        const rect = canvas.getBoundingClientRect();
        const { w, h } = cb.viewSize();
        return cb.camera().screenToWorld(clientX - rect.left, clientY - rect.top, w, h);
    }
    function updateHover(clientX, clientY) {
        api.hoverWorld = toWorld(clientX, clientY);
    }
    function clearHover() {
        api.hoverWorld = null;
    }
    function clampWorld(p) {
        const size = cb.sim().world.size;
        return {
            x: Math.min(size, Math.max(0, p.x)),
            y: Math.min(size, Math.max(0, p.y)),
        };
    }
    canvas.addEventListener('pointerdown', (e) => {
        if (e.button !== 0)
            return;
        try {
            canvas.setPointerCapture(e.pointerId);
        }
        catch {
            /* noop */
        }
        const rect = canvas.getBoundingClientRect();
        pointerDown = true;
        panMoved = false;
        lastX = e.clientX - rect.left;
        lastY = e.clientY - rect.top;
        if (api.tool === 'wall') {
            wallStart = clampWorld(toWorld(e.clientX, e.clientY));
            api.ghostWall = { x: wallStart.x, y: wallStart.y, w: 0, h: 0 };
        }
        else if (api.tool === 'erase') {
            eraseDown = true;
            const w = clampWorld(toWorld(e.clientX, e.clientY));
            const res = cb.sim().eraseAt(w.x, w.y);
            if (res.walls > 0 || res.food)
                cb.onMutate(res.walls > 0 ? 'wall-removed' : 'food-removed');
        }
    });
    canvas.addEventListener('pointermove', (e) => {
        const rect = canvas.getBoundingClientRect();
        const px = e.clientX - rect.left;
        const py = e.clientY - rect.top;
        if (!pointerDown) {
            if (api.tool !== 'pan')
                api.hoverWorld = clampWorld(toWorld(e.clientX, e.clientY));
            return;
        }
        if (api.tool === 'pan') {
            const dx = px - lastX;
            const dy = py - lastY;
            if (!panMoved && Math.hypot(dx, dy) > 4)
                panMoved = true;
            if (panMoved)
                cb.onPan(dx, dy);
            lastX = px;
            lastY = py;
            return;
        }
        if (api.tool === 'wall' && wallStart) {
            const cur = clampWorld(toWorld(e.clientX, e.clientY));
            const x0 = Math.min(wallStart.x, cur.x);
            const y0 = Math.min(wallStart.y, cur.y);
            api.ghostWall = {
                x: x0,
                y: y0,
                w: Math.abs(cur.x - wallStart.x),
                h: Math.abs(cur.y - wallStart.y),
            };
            return;
        }
        if (api.tool === 'erase' && eraseDown) {
            const w = clampWorld(toWorld(e.clientX, e.clientY));
            const res = cb.sim().eraseAt(w.x, w.y);
            if (res.walls > 0 || res.food)
                cb.onMutate(res.walls > 0 ? 'wall-removed' : 'food-removed');
        }
        if (api.tool === 'food' || api.tool === 'nest') {
            api.hoverWorld = clampWorld(toWorld(e.clientX, e.clientY));
        }
    });
    const endPointer = (e) => {
        if (!pointerDown)
            return;
        pointerDown = false;
        eraseDown = false;
        const sim = cb.sim();
        if (api.tool === 'pan') {
            if (!panMoved)
                cb.onInspect(clampWorld(toWorld(e.clientX, e.clientY)));
            return;
        }
        if (api.tool === 'wall' && wallStart) {
            const end = clampWorld(toWorld(e.clientX, e.clientY));
            const w = Math.abs(end.x - wallStart.x);
            const h = Math.abs(end.y - wallStart.y);
            const cx = (wallStart.x + end.x) / 2;
            const cy = (wallStart.y + end.y) / 2;
            const minSide = sim.world.cell * 2;
            const ok = sim.placeWall(cx, cy, Math.max(w, minSide), Math.max(h, minSide));
            if (ok)
                cb.onMutate('wall-added');
            else {
                cb.onHint('Walls cannot cover the nest — draw away from it.');
                cb.onMutate('wall-rejected');
            }
            wallStart = null;
            api.ghostWall = null;
            return;
        }
        if (api.tool === 'food') {
            const p = clampWorld(toWorld(e.clientX, e.clientY));
            // clicking an existing source removes it (toggle behaviour)
            if (sim.world.foodIndexAt(p.x, p.y) >= 0) {
                if (sim.removeFood(p.x, p.y))
                    cb.onMutate('food-removed');
            }
            else {
                const ok = sim.placeFood(p.x, p.y);
                cb.onMutate(ok ? 'food-added' : 'food-rejected');
                if (!ok)
                    cb.onHint('No free spot for food there — try open ground.');
            }
            return;
        }
        if (api.tool === 'nest') {
            const p = clampWorld(toWorld(e.clientX, e.clientY));
            if (sim.moveNest(p.x, p.y))
                cb.onMutate('nest-moved');
            else {
                cb.onHint('No free spot for the nest there — try open ground.');
                cb.onMutate('nest-rejected');
            }
            return;
        }
        if (api.tool === 'erase') {
            // single click without drag already handled on pointerdown
            cb.onMutate('erased');
        }
    };
    canvas.addEventListener('pointerup', endPointer);
    canvas.addEventListener('pointercancel', () => {
        pointerDown = false;
        eraseDown = false;
        wallStart = null;
        api.ghostWall = null;
    });
    canvas.addEventListener('pointerleave', () => {
        if (!pointerDown)
            api.hoverWorld = null;
    });
    setTool('pan');
    return api;
}
