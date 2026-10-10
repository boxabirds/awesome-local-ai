import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { createSticky, initDoc } from '../../src/shared/board-model';
import { createText } from '../../src/shared/objects/text';
import { worldToScreen } from '../../src/client/canvas/camera';
import { initialCamera } from './helpers';

const holder = vi.hoisted(() => ({ status: 'connected' as string }));
vi.mock('../../src/client/sync/ConnectionStatus', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/client/sync/ConnectionStatus')>();
  return { ...actual, useConnectionStatus: () => holder.status as never };
});

const { BoardView } = await import('../../src/client/pages/BoardPage');

// jsdom has no canvas, so createCanvasMeasurer falls back to the deterministic
// estimator (length × fontPx × 0.5). At M (20px), "hello" → width 50.
const cam0 = initialCamera();
const s = (wx: number, wy: number) => worldToScreen(cam0, { x: wx, y: wy });

function mount(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  render(<BoardView doc={doc} />);
  return doc;
}

function objectsOf(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>('objects');
}

function addText(doc: Y.Doc, x = 0, y = 0): string {
  let id = '';
  act(() => {
    id = createText(doc, { x, y }, 'me')!;
  });
  return id;
}

function textEl(i = 0): HTMLElement {
  return screen.getAllByTestId('text-object')[i];
}

function tap(el: HTMLElement): void {
  fireEvent.pointerDown(el, { clientX: 100, clientY: 100, pointerId: 1, button: 0 });
  fireEvent.pointerUp(el, { clientX: 100, clientY: 100, pointerId: 1 });
}

function shiftTap(el: HTMLElement): void {
  fireEvent.pointerDown(el, {
    clientX: 100,
    clientY: 100,
    pointerId: 1,
    button: 0,
    shiftKey: true
  });
  fireEvent.pointerUp(el, { clientX: 100, clientY: 100, pointerId: 1, shiftKey: true });
}

function editor(): HTMLTextAreaElement {
  return screen.getByTestId('text-editor') as HTMLTextAreaElement;
}

function fields(doc: Y.Doc, id: string) {
  const obj = objectsOf(doc).get(id)!;
  return {
    x: obj.get('x') as number,
    y: obj.get('y') as number,
    width: obj.get('width') as number,
    height: obj.get('height') as number,
    size: obj.get('size') as string
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  holder.status = 'connected';
});

afterEach(() => {
  vi.useRealTimers();
});

describe('text.object', () => {
  it('TC-19 caret at end, Enter inserts a newline, Escape ends editing keeping selection', () => {
    const doc = mount();
    const id = addText(doc);
    const ytext = objectsOf(doc).get(id)!.get('text') as Y.Text;
    act(() => {
      ytext.insert(0, 'hi');
    });

    tap(textEl());
    fireEvent.doubleClick(textEl());
    const ta = editor();
    expect(ta.value).toBe('hi');
    expect(ta.selectionStart).toBe(2);

    // Enter is the textarea's own: it must not end editing.
    fireEvent.keyDown(ta, { key: 'Enter' });
    expect(screen.getByTestId('text-editor')).toBeInTheDocument();
    fireEvent.input(ta, { target: { value: 'hi\nthere' } });

    fireEvent.keyDown(ta, { key: 'Escape' });
    expect(screen.queryByTestId('text-editor')).not.toBeInTheDocument();
    expect(ytext.toString()).toBe('hi\nthere');
    expect(textEl()).toHaveAttribute('data-selected', 'true');
  });

  it('TC-20 Escape with zero characters removes the object and clears selection', () => {
    const doc = mount();
    const id = addText(doc);
    tap(textEl());
    fireEvent.doubleClick(textEl());
    fireEvent.keyDown(editor(), { key: 'Escape' });
    expect(objectsOf(doc).has(id)).toBe(false);
    expect(screen.queryByTestId('text-object')).not.toBeInTheDocument();
    expect(screen.queryByTestId('selection-overlay')).not.toBeInTheDocument();
  });

  it('TC-21 TextToolbar shows S/M/L/XL with M pressed; XL keeps x/y', () => {
    const doc = mount();
    const id = addText(doc, 100, 200);
    tap(textEl());
    const toolbar = screen.getByTestId('text-toolbar');
    for (const size of ['S', 'M', 'L', 'XL']) {
      expect(toolbar.querySelector(`button[aria-label="Size ${size}"]`)).not.toBeNull();
    }
    expect(screen.getByRole('button', { name: 'Size M' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(screen.getByRole('button', { name: 'Size XL' })).toHaveAttribute(
      'aria-pressed',
      'false'
    );

    fireEvent.click(screen.getByRole('button', { name: 'Size XL' }));
    const f = fields(doc, id);
    expect(f.size).toBe('XL');
    expect(f.x).toBe(100);
    expect(f.y).toBe(200);
    expect(screen.getByRole('button', { name: 'Size XL' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  it('TC-22 selecting one text shows only the e and w handles', () => {
    const doc = mount();
    addText(doc);
    tap(textEl());
    const overlay = screen.getByTestId('selection-overlay');
    const handles = [...overlay.querySelectorAll('[data-handle]')].map(
      (el) => el.getAttribute('data-handle')
    );
    expect(handles.sort()).toEqual(['e', 'w']);
  });

  it('TC-23 text + sticky shows all handles; resize repositions text, font size unchanged', () => {
    const doc = mount();
    const id = addText(doc, 100, 0);
    act(() => {
      createSticky(doc, { x: 400, y: 0 });
    });
    tap(textEl(0));
    shiftTap(screen.getAllByTestId('sticky-note')[0]);

    const overlay = screen.getByTestId('selection-overlay');
    expect(overlay.querySelectorAll('[data-handle]')).toHaveLength(8);

    // Drag the left handle 100px outward. The union grows leftwards from
    // x=100, so the text (at the old left edge) must reposition with it.
    fireEvent.pointerDown(screen.getByLabelText('Resize left'), {
      clientX: s(100, 0).x,
      clientY: s(0, 0).y,
      pointerId: 1,
      button: 0
    });
    fireEvent.pointerMove(window, {
      clientX: s(100, 0).x - 100,
      clientY: s(0, 0).y,
      pointerId: 1
    });
    act(() => {
      vi.advanceTimersByTime(50);
    });
    fireEvent.pointerUp(window, {
      clientX: s(100, 0).x - 100,
      clientY: s(0, 0).y,
      pointerId: 1
    });

    const f = fields(doc, id);
    expect(f.x).toBeLessThan(100);
    expect(f.size).toBe('M');
  });

  it('TC-24 remote delete while editing ends the editor silently (error path)', () => {
    const doc = mount();
    const id = addText(doc);
    tap(textEl());
    fireEvent.doubleClick(textEl());
    expect(screen.getByTestId('text-editor')).toBeInTheDocument();

    act(() => {
      doc.transact(() => {
        objectsOf(doc).delete(id);
      }, 'remote-peer');
    });

    expect(screen.queryByTestId('text-editor')).not.toBeInTheDocument();
    expect(screen.queryByTestId('text-object')).not.toBeInTheDocument();
    expect(objectsOf(doc).has(id)).toBe(false);
  });

  it('TC-25 typing then one Ctrl+Z reverts text and stored box together', () => {
    const doc = mount();
    // Create through the Text tool so creation is its own undo step.
    fireEvent.keyDown(window, { key: 'T' });
    const viewport = screen.getByTestId('board-viewport');
    fireEvent.pointerDown(viewport, { clientX: 300, clientY: 200, pointerId: 1, button: 0 });
    fireEvent.pointerUp(viewport, { clientX: 300, clientY: 200, pointerId: 1 });
    const id = [...objectsOf(doc).keys()][0];

    fireEvent.input(editor(), { target: { value: 'hello' } });
    const typed = fields(doc, id);
    expect(typed.width).toBeCloseTo(50, 6); // 5 chars × 20px × 0.5
    expect(typed.height).toBeCloseTo(26, 6); // 1 line × 20 × 1.3

    fireEvent.keyDown(editor(), { key: 'z', ctrlKey: true });
    const undone = fields(doc, id);
    expect(undone.width).toBeCloseTo(40, 6); // placeholder box from createText
    expect(undone.height).toBeCloseTo(26, 6);
    expect(objectsOf(doc).get(id)!.get('text')).toBeInstanceOf(Y.Text);
    expect((objectsOf(doc).get(id)!.get('text') as Y.Text).toString()).toBe('');
    // One step only: the creation itself survives.
    expect(objectsOf(doc).has(id)).toBe(true);
  });
});
