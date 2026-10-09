import { act, fireEvent, render, screen } from '@testing-library/react';
import { BoardViewport } from '../../src/client/canvas/BoardViewport';
import type { Camera } from '../../src/client/canvas/camera';

/** Render the full board (viewport + chrome). */
export function renderBoard() {
  return render(<BoardViewport />);
}

/** Let the requestAnimationFrame-batched camera update land. */
export async function flushFrame(): Promise<void> {
  await act(async () => {
    if (typeof requestAnimationFrame === 'function') {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      });
    } else {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });
}

export function boardElement(): HTMLElement {
  return screen.getByTestId('board');
}

export function worldLayer(): HTMLElement {
  return screen.getByTestId('world-layer');
}

/** Read the camera back from the rendered world-layer transform. */
export function readCamera(): Camera {
  const transform = worldLayer().style.transform;
  const match = /scale\(([-0-9.e+]+)\)\s*translate\(([-0-9.e+]+)px,\s*([-0-9.e+]+)px\)/u.exec(
    transform,
  );
  if (!match) {
    throw new Error(`unexpected world layer transform: ${JSON.stringify(transform)}`);
  }
  return { x: -Number(match[2]), y: -Number(match[3]), zoom: Number(match[1]) };
}

export function zoomLabel(): string {
  return screen.getByTestId('zoom-percent').textContent ?? '';
}

export function gridStyle(): { size: string; position: string } {
  const style = boardElement().style;
  return { size: style.backgroundSize, position: style.backgroundPosition };
}

export interface GridStyle {
  spacingPx: number;
  offsetX: number;
  offsetY: number;
}

/** The rendered dot pattern as numbers (spacing and tile offset in CSS px). */
export function readGrid(): GridStyle {
  const style = gridStyle();
  const [spacingPx] = style.size.split(' ').map(parseFloat);
  const [offsetX, offsetY] = style.position.split(' ').map(parseFloat);
  return { spacingPx: spacingPx!, offsetX: offsetX!, offsetY: offsetY! };
}

/**
 * Distance between a screen coordinate and the nearest grid dot.
 * CSS paints each dot at the centre of its tile, so a world coordinate that is a
 * multiple of GRID_SPACING_WORLD must land exactly `spacingPx / 2` past the
 * reported background position.
 */
export function dotAlignmentError(
  screenCoord: number,
  offset: number,
  spacingPx: number,
): number {
  const residue = mod(screenCoord - offset, spacingPx);
  return Math.abs(residue - spacingPx / 2);
}

export const mod = (value: number, modulus: number): number =>
  ((value % modulus) + modulus) % modulus;

export function pointerEvent(
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel' | 'lostpointercapture',
  x: number,
  y: number,
): void {
  const target = boardElement();
  const init = { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1 };
  if (typeof PointerEvent === 'function') {
    fireEvent(
      target,
      new PointerEvent(type, { ...init, pointerType: 'mouse', button: 0, isPrimary: true }),
    );
    return;
  }
  const fallback =
    type === 'pointerdown'
      ? 'pointerDown'
      : type === 'pointermove'
        ? 'pointerMove'
        : type === 'pointerup'
          ? 'pointerUp'
          : type === 'pointercancel'
            ? 'pointerCancel'
            : 'lostPointerCapture';
  fireEvent[fallback](target, init as PointerEventInit);
}

export function dispatchWheel(
  target: Element,
  init: {
    deltaX?: number;
    deltaY?: number;
    deltaMode?: number;
    ctrlKey?: boolean;
    metaKey?: boolean;
    clientX?: number;
    clientY?: number;
  },
): WheelEvent {
  const event = new WheelEvent('wheel', {
    bubbles: true,
    cancelable: true,
    deltaX: 0,
    deltaY: 0,
    deltaMode: 0,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

export function dispatchGesture(
  type: 'gesturestart' | 'gesturechange' | 'gestureend',
  scale: number,
): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'scale', { value: scale });
  boardElement().dispatchEvent(event);
  return event;
}

export function pressKeys(key: string, modifiers: { ctrl?: boolean; meta?: boolean } = {}): Event {
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    key,
    ctrlKey: modifiers.ctrl ?? false,
    metaKey: modifiers.meta ?? false,
  });
  window.dispatchEvent(event);
  return event;
}
