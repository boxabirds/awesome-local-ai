// Connector tool / connector object component tests (story 10, TC-18 to
// TC-21). The board is the full app at the 1280x800 fixture with the HOME
// camera, so world (0,0) is screen (640, 400) at zoom 1.

import { act, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createShape } from '../../src/shared/objects/shape';
import { createConnector } from '../../src/shared/objects/connector';
import {
  dispatch,
  installResizeObserverMock,
  pointerEvent,
  renderApp,
  viewportEl,
  windowKey,
} from './helpers';
import { boardDoc, liveNotes } from './story7-helpers';

beforeEach(() => {
  vi.useFakeTimers();
  installResizeObserverMock();
});

afterEach(() => {
  cleanup();
});

const selectBtn = (): HTMLButtonElement => {
  const el = document.querySelector<HTMLButtonElement>('button[aria-label="Select (V)"]');
  if (el === null) throw new Error('Select (V) button not rendered');
  return el;
};

/** Create a rect shape with top-left at world (x, y). */
function shapeAt(x: number, y: number, w = 200, h = 100): string {
  const id = createShape(boardDoc(), { kind: 'rect', rect: { x, y, width: w, height: h }, at: { x, y } }, 'test');
  if (id === null) throw new Error('createShape failed');
  return id;
}

/** Create an attached A→B connector directly (fixture helper). */
function connect(a: string, b: string): string {
  const id = createConnector(
    boardDoc(),
    { kind: 'attached', objectId: a, fallback: { x: 0, y: 0 } },
    { kind: 'attached', objectId: b, fallback: { x: 0, y: 0 } },
    'test',
  );
  if (id === null) throw new Error('createConnector failed');
  return id;
}

const connectorTool = (container: HTMLElement): HTMLElement => {
  const el = container.querySelector<HTMLElement>('[data-testid="connector-tool"]');
  if (el === null) throw new Error('connector tool overlay not rendered');
  return el;
};

/** Flush pending React renders after direct (non-act) model fixtures. */
async function flush(): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(0);
  });
};

const dots = (container: HTMLElement): HTMLElement[] =>
  Array.from(container.querySelectorAll<HTMLElement>('[data-testid="connector-dot"]'));

describe('connector.ui', () => {
  it('TC-18 L tool hover over shape → four dots at side midpoints', async () => {
    const { container } = await renderApp();
    shapeAt(100, 100); // rect 200x100 at (100,100); centre world (200,150) → screen (840,550)
    windowKey('l');
    const overlay = connectorTool(container);
    dispatch(overlay, pointerEvent('pointermove', 840, 550));

    const ds = dots(container);
    expect(ds).toHaveLength(4);
    const sides = ds.map((d) => d.getAttribute('data-side')).sort();
    expect(sides).toEqual(['bottom', 'left', 'right', 'top']);
    // Dots sit at the side midpoints (screen space): top = world (200,100) → (840,500).
    const top = ds.find((d) => d.getAttribute('data-side') === 'top')!;
    expect(parseFloat(top.style.left)).toBe(840 - 4); // dot radius 4
    expect(parseFloat(top.style.top)).toBe(500 - 4);
  });

  it('TC-19 drag from A over B → B nearest dot highlighted; release → attached connector created', async () => {
    const { container } = await renderApp();
    const a = shapeAt(100, 100); // A centre (200,150) → screen (840,550)
    const b = shapeAt(500, 100); // B rect (500,100,200,100); left-mid world (500,150) → screen (1140,550)
    windowKey('l');
    const overlay = connectorTool(container);
    dispatch(overlay, pointerEvent('pointerdown', 840, 550));
    dispatch(overlay, pointerEvent('pointermove', 1140, 550));

    // B's nearest side to the pointer (from A) is left → its dot is highlighted.
    const highlighted = dots(container).filter((d) => d.hasAttribute('data-highlighted'));
    expect(highlighted).toHaveLength(1);
    expect(highlighted[0]!.getAttribute('data-side')).toBe('left');

    dispatch(overlay, pointerEvent('pointerup', 1140, 550));

    const connectors = liveNotes().filter((n) => n.type === 'connector');
    expect(connectors).toHaveLength(1);
    expect(connectors[0]!.from).toMatchObject({ kind: 'attached', objectId: a });
    expect(connectors[0]!.to).toMatchObject({ kind: 'attached', objectId: b });
    // Selected and returned to Select.
    expect(container.querySelector('[data-testid="connector-object"]')!.hasAttribute('data-selected')).toBe(true);
    expect(selectBtn().getAttribute('aria-pressed')).toBe('true');
  });

  it('TC-20 click within tolerance selects the arrow; beyond it does not (50% and 200% zoom)', async () => {
    const { container } = await renderApp();
    connect(shapeAt(100, 100), shapeAt(500, 100));
    await flush();
    const conn = liveNotes().find((n) => n.type === 'connector')!;

    for (const zoom of [0.5, 2]) {
      // Centre the connector on the viewport: world (200,150) → screen (640,400).
      const cam = { x: 200 - 640 / zoom, y: 150 - 400 / zoom, zoom };
      const hook = window.__vidi6;
      if (hook === undefined) throw new Error('test hook not installed');
      dispatch(viewportEl(container), pointerEvent('pointerdown', 640, 400)); // noop
      hook.setCamera(cam);

      // A click on the (wide) hit line selects the arrow.
      const hit = container.querySelector<HTMLElement>('[data-testid="connector-hit"]');
      if (hit === null) throw new Error('connector hit line not rendered');
      dispatch(hit, pointerEvent('pointerdown', 640, 400));
      dispatch(hit, pointerEvent('pointerup', 640, 400));
      const el = container.querySelector<HTMLElement>('[data-testid="connector-object"]');
      expect(el!.hasAttribute('data-selected')).toBe(true);
      expect(conn.id).toBe(el!.getAttribute('data-id'));

      // A click 7px (screen) away misses: deselects, arrow not selected.
      const vp = viewportEl(container);
      dispatch(vp, pointerEvent('pointerdown', 640, 400 + 7));
      dispatch(vp, pointerEvent('pointerup', 640, 400 + 7));
      expect(container.querySelector<HTMLElement>('[data-testid="connector-object"]')!.hasAttribute('data-selected')).toBe(false);
    }
  });

  it('TC-21 drag end handle onto C → attached to C; onto empty space → free at release point', async () => {
    const { container } = await renderApp();
    const a = shapeAt(100, 100);
    const b = shapeAt(500, 100);
    const c = shapeAt(100, 400, 200, 100); // C centre world (200,450) → screen (840,850)
    connect(a, b);
    await flush();

    // Select the arrow (click the hit line) so the end handles appear.
    const hit = container.querySelector<HTMLElement>('[data-testid="connector-hit"]');
    if (hit === null) throw new Error('connector hit line not rendered');
    dispatch(hit, pointerEvent('pointerdown', 900, 550));
    dispatch(hit, pointerEvent('pointerup', 900, 550));
    const handleTo = container.querySelector<HTMLElement>('[data-testid="connector-handle-to"]');
    expect(handleTo).not.toBeNull();

    // Drag the `to` end onto C.
    dispatch(handleTo!, pointerEvent('pointerdown', 1240, 550));
    dispatch(handleTo!, pointerEvent('pointermove', 840, 850));
    dispatch(handleTo!, pointerEvent('pointerup', 840, 850));
    let conn = liveNotes().find((n) => n.type === 'connector')!;
    expect(conn.to).toMatchObject({ kind: 'attached', objectId: c });

    // Drag the `to` end onto empty space → free at the release point.
    const handleTo2 = container.querySelector<HTMLElement>('[data-testid="connector-handle-to"]');
    dispatch(handleTo2!, pointerEvent('pointerdown', 840, 850));
    dispatch(handleTo2!, pointerEvent('pointermove', 640, 300)); // world (0,-100)
    dispatch(handleTo2!, pointerEvent('pointerup', 640, 300));
    conn = liveNotes().find((n) => n.type === 'connector')!;
    expect(conn.to).toMatchObject({ kind: 'free', x: 0, y: -100 });
  });
});
