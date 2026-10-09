/**
 * Story 10 component tests (TC-22): the active tool — creating with S and L
 * returns to Select; Escape cancels an armed tool without creating anything.
 *
 * Camera pinned to (0,0,1) so world units equal screen pixels.
 */
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Y from 'yjs';
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
const typeCount = (type: string) =>
  [...h.doc.getMap('objects').values()].filter((v) => (v as Y.Map<unknown>).get('type') === type)
    .length;

describe('tools.active_tool (TC-22)', () => {
  it('S then create, L then create → Select active after each creation', () => {
    // Two shapes to connect.
    h.seed((d) => {
      createShape(d, { kind: 'rect', rect: { x: 0, y: 0, width: 160, height: 160 }, at: { x: 0, y: 0 } }, 'seed');
      createShape(d, { kind: 'rect', rect: { x: 460, y: 0, width: 160, height: 160 }, at: { x: 460, y: 0 } }, 'seed');
    });

    // S → draw a shape → back to Select.
    fireEvent.keyDown(window, { key: 's' });
    expect(pressed(selectBtn())).toBe(false);
    let layer = h.container.querySelector('[data-shape-tool-layer]') as HTMLElement;
    expect(layer).toBeTruthy();
    fireEvent.pointerDown(layer, { clientX: 100, clientY: 300, pointerId: 1 });
    fireEvent.pointerMove(layer, { clientX: 250, clientY: 420, pointerId: 1 });
    fireEvent.pointerUp(layer, { clientX: 250, clientY: 420, pointerId: 1 });
    expect(pressed(selectBtn())).toBe(true);
    expect(typeCount('shape')).toBe(3);

    // L → connect the two seeded shapes → back to Select.
    fireEvent.keyDown(window, { key: 'l' });
    expect(pressed(selectBtn())).toBe(false);
    layer = h.container.querySelector('[data-connector-tool-layer]') as HTMLElement;
    expect(layer).toBeTruthy();
    fireEvent.pointerDown(layer, { clientX: 80, clientY: 80, pointerId: 2 });
    fireEvent.pointerMove(layer, { clientX: 540, clientY: 80, pointerId: 2 });
    fireEvent.pointerUp(layer, { clientX: 540, clientY: 80, pointerId: 2 });
    expect(pressed(selectBtn())).toBe(true);
    expect(typeCount('connector')).toBe(1);
  });

  it('S then Escape, L then Escape → Select active and nothing created', () => {
    fireEvent.keyDown(window, { key: 's' });
    expect(h.container.querySelector('[data-shape-tool-layer]')).not.toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(pressed(selectBtn())).toBe(true);
    expect(h.container.querySelector('[data-shape-tool-layer]')).toBeNull();

    fireEvent.keyDown(window, { key: 'l' });
    expect(h.container.querySelector('[data-connector-tool-layer]')).not.toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(pressed(selectBtn())).toBe(true);
    expect(h.container.querySelector('[data-connector-tool-layer]')).toBeNull();

    // Nothing was created by either cancelled tool.
    expect(typeCount('shape')).toBe(0);
    expect(typeCount('connector')).toBe(0);
    expect(h.doc.getMap('objects').size).toBe(0);
  });
});
