// jsdom does not implement modal dialogs; provide the minimal behaviour we rely on.
const proto = HTMLDialogElement.prototype as unknown as {
  showModal?: () => void;
  close?: () => void;
};

if (typeof proto.showModal !== 'function') {
  proto.showModal = function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  proto.close = function (this: HTMLDialogElement) {
    if (!this.hasAttribute('open')) return;
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
}

/** Let pending promises and timers settle. */
export const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
