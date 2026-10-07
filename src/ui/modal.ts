export interface ModalApi {
  open(): void;
  close(): void;
  isOpen(): boolean;
}

/** The "How it works?" overlay: seven short steps, no lecture. */
export function bindModal(): ModalApi {
  const modal = must('howModal');

  const open = (): void => {
    modal.hidden = false;
    must('btnCloseHow').focus();
  };
  const close = (): void => {
    modal.hidden = true;
  };

  must('btnCloseHow').addEventListener('click', close);
  must('btnGotIt').addEventListener('click', close);
  modal.querySelector('.modal-backdrop')?.addEventListener('click', close);

  return { open, close, isOpen: () => !modal.hidden };
}

function must(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el;
}
