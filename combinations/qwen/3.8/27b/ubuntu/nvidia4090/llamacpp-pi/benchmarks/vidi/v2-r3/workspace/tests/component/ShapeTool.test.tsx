/**
 * Story 10 component tests (TC-15, TC-16, TC-17, TC-28): the Shape tool and
 * the Shape object (label editing, style toolbar).
 *
 * Camera pinned to (0,0,1) so world units equal screen pixels.
 */
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Y from 'yjs';
import { createSticky } from '../../src/shared/board-model';
import { SHAPE_LABEL_MAX_CHARS } from '../../src/shared/config';
import { createShape, getShapeLabel } from '../../src/shared/objects/shape';
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
const item = (id: string) => h.doc.getMap('objects').get(id) as Y.Map<unknown>;
const types = () =>
  [...h.doc.getMap('objects').values()].map((v) => (v as Y.Map<unknown>).get('type'));

/** Seed one rect shape and return its id. */
function seedShape(d: Y.Doc, x: number, y: number, w: number, h: number): string {
  const id = createShape(d, { kind: 'rect', rect: { x, y, width: w, height: h }, at: { x, y } }, 'seed');
  if (!id) throw new Error('seedShape failed');
  return id;
}

describe('shape.tool (TC-15, TC-28)', () => {
  it('TC-15: S tool drag → preview shown, exactly one shape created, selection = new id', () => {
    fireEvent.keyDown(window, { key: 's' });
    const layer = h.container.querySelector('[data-shape-tool-layer]') as HTMLElement;
    expect(layer).toBeTruthy();

    fireEvent.pointerDown(layer, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(layer, { clientX: 300, clientY: 220, pointerId: 1 });
    // The dashed preview follows the drag.
    expect(h.container.querySelector('[data-shape-preview]')).not.toBeNull();

    fireEvent.pointerUp(layer, { clientX: 300, clientY: 220, pointerId: 1 });

    // Exactly one object, a 200x120 shape at (100,100).
    const all = [...h.doc.getMap('objects').entries()];
    expect(all).toHaveLength(1);
    const [id, map] = all[0] as [string, Y.Map<unknown>];
    expect(map.get('type')).toBe('shape');
    expect(map.get('x')).toBe(100);
    expect(map.get('y')).toBe(100);
    expect(map.get('width')).toBe(200);
    expect(map.get('height')).toBe(120);

    // The new shape is selected and the tool is back at Select.
    const el = h.container.querySelector(`[data-shape-id="${id}"]`) as HTMLElement;
    expect(el).not.toBeNull();
    expect(el.getAttribute('data-selected')).toBe('true');
    expect(pressed(selectBtn())).toBe(true);
  });

  it('TC-28: a shape drag starting over an existing sticky does not move the sticky', () => {
    let sid = '';
    h.seed((d) => {
      sid = createSticky(d, { x: 100, y: 100 });
    });
    fireEvent.keyDown(window, { key: 's' });
    const layer = h.container.querySelector('[data-shape-tool-layer]') as HTMLElement;
    // The layer is above the world; the drag never reaches the sticky.
    fireEvent.pointerDown(layer, { clientX: 150, clientY: 150, pointerId: 1 });
    fireEvent.pointerMove(layer, { clientX: 250, clientY: 250, pointerId: 1 });
    fireEvent.pointerUp(layer, { clientX: 250, clientY: 250, pointerId: 1 });

    expect(item(sid).get('x')).toBe(100);
    expect(item(sid).get('y')).toBe(100);
    // A 100x100 shape was created on top instead.
    const t = types();
    expect(t.filter((x) => x === 'sticky')).toHaveLength(1);
    expect(t.filter((x) => x === 'shape')).toHaveLength(1);
    const shape = [...h.doc.getMap('objects').entries()].find(
      ([, m]) => (m as Y.Map<unknown>).get('type') === 'shape',
    )![1] as Y.Map<unknown>;
    expect(shape.get('width')).toBe(100);
    expect(shape.get('height')).toBe(100);
  });
});

describe('shape.object (TC-16, TC-17)', () => {
  it('TC-16: dblclick opens the label editor; 600 chars are clamped to SHAPE_LABEL_MAX_CHARS', () => {
    let sid = '';
    h.seed((d) => {
      sid = seedShape(d, 40, 40, 200, 120);
      getShapeLabel(d, sid)!.insert(0, 'Hello');
    });
    const el = h.container.querySelector(`[data-shape-id="${sid}"]`) as HTMLElement;
    fireEvent.pointerDown(el, { clientX: 100, clientY: 80, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 100, clientY: 80, pointerId: 1 });
    fireEvent.doubleClick(el);

    const ta = screen.getByLabelText('Shape label') as HTMLTextAreaElement;
    expect(ta.value).toBe('Hello');

    // Type 600 characters: the editor keeps only SHAPE_LABEL_MAX_CHARS.
    ta.value = 'a'.repeat(600);
    fireEvent.input(ta);
    expect(getShapeLabel(h.doc, sid)!.length).toBe(SHAPE_LABEL_MAX_CHARS);
  });

  it('TC-17: blue fill + red outline swatches apply; label and selection unchanged', () => {
    let sid = '';
    h.seed((d) => {
      sid = seedShape(d, 40, 40, 200, 120);
      getShapeLabel(d, sid)!.insert(0, 'Hi');
    });
    const el = h.container.querySelector(`[data-shape-id="${sid}"]`) as HTMLElement;
    fireEvent.pointerDown(el, { clientX: 100, clientY: 80, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 100, clientY: 80, pointerId: 1 });

    // The style toolbar is visible for the selected shape.
    expect(h.container.querySelector('.shape-toolbar')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Blue fill' }));
    fireEvent.click(screen.getByRole('button', { name: 'Red outline' }));

    expect(item(sid).get('fill')).toBe('blue');
    expect(item(sid).get('stroke')).toBe('red');
    // Label and selection are untouched.
    expect(getShapeLabel(h.doc, sid)!.toString()).toBe('Hi');
    expect(el.getAttribute('data-selected')).toBe('true');
    expect(h.container.querySelector('.shape-toolbar')).not.toBeNull();
  });
});
