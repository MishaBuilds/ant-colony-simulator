/** The "How it works?" overlay: seven short steps, no lecture. */
export function bindModal() {
    const modal = must('howModal');
    const open = () => {
        modal.hidden = false;
        must('btnCloseHow').focus();
    };
    const close = () => {
        modal.hidden = true;
    };
    must('btnCloseHow').addEventListener('click', close);
    must('btnGotIt').addEventListener('click', close);
    modal.querySelector('.modal-backdrop')?.addEventListener('click', close);
    return { open, close, isOpen: () => !modal.hidden };
}
function must(id) {
    const el = document.getElementById(id);
    if (!el)
        throw new Error(`Missing element #${id}`);
    return el;
}
