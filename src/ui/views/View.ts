import type { AppState } from '../../app/services';

export interface View {
  el: HTMLElement;
  /** Called on every state change. */
  update(state: AppState): void;
  destroy(): void;
}
