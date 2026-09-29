// Story 10 (shape.*) component tests: TC-15 to TC-17 + TC-28.
//
// The y-websocket provider is replaced with a fake (as in the story 7/9
// tests) so every test deterministically reaches connected + synced
// (editable). jsdom has no layout: the viewport is 0×0, the camera resets
// to {0,0,1}, so world == screen coordinates in these tests.

import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { renderAppAt } from './render-app';

/** Fake provider: records the doc it was given and lets tests emit the
 *  provider events the tracker listens for. */
interface FakeProvider {
  doc: Y.Doc;
  open(): void;
  doSync(): void;
  close(code: number): void;
}

vi.mock('y-websocket', () => {
  class FakeWebsocketProvider {
    static instances: FakeProvider[] = [];
    doc: Y.Doc;
    private listeners: Record<string, Array<(arg: unknown) => void>> = {};
    constructor(_url: string, _room: string, doc: Y.Doc, _opts: unknown) {
      this.doc = doc;
      FakeWebsocketProvider.instances.push(this);
    }
    on(ev: string, fn: (arg: unknown) => void): void {
      (this.listeners[ev] ??= []).push(fn);
    }
    off(ev: string, fn: (arg: unknown) => void): void {
      this.listeners[ev] = (this.listeners[ev] ?? []).filter((f) => f !== fn);
    }
    destroy(): void {
      this.listeners = {};
    }
    private emit(ev: string, arg: unknown): void {
      (this.listeners[ev] ?? []).slice().forEach((f) => f(arg));
    }
    open(): void {
      this.emit('status', { status: 'connected' });
    }
    doSync(): void {
      this.emit('sync', true);
    }
    close(code: number): void {
      this.emit('connection-close', { code, reason: 'test' });
      this.emit('status', { status: 'disconnected' });
    }
  }
  return { WebsocketProvider: FakeWebsocketProvider };
});

const fakeProviders = (): FakeProvider[] =>
  (WebsocketProvider as unknown as { instances: FakeProvider[] }).instances;

/** jsdom has no PointerEvent; dispatch a plain event carrying pointer fields. */
function pointerEvent(type: string, x: number, y: number, extra: Record<string, unknown> = {}): Event {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(e, { clientX: x, clientY: y, pointerId: 1, isPrimary: true, ...extra });
  return e;
}

function fire(target: EventTarget, e: Event): void {
  act(() => {
    target.dispatchEvent(e);
  });
}

function key(type: string, props: Record<string, unknown> = {}): Event {
  return new KeyboardEvent(type, { bubbles: true, cancelable: true, ...props });
}

function windowKey(e: Event): boolean {
  act(() => {
    window.dispatchEvent(e);
  });
  return e.defaultPrevented;
}

async function setupApp(): Promise<Y.Doc> {
  await renderAppAt();
  const all = fakeProviders();
  expect(all.length).toBeGreaterThan(0);
  const provider = all[all.length - 1];
  act(() => provider.open());
  act(() => provider.doSync());
  return provider.doc;
}

const selectBtn = () => screen.getByRole('button', { name: 'Select (V)' });
const shapeBtn = () => screen.getByRole('button', { name: 'Shape (S)' });
const shapeTool = () => screen.getByTestId('shape-tool');

/** Drag on the Shape tool overlay from (x1,y1) to (x2,y2). */
function dragShape(x1: number, y1: number, x2: number, y2: number, extra: Record<string, unknown> = {}): void {
  const tool = shapeTool();
  fire(tool, pointerEvent('pointerdown', x1, y1, extra));
  fire(tool, pointerEvent('pointermove', x2, y2));
  fire(tool, pointerEvent('pointerup', x2, y2));
}

/** A plain click on the Shape tool overlay at (x,y). */
function clickShape(x: number, y: number): void {
  const tool = shapeTool();
  fire(tool, pointerEvent('pointerdown', x, y));
  fire(tool, pointerEvent('pointerup', x, y));
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('story 10: the Shape tool', () => {
  it('TC-15: S → Shape active; drag (100,100)→(300,220) → 200×120 shape at (100,100); selected; tool → Select', async () => {
    await setupApp();

    // S activates the Shape tool (the toolbar button is pressed).
    windowKey(key('keydown', { key: 's' }));
    expect(shapeBtn()).toHaveAttribute('aria-pressed', 'true');
    expect(shapeTool()).toBeDefined();

    // A drag draws the preview and creates the shape on release.
    dragShape(100, 100, 300, 220);

    const shapes = window.__vidi6?.getShapes() ?? [];
    expect(shapes).toHaveLength(1);
    expect(shapes[0].x).toBe(100);
    expect(shapes[0].y).toBe(100);
    expect(shapes[0].width).toBe(200);
    expect(shapes[0].height).toBe(120);
    expect(shapes[0].kind).toBe('rect');

    // The created shape is selected and the tool is one-shot (→ Select).
    expect(window.__vidi6?.getSelectedIds()).toEqual([shapes[0].id]);
    expect(selectBtn()).toHaveAttribute('aria-pressed', 'true');
    expect(shapeBtn()).toHaveAttribute('aria-pressed', 'false');
    // The overlay is gone (the tool reverted).
    expect(screen.queryByTestId('shape-tool')).toBeNull();
  });

  it('TC-16: create a shape, double-click → label editor; 600 chars typed → 500 stored', async () => {
    await setupApp();
    windowKey(key('keydown', { key: 's' }));

    // A click creates the standard 160×160 square centred on the point.
    clickShape(150, 150);
    const shapes = window.__vidi6?.getShapes() ?? [];
    expect(shapes).toHaveLength(1);
    expect(shapes[0].width).toBe(160);
    expect(shapes[0].height).toBe(160);
    // Centred on (150,150): top-left at (70,70).
    expect(shapes[0].x).toBe(70);
    expect(shapes[0].y).toBe(70);

    // Double-click the shape → the label editor mounts.
    const el = document.querySelector(`[data-testid="shape-object"][data-id="${shapes[0].id}"]`)!;
    expect(el).not.toBeNull();
    act(() => {
      el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    });
    expect(el).toHaveAttribute('data-editing', 'true');
    const input = screen.getByTestId('text-editor-input');
    expect(document.activeElement).toBe(input);

    // Type 600 chars: the editor clamps to the 500-char label limit.
    const ta = input as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: 'x'.repeat(600) } });
    const after = window.__vidi6?.getShapes() ?? [];
    expect(after[0].label).toHaveLength(500);
    expect(after[0].label).toBe('x'.repeat(500));
  });

  it('TC-17: selected shape → ShapeToolbar; fill+stroke changes persist; label/size/selection unchanged', async () => {
    await setupApp();
    windowKey(key('keydown', { key: 's' }));
    clickShape(150, 150);
    const shapes = window.__vidi6?.getShapes() ?? [];
    expect(shapes).toHaveLength(1);
    const id = shapes[0].id;

    // The shape toolbar is shown above the selection.
    const toolbar = screen.getByTestId('shape-toolbar');
    expect(toolbar).toBeDefined();

    // Blue fill + red outline (the swatches are labelled by colour).
    act(() => {
      screen.getByRole('button', { name: 'Blue fill' }).click();
    });
    act(() => {
      screen.getByRole('button', { name: 'Red outline' }).click();
    });

    const after = window.__vidi6?.getShapes() ?? [];
    expect(after[0].fill).toBe('blue');
    expect(after[0].stroke).toBe('red');
    // The label is unchanged…
    expect(after[0].label).toBe('');
    // …the size is unchanged…
    expect(after[0].width).toBe(160);
    expect(after[0].height).toBe(160);
    // …and the selection survived the toolbar clicks.
    expect(window.__vidi6?.getSelectedIds()).toEqual([id]);
    // The toolbar is still shown (the shape is still the single selection).
    expect(screen.getByTestId('shape-toolbar')).toBeDefined();
  });

  it('TC-28: the Shape tool isolates the pointer: dragging over a sticky note draws a shape, the note stays', async () => {
    await setupApp();
    const noteId = window.__vidi6?.createSticky(0, 0);
    expect(noteId).not.toBeNull();

    windowKey(key('keydown', { key: 's' }));

    // The note is centred on (0,0): it occupies (-100,-100)–(100,100).
    // A drag that STARTS on the note (at its centre) must draw a shape,
    // not move the note.
    dragShape(0, 0, 200, 120);

    const shapes = window.__vidi6?.getShapes() ?? [];
    expect(shapes).toHaveLength(1);
    expect(shapes[0].x).toBe(0);
    expect(shapes[0].y).toBe(0);
    expect(shapes[0].width).toBe(200);
    expect(shapes[0].height).toBe(120);

    // The note is unmoved.
    const notes = window.__vidi6?.getStickyNotes() ?? [];
    expect(notes).toHaveLength(1);
    expect(notes[0].x).toBe(-100);
    expect(notes[0].y).toBe(-100);
  });
});
