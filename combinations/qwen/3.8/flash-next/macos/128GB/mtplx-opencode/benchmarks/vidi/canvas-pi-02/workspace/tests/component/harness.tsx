import { useEffect, useRef } from 'react';
import { act, render } from '@testing-library/react';
import {
  canZoomIn,
  canZoomOut,
  zoomPercent,
  type Camera,
  type Size,
} from '../../src/client/canvas/camera';
import { BoardViewport } from '../../src/client/canvas/BoardViewport';
import { CameraContext, useCamera, type CameraApi } from '../../src/client/canvas/useCamera';
import { NavigationHint } from '../../src/client/canvas/NavigationHint';
import { ZoomControls } from '../../src/client/canvas/ZoomControls';

/**
 * Shared harness: mounts the real components wired to the real `useCamera` hook
 * with a fixed viewport size, and exposes helpers for the input events the
 * board handles.
 */
export const VIEWPORT: Size = { width: 1200, height: 800 };

export interface Harness {
  api(): CameraApi;
  board(): HTMLElement;
  camera(): Camera;
  worldLayer(): HTMLElement;
  label(): string;
  hint(): HTMLElement | null;
  button(name: string): HTMLButtonElement;
}

function parseCamera(value: string | null): Camera {
  const [x, y, zoom] = (value ?? '').split(',').map(Number);
  return { x, y, zoom };
}

function Board({
  viewport,
  publish,
  controls,
}: {
  viewport: Size;
  publish: (api: CameraApi) => void;
  controls: boolean;
}) {
  const api = useCamera(viewport);
  const latest = useRef(publish);
  latest.current = publish;
  // No dependency array: the newest api object is published after each render.
  useEffect(() => {
    latest.current(api);
  });
  return (
    <CameraContext.Provider value={api}>
      <BoardViewport />
      {controls ? (
        <ZoomControls
          zoomPercent={zoomPercent(api.camera)}
          canZoomIn={canZoomIn(api.camera)}
          canZoomOut={canZoomOut(api.camera)}
          onZoomIn={() => api.zoomStep('in')}
          onZoomOut={() => api.zoomStep('out')}
          onReset={() => api.reset()}
        />
      ) : null}
      <NavigationHint visible={!api.hasNavigated} />
    </CameraContext.Provider>
  );
}

export function renderBoard(
  options: { controls?: boolean; viewport?: Size } = {},
): Harness {
  const viewport = options.viewport ?? VIEWPORT;
  const published: { api: CameraApi | null } = { api: null };

  const { container } = render(
    <Board
      viewport={viewport}
      controls={options.controls ?? true}
      publish={(api) => {
        published.api = api;
      }}
    />,
  );

  const board = () => {
    const el = container.querySelector<HTMLElement>('[data-testid="board-viewport"]');
    if (!el) throw new Error('board viewport is not mounted');
    return el;
  };

  const api = () => {
    const current = published.api;
    if (!current) throw new Error('camera api was not published during render');
    return current;
  };

  return {
    api,
    board,
    camera: () => parseCamera(board().dataset.camera ?? null),
    worldLayer: () => {
      const el = container.querySelector<HTMLElement>('[data-testid="world-layer"]');
      if (!el) throw new Error('world layer is not mounted');
      return el;
    },
    label: () =>
      container.querySelector<HTMLElement>('[data-testid="zoom-label"]')?.textContent ?? '',
    hint: () => container.querySelector<HTMLElement>('[data-testid="navigation-hint"]'),
    button: (name: string) => {
      const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('button'));
      const found = buttons.find(
        (b) => b.getAttribute('aria-label') === name || b.textContent?.trim() === name,
      );
      if (!found) throw new Error(`no button named "${name}"`);
      return found;
    },
  };
}

/** Let coalesced camera updates (at most one render per animation frame) land. */
export async function settle(frames = 3): Promise<void> {
  await act(async () => {
    for (let i = 0; i < frames; i += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
    }
  });
}

/** Set the camera directly, for tests that need a non-default starting state. */
export async function seedCamera(harness: Harness, camera: Camera): Promise<void> {
  await act(async () => {
    harness.api().setCamera(camera);
  });
  await settle();
}

/** Dispatch an event on a target and let any resulting render finish. */
export async function dispatch(
  target: EventTarget,
  event: Event,
): Promise<{ defaultPrevented: boolean }> {
  await act(async () => {
    target.dispatchEvent(event);
  });
  await settle();
  return { defaultPrevented: event.defaultPrevented };
}

export interface PointerOptions {
  clientX: number;
  clientY: number;
  button?: number;
  /**
   * Which buttons are held down. Only set it when the event stands for a held
   * drag: a real browser reports this, and StickyNote stops following a pointer
   * that says it is not held, so a synthetic drag must say `buttons: 1`.
   */
  buttons?: number;
  pointerType?: string;
  pointerId?: number;
}

/**
 * jsdom has no PointerEvent constructor, so pointer events are created as a
 * MouseEvent carrying the pointer type name plus the extra pointer properties.
 */
export function pointerEvent(type: string, options: PointerOptions): MouseEvent {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: options.clientX,
    clientY: options.clientY,
    button: options.button ?? 0,
  });
  if (options.buttons !== undefined) {
    Object.defineProperty(event, 'buttons', { value: options.buttons });
  }
  Object.defineProperty(event, 'pointerType', { value: options.pointerType ?? 'mouse' });
  Object.defineProperty(event, 'pointerId', { value: options.pointerId ?? 1 });
  return event;
}

export interface WheelOptions {
  deltaX?: number;
  deltaY?: number;
  deltaMode?: number;
  clientX?: number;
  clientY?: number;
  ctrlKey?: boolean;
  metaKey?: boolean;
}

export function wheelEvent(type: string, options: WheelOptions): WheelEvent {
  return new WheelEvent(type, {
    bubbles: true,
    cancelable: true,
    deltaX: options.deltaX ?? 0,
    deltaY: options.deltaY ?? 0,
    deltaMode: options.deltaMode ?? 0,
    clientX: options.clientX ?? 0,
    clientY: options.clientY ?? 0,
    ctrlKey: options.ctrlKey ?? false,
    metaKey: options.metaKey ?? false,
  });
}

export function gestureEvent(
  type: string,
  options: { scale: number; clientX?: number; clientY?: number },
): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'scale', { value: options.scale });
  Object.defineProperty(event, 'clientX', { value: options.clientX ?? 0 });
  Object.defineProperty(event, 'clientY', { value: options.clientY ?? 0 });
  return event;
}

export function keyEvent(
  key: string,
  options: { ctrlKey?: boolean; metaKey?: boolean } = {},
): KeyboardEvent {
  return new KeyboardEvent('keydown', {
    key,
    ctrlKey: options.ctrlKey ?? false,
    metaKey: options.metaKey ?? false,
    bubbles: true,
    cancelable: true,
  });
}
