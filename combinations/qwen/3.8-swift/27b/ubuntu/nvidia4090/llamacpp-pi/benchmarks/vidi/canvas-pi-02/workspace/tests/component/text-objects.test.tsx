// Story 9 (text.object) component tests: TC-19 to TC-25 — editing, empty
// removal, sizes, handles, remote delete, undo.
//
// The y-websocket provider is replaced with a fake (as in the story 7
// selection tests) so every test deterministically reaches
// connected + synced (editable).

import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { deleteObject } from '../../src/shared/board-model';
import { createText } from '../../src/shared/objects/text';
import { WebsocketProvider } from 'y-websocket';
import { renderAppAt } from './render-app';

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
function pointerEvent(
  type: string,
  x: number,
  y: number,
  extra: Record<string, unknown> = {},
): Event {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(e, { clientX: x, clientY: y, pointerId: 1, isPrimary: true, ...extra });
  return e;
}

function fire(target: EventTarget, e: Event): void {
  act(() => {
    target.dispatchEvent(e);
  });
}

function flush(): Promise<void> {
  return act(async () => {
    await vi.advanceTimersByTimeAsync(16);
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

const texts = () => window.__vidi6?.getTextObjects() ?? [];
const selected = (): string[] => window.__vidi6?.getSelectedIds() ?? [];

/** Creates a text object through the shared model (top-left at (x, y)). */
async function createTextAt(doc: Y.Doc, x: number, y: number): Promise<string> {
  let id: string | null = null;
  act(() => {
    id = createText(doc, { x, y }, 'test-client');
  });
  if (id === null) throw new Error('createText failed');
  await act(async () => {});
  return id;
}

const textEl = (id: string): HTMLElement =>
  document.querySelector(`[data-testid="text-object"][data-id="${id}"]`) as HTMLElement;

/** Selects exactly one text (plain click on it). */
function clickText(id: string): void {
  const el = textEl(id);
  const r = el.getBoundingClientRect();
  fire(el, pointerEvent('pointerdown', r.x + 5, r.y + 5));
  fire(el, pointerEvent('pointerup', r.x + 5, r.y + 5));
}

/** Starts editing a text (double-click). */
function editText(id: string): void {
  const el = textEl(id);
  const r = el.getBoundingClientRect();
  act(() => {
    el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX: r.x + 5, clientY: r.y + 5 }));
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('story 9: text objects', () => {
  it('TC-19: caret at end; Enter inserts a newline; Escape ends editing, text stays selected', async () => {
    const doc = await setupApp();
    const id = await createTextAt(doc, 100, 100);
    window.__vidi6?.setTextObjectText(id, 'hello');
    await act(async () => {});

    editText(id);
    const input = screen.getByTestId('text-editor-input') as HTMLTextAreaElement;
    // Caret at the end of the existing text.
    expect(input.selectionStart).toBe(5);
    expect(input.selectionEnd).toBe(5);

    // Enter is NOT intercepted: it inserts a new line (the browser does the
    // insertion; the editor must not preventDefault it).
    const enter = key('keydown', { key: 'Enter' });
    act(() => {
      input.dispatchEvent(enter);
    });
    expect(enter.defaultPrevented).toBe(false);

    // Escape ends editing; the text object stays selected.
    act(() => {
      input.dispatchEvent(key('keydown', { key: 'Escape' }));
    });
    expect(screen.queryByTestId('text-editor-input')).toBeNull();
    expect(selected()).toEqual([id]);
    expect(texts().find((t) => t.id === id)?.text).toBe('hello');
  });

  it('TC-20: Escape with zero characters → object removed, selection cleared', async () => {
    const doc = await setupApp();
    const id = await createTextAt(doc, 100, 100);
    expect(texts()).toHaveLength(1);

    editText(id);
    act(() => {
      screen.getByTestId('text-editor-input').dispatchEvent(key('keydown', { key: 'Escape' }));
    });

    // The empty object is gone: no object, no DOM node, no selection.
    expect(texts()).toHaveLength(0);
    expect(doc.getMap('objects').get(id)).toBeUndefined();
    expect(textEl(id)).toBeNull();
    expect(selected()).toHaveLength(0);
  });

  it('TC-21: toolbar shows S/M/L/XL with M pressed; XL → size XL, x/y unchanged', async () => {
    const doc = await setupApp();
    const id = await createTextAt(doc, 100, 100);
    window.__vidi6?.setTextObjectText(id, 'hi');
    await act(async () => {});

    clickText(id);
    expect(screen.getByTestId('text-toolbar')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Size S' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Size M' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Size L' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Size XL' })).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(screen.getByRole('button', { name: 'Size XL' }));
    const t = texts().find((t) => t.id === id)!;
    expect(t.size).toBe('XL');
    expect(t.x).toBe(100);
    expect(t.y).toBe(100);
  });

  it('TC-22: single text selected → only e and w handles', async () => {
    const doc = await setupApp();
    const id = await createTextAt(doc, 100, 100);
    window.__vidi6?.setTextObjectText(id, 'hi');
    await act(async () => {});

    clickText(id);
    const handles = screen.getAllByRole('button').filter((b) => b.className.includes('selection-handle'));
    expect(handles.map((h) => h.getAttribute('aria-label')).sort()).toEqual([
      'Resize left',
      'Resize right',
    ]);
  });

  it('TC-23: text + sticky selected → all handles; resize rescales text, font unchanged', async () => {
    const doc = await setupApp();
    const stickyId = window.__vidi6?.createSticky(0, 0);
    expect(stickyId).not.toBeNull();
    const textId = await createTextAt(doc, 300, 0);
    window.__vidi6?.setTextObjectText(textId, 'hi');
    await act(async () => {});

    windowKey(key('keydown', { key: 'a', ctrlKey: true }));
    expect(selected().sort()).toEqual([stickyId as string, textId].sort());

    // All eight bounding-box handles.
    const handles = screen.getAllByRole('button').filter((b) => b.className.includes('selection-handle'));
    expect(handles).toHaveLength(8);

    const before = texts().find((t) => t.id === textId)!;
    const handle = screen.getByRole('button', { name: 'Resize bottom-right' });
    fire(handle, pointerEvent('pointerdown', 500, 100));
    fire(window, pointerEvent('pointermove', 550, 150));
    await flush();
    fire(window, pointerEvent('pointerup', 550, 150));

    const after = texts().find((t) => t.id === textId)!;
    // The text object's box moved/scaled with the bounding box…
    expect([after.x, after.y]).not.toEqual([before.x, before.y]);
    expect(after.width).not.toBe(before.width);
    // …and its font size (the size preset) is unchanged.
    expect(after.size).toBe('M');
    const el = textEl(textId);
    expect(el.style.fontSize).toBe('20px'); // TEXT_SIZES.M
  });

  it('TC-24: remote delete while editing → editor unmounts, no error, object not recreated', async () => {
    const doc = await setupApp();
    const id = await createTextAt(doc, 100, 100);
    window.__vidi6?.setTextObjectText(id, 'live');
    await act(async () => {});

    editText(id);
    expect(screen.getByTestId('text-editor-input')).toBeTruthy();

    // A remote client deletes the object.
    act(() => {
      deleteObject(doc, id);
    });

    // The editor unmounted cleanly and the object is gone everywhere.
    expect(screen.queryByTestId('text-editor-input')).toBeNull();
    expect(textEl(id)).toBeNull();
    expect(texts()).toHaveLength(0);
    expect(selected()).toHaveLength(0);

    // It is not recreated by a re-render.
    await act(async () => {});
    expect(doc.getMap('objects').get(id)).toBeUndefined();
  });

  it('TC-25: type then Ctrl+Z → text and stored box revert together in one step', async () => {
    const doc = await setupApp();
    const id = await createTextAt(doc, 100, 100);
    const before = texts().find((t) => t.id === id)!;
    const boxBefore = { width: before.width, height: before.height };

    editText(id);
    const input = screen.getByTestId('text-editor-input') as HTMLTextAreaElement;
    // Two lines: the height doubles (one line at 20px is 26 world units).
    fireEvent.change(input, { target: { value: 'aaaa\nbbbb' } });
    await act(async () => {});

    const mid = texts().find((t) => t.id === id)!;
    expect(mid.text).toBe('aaaa\nbbbb');
    // The typing re-measured the box (26 → 52 tall).
    expect(mid.height).toBe(52);
    expect(mid.height).not.toBe(boxBefore.height);

    // One Ctrl+Z reverts the typing step: text AND box together.
    act(() => {
      input.dispatchEvent(key('keydown', { key: 'z', ctrlKey: true }));
    });
    await act(async () => {});

    const after = texts().find((t) => t.id === id)!;
    expect(after.text).toBe('');
    expect({ width: after.width, height: after.height }).toEqual(boxBefore);
    // The object survives (only the typing was undone).
    expect(texts()).toHaveLength(1);
  });
});
