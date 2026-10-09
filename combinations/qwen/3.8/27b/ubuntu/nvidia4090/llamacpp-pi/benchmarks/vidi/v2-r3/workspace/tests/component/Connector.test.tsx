/**
 * Story 10 component tests (TC-18 to TC-21): the Connector tool (hover dots,
 * drag-to-connect) and the Connector object (hit-test boundary, endpoint
 * re-attach handles).
 *
 * Camera pinned to (0,0,1) so world units equal screen pixels.
 */
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Y from 'yjs';
import { snapshot } from '../../src/shared/board-model';
import {
  buildRects,
  getObjectType,
} from '../../src/client/objects/registry';
import { createConnector } from '../../src/shared/objects/connector';
import { createShape } from '../../src/shared/objects/shape';
import { renderBoard } from './board-harness';

// Quiet provider (same pattern as the other board component tests).
vi.mock('../../src/client/sync/connectBoard', () => ({
  connectBoard: (_doc: unknown, _boardId: string, onState: (s: string) => void) => {
    const g = globalThis as Record<string, unknown>;
    g.__vidi6_conn_handler = onState;
    onState((g.__vidi6_conn_state as string | undefined) ?? 'connected');
    return {
      destroy() {
        if (g.__vidi6_conn_handler === onState) delete g.__vidi6_conn_handler;
      },
    };
  },
}));

let h: ReturnType<typeof renderBoard>;

beforeEach(() => {
  delete (globalThis as Record<string, unknown>).__vidi6_conn_state;
  h = renderBoard();
  h.setCamera(0, 0, 1);
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__vidi6_conn_state;
  delete (globalThis as Record<string, unknown>).__vidi6_conn_handler;
  cleanup();
});

const selectBtn = () => screen.getByRole('button', { name: 'Select (V)' }) as HTMLButtonElement;
const pressed = (el: HTMLElement) => el.getAttribute('aria-pressed') === 'true';

/**
 * Seeds two 160x160 shapes: A at (0,0) and B at (460,0) — the same layout the
 * TC-18/TC-19 cases use. Returns their ids.
 */
function seedAB(): { aId: string; bId: string } {
  let aId = '';
  let bId = '';
  h.seed((d) => {
    aId = createShape(d, { kind: 'rect', rect: { x: 0, y: 0, width: 160, height: 160 }, at: { x: 0, y: 0 } }, 'seed')!;
    bId = createShape(d, { kind: 'rect', rect: { x: 460, y: 0, width: 160, height: 160 }, at: { x: 460, y: 0 } }, 'seed')!;
  });
  return { aId, bId };
}

describe('connector.tool (TC-18, TC-19)', () => {
  it('TC-18: L tool hover over a shape → four dots at its side midpoints', () => {
    const { aId } = seedAB();
    fireEvent.keyDown(window, { key: 'l' });
    const layer = h.container.querySelector('[data-connector-tool-layer]') as HTMLElement;
    expect(layer).toBeTruthy();

    // Hover the centre of A (80,80).
    fireEvent.pointerMove(layer, { clientX: 80, clientY: 80, pointerId: 1 });
    const dots = layer.querySelectorAll(`circle[data-connector-dot-object="${aId}"]`);
    expect(dots.length).toBe(4);
    const pts = [...dots]
      .map((c) => [Number(c.getAttribute('cx')), Number(c.getAttribute('cy'))] as const)
      .sort((p, q) => p[0] - q[0] || p[1] - q[1]);
    expect(pts).toEqual([
      [0, 80], // left
      [80, 0], // top
      [80, 160], // bottom
      [160, 80], // right
    ]);
  });

  it('TC-19: drag from A over B → B nearest dot highlights; release → attached connector', () => {
    const { aId, bId } = seedAB();
    fireEvent.keyDown(window, { key: 'l' });
    const layer = h.container.querySelector('[data-connector-tool-layer]') as HTMLElement;

    // Press in A's centre, drag to B's centre (540,80).
    fireEvent.pointerDown(layer, { clientX: 80, clientY: 80, pointerId: 1 });
    fireEvent.pointerMove(layer, { clientX: 540, clientY: 80, pointerId: 1 });
    // B's nearest side to A is its left — that dot highlights.
    expect(
      layer.querySelector(
        `circle[data-connector-dot-object="${bId}"][data-connector-dot="left"][data-connector-dot-highlight]`,
      ),
    ).not.toBeNull();

    fireEvent.pointerUp(layer, { clientX: 540, clientY: 80, pointerId: 1 });

    // A connector was created, both ends attached, with the settled side
    // anchors as fallbacks.
    const conn = [...h.doc.getMap('objects').entries()].find(
      ([, m]) => (m as Y.Map<unknown>).get('type') === 'connector',
    )![1] as Y.Map<unknown>;
    expect(conn.get('from')).toEqual({
      kind: 'attached',
      objectId: aId,
      fallback: { x: 160, y: 80 },
    });
    expect(conn.get('to')).toEqual({
      kind: 'attached',
      objectId: bId,
      fallback: { x: 460, y: 80 },
    });
    // The tool is back at Select and its layer is gone.
    expect(pressed(selectBtn())).toBe(true);
    expect(h.container.querySelector('[data-connector-tool-layer]')).toBeNull();
  });
});

describe('connector.object (TC-20, TC-21)', () => {
  it('TC-20: hit test — 5px screen selects, 7px does not, at 100/50/200% zoom', () => {
    let cid = '';
    h.seed((d) => {
      cid = createConnector(
        d,
        { kind: 'free', x: 100, y: 100 },
        { kind: 'free', x: 300, y: 100 },
        'seed',
      )!;
    });
    const snap = snapshot(h.doc);
    const conn = snap.find((o) => o.id === cid)!;
    const rects = buildRects(snap);
    const hit = getObjectType('connector')!.hitTest;
    // Points on the vertical through the line's middle, `px` screen px away.
    const atPx = (zoom: number, px: number) =>
      hit(conn, { x: 200, y: 100 + px / zoom }, zoom, rects);
    expect(atPx(1, 5)).toBe(true); // boundary case: 5 < 6
    expect(atPx(1, 7)).toBe(false); // 7 > 6
    expect(atPx(0.5, 5)).toBe(true); // 10 world <= 12
    expect(atPx(0.5, 7)).toBe(false); // 14 world > 12
    expect(atPx(2, 5)).toBe(true); // 2.5 world <= 3
    expect(atPx(2, 7)).toBe(false); // 3.5 world > 3
  });

  it('TC-21: drag the end handle onto C → attached to C; onto empty space → free at release point', () => {
    let aId = '';
    let bId = '';
    let cId = '';
    let cid = '';
    h.seed((d) => {
      aId = createShape(d, { kind: 'rect', rect: { x: 0, y: 0, width: 160, height: 160 }, at: { x: 0, y: 0 } }, 'seed')!;
      bId = createShape(d, { kind: 'rect', rect: { x: 460, y: 0, width: 160, height: 160 }, at: { x: 460, y: 0 } }, 'seed')!;
      cId = createShape(d, { kind: 'rect', rect: { x: 0, y: 400, width: 160, height: 160 }, at: { x: 0, y: 400 } }, 'seed')!;
      cid = createConnector(
        d,
        { kind: 'attached', objectId: aId, fallback: { x: 160, y: 80 } },
        { kind: 'attached', objectId: bId, fallback: { x: 460, y: 80 } },
        'seed',
      )!;
    });
    void bId;

    // Select the connector via its (wide) hit stroke.
    const root = h.container.querySelector(`[data-connector-id="${cid}"]`) as HTMLElement;
    const hitLine = root.querySelector('[data-connector-hit]') as Element;
    fireEvent.pointerDown(hitLine, { clientX: 310, clientY: 80, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 310, clientY: 80, pointerId: 1 });
    expect(root.getAttribute('data-selected')).toBe('true');

    // Drag the "to" handle (resolved at B's left side, (460,80)) onto C's
    // centre (80,480).
    const toHandle = root.querySelector('[data-connector-handle="to"]') as HTMLElement;
    fireEvent.pointerDown(toHandle, { clientX: 460, clientY: 80, pointerId: 2 });
    fireEvent.pointerMove(window, { clientX: 80, clientY: 480, pointerId: 2 });
    fireEvent.pointerUp(window, { clientX: 80, clientY: 480, pointerId: 2 });
    let conn = h.doc.getMap('objects').get(cid) as Y.Map<unknown>;
    expect(conn.get('to')).toEqual({
      kind: 'attached',
      objectId: cId,
      fallback: { x: 80, y: 400 }, // C's top side, nearest the other end
    });

    // Now drag the same handle onto empty space (300,300): it is freed at the
    // release point. (It now resolves at C's top, (80,400).)
    const toHandle2 = h.container.querySelector(
      `[data-connector-id="${cid}"] [data-connector-handle="to"]`,
    ) as HTMLElement;
    fireEvent.pointerDown(toHandle2, { clientX: 80, clientY: 400, pointerId: 3 });
    fireEvent.pointerMove(window, { clientX: 300, clientY: 300, pointerId: 3 });
    fireEvent.pointerUp(window, { clientX: 300, clientY: 300, pointerId: 3 });
    conn = h.doc.getMap('objects').get(cid) as Y.Map<unknown>;
    expect(conn.get('to')).toEqual({ kind: 'free', x: 300, y: 300 });
  });
});
