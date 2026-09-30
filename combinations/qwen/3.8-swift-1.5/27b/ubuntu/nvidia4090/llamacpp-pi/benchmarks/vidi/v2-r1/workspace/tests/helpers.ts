/**
 * Pointer-event helpers for component tests.
 *
 * jsdom's `fireEvent.pointerDown/Up` drops `clientX`/`clientY`/`button`
 * (it uses the legacy `initEvent` path), so tests dispatch real
 * `MouseEvent`s (which honour the init dictionary) instead. React 18
 * listens at the root, so the synthetic handlers fire as usual.
 */
export function dispatchPointer(
  el: Element | Window,
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  x: number,
  y: number,
  init: Omit<MouseEventInit, 'bubbles' | 'cancelable' | 'clientX' | 'clientY'> = {},
): void {
  const e = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    button: 0,
    ...init,
  });
  el.dispatchEvent(e);
}
