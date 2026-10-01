import { useEffect, useRef, type RefObject } from 'react';
import type { Point } from '../canvas/camera';

const PRIMARY_BUTTON = 0;

/** The board surface the tool layer sits next to (its sibling in the board root), else the layer's parent. */
export function viewportOf(layer: HTMLElement | null): HTMLElement | null {
  const parent = layer?.parentElement ?? null;
  return parent?.querySelector<HTMLElement>('.board-viewport') ?? parent;
}

/** Pointer position relative to the board surface's top-left, in screen pixels. */
export function localPoint(viewport: HTMLElement, e: { clientX: number; clientY: number }): Point {
  const r = viewport.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

/**
 * A tool owns the whole gesture: its pointerdown is taken in the capture phase on the board surface, so
 * objects underneath never see it (no selecting, moving or panning), then `onMove`/`onUp`/`onCancel` run on the
 * window until the pointer is released. Escape and pointercancel cancel without creating anything.
 */
export function useToolGesture(
  layer: RefObject<HTMLElement | null>,
  handlers: {
    onDown(e: PointerEvent, viewport: HTMLElement): boolean; // false: not a gesture of this tool
    onMove(e: PointerEvent, viewport: HTMLElement): void;
    onUp(e: PointerEvent, viewport: HTMLElement): void;
    onCancel(): void;
    onHover?(e: PointerEvent, viewport: HTMLElement): void;
    onLeave?(): void;
  },
): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  useEffect(() => {
    const viewport = viewportOf(layer.current);
    if (!viewport) return undefined;
    let active = false;
    const h = () => handlersRef.current;

    const detach = () => {
      active = false;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKey, true);
    };
    const onMove = (e: PointerEvent) => h().onMove(e, viewport);
    const onUp = (e: PointerEvent) => {
      detach();
      h().onUp(e, viewport);
    };
    const onCancel = () => {
      detach();
      h().onCancel();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    const onDown = (e: PointerEvent) => {
      if (e.button !== PRIMARY_BUTTON) return;
      if (!h().onDown(e, viewport)) return;
      e.stopPropagation();
      e.preventDefault();
      if (active) detach();
      active = true;
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onCancel);
      window.addEventListener('keydown', onKey, true);
    };
    const onHover = (e: PointerEvent) => {
      if (!active) h().onHover?.(e, viewport);
    };
    const onLeave = () => h().onLeave?.();
    viewport.addEventListener('pointerdown', onDown, true);
    viewport.addEventListener('pointermove', onHover);
    viewport.addEventListener('pointerleave', onLeave);
    return () => {
      viewport.removeEventListener('pointerdown', onDown, true);
      viewport.removeEventListener('pointermove', onHover);
      viewport.removeEventListener('pointerleave', onLeave);
      if (active) detach();
    };
  }, [layer]);
}
