import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, act } from '@testing-library/react';
import * as Y from 'yjs';
import { LOCAL_ORIGIN, type ObjectSnapshot } from '@/shared/board-model';
import { createText, getTextContent } from '@/shared/objects/text';
import { renderFullApp, hooks, makeNote, firePointer, fireWindowPointer, pressKey, typeText } from './story2';

// Story 5: the board page checks existence before rendering the board.
vi.mock('@/client/api', () => ({
  checkBoard: vi.fn(async () => ({ kind: 'exists' })),
  createBoardRequest: vi.fn(async () => ({ kind: 'failed' })),
}));

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// jsdom window 1024x768, initial camera (-512,-384), zoom 1.
function worldToScreen(w: { x: number; y: number }): { x: number; y: number } {
  return { x: w.x + 512, y: w.y + 384 };
}

/** Creates a text object (as this tab would) and, optionally, types content. */
function makeText(x: number, y: number, content = ''): string {
  let id = '';
  act(() => {
    id = createText(hooks().getDoc(), { x, y }, 'local-test')!;
    if (content) {
      const ytext = getTextContent(hooks().getDoc(), id)!;
      ytext.insert(0, content, LOCAL_ORIGIN);
    }
  });
  return id;
}

function objectOf(id: string): ObjectSnapshot {
  const o = hooks().getObjects().find((s) => s.id === id);
  if (!o) throw new Error(`object ${id} not found`);
  return o;
}

function objectElement(id: string): HTMLElement {
  const el = document.querySelector(`[data-id="${id}"]`);
  if (!el) throw new Error(`object element ${id} not found`);
  return el as HTMLElement;
}

/** Clicks the object's element (jsdom has no hit testing; coordinates only
 *  matter for gestures, not for selection). Shift-click toggles the object
 *  into the existing selection. */
function clickObject(id: string, opts?: { at?: { x: number; y: number }; shift?: boolean }): void {
  const o = objectOf(id);
  const p = opts?.at ?? worldToScreen({ x: o.x + 1, y: o.y + 1 });
  firePointer(objectElement(id), 'pointerdown', p.x, p.y, { shiftKey: opts?.shift ?? false });
  firePointer(objectElement(id), 'pointerup', p.x, p.y, { shiftKey: opts?.shift ?? false });
}

function selectAndEdit(id: string): HTMLTextAreaElement {
  clickObject(id);
  pressKey(window, 'Enter');
  const ta = screen.getByTestId('text-textarea');
  return ta as HTMLTextAreaElement;
}

/** Counts the distinct local transactions that wrote width/height on the
 *  object record (one setTextBox call = one transaction). */
function countBoxWrites(id: string): { writes: () => number } {
  const touched = new Set<Y.Transaction>();
  const record = hooks().getDoc().getMap('objects').get(id) as Y.Map<unknown>;
  record.observeDeep((events) => {
    for (const ev of events) {
      // Only direct field changes on the record (nested types report a
      // non-empty path, e.g. the Y.Text content).
      if (ev.path.length !== 0) continue;
      if (!('keys' in ev)) continue;
      const keys = new Set<string>();
      for (const k of ev.keys as Iterable<unknown>) {
        keys.add(Array.isArray(k) ? String(k[0]) : String(k));
      }
      if (keys.has('width') || keys.has('height')) touched.add(ev.transaction);
    }
  });
  return { writes: () => touched.size };
}

describe('story 9: text object (component)', () => {
  it('TC-12: a remote peer text change produces zero local setTextBox writes', async () => {
    await renderFullApp();
    const id = makeText(10, 10, 'Hello');
    await act(async () => {}); // let the initial local remeasure settle

    const counter = countBoxWrites(id);
    expect(counter.writes()).toBe(0);

    // A second real Y.Doc stands in for a remote peer.
    const remote = new Y.Doc();
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(hooks().getDoc()));
    act(() => {
      const record = remote.getMap('objects').get(id) as Y.Map<unknown>;
      const ytext = record.get('text') as Y.Text;
      remote.transact(() => ytext.insert(0, 'World '), 'remote-peer');
    });
    act(() => {
      Y.applyUpdate(hooks().getDoc(), Y.encodeStateAsUpdate(remote));
    });
    await act(async () => {});

    // The content changed locally...
    expect(getTextContent(hooks().getDoc(), id)!.toString()).toBe('World Hello');
    // ...but the stored box was NOT rewritten by the local client.
    expect(counter.writes()).toBe(0);
  });

  it('TC-12: a local edit writes the box exactly once', async () => {
    await renderFullApp();
    const id = makeText(10, 10, 'Hello');
    await act(async () => {});

    const counter = countBoxWrites(id);
    selectAndEdit(id);
    const ta = screen.getByTestId('text-textarea') as HTMLTextAreaElement;
    typeText(ta, 'Hello, board!');
    await act(async () => {});

    expect(counter.writes()).toBe(1);
    // The box matches the new content (non-zero, larger than before).
    const o = objectOf(id);
    expect(o.width).toBeGreaterThan(0);
    expect(o.height).toBeGreaterThan(0);
  });

  it('TC-13: a local size change whose remeasure equals the stored box writes nothing', async () => {
    await renderFullApp();
    // Empty text: the measured box is 0x0 at every size, so a size change
    // must not rewrite width/height.
    const id = makeText(10, 10);
    await act(async () => {});
    clickObject(id);
    const counter = countBoxWrites(id);

    act(() => {
      screen.getByTestId('text-size-XL').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await act(async () => {});

    expect(objectOf(id).size).toBe('XL');
    expect(counter.writes()).toBe(0);
  });

  it('TC-19: editing a text — caret at end, Enter inserts a newline, Escape ends editing (selected)', async () => {
    await renderFullApp();
    const id = makeText(10, 10, 'Hello');
    const ta = selectAndEdit(id);

    // Caret at the end of the content.
    expect(ta.value).toBe('Hello');
    expect(ta.selectionStart).toBe(5);
    expect(ta.selectionEnd).toBe(5);

    // Enter is never intercepted by the editor (the browser inserts the
    // newline natively; jsdom has no default action, so assert the keydown
    // is left un-prevented and then simulate the resulting input).
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    act(() => {
      ta.dispatchEvent(enter);
    });
    expect(enter.defaultPrevented).toBe(false);
    typeText(ta, 'Hello\n');
    expect(ta.value).toBe('Hello\n');
    expect(getTextContent(hooks().getDoc(), id)!.toString()).toBe('Hello\n');

    pressKey(ta, 'Escape');
    expect(screen.queryByTestId('text-textarea')).not.toBeInTheDocument();
    // Still selected, text kept.
    expect(hooks().getSelection()).toEqual([id]);
    expect(objectElement(id).hasAttribute('data-selected')).toBe(true);
  });

  it('TC-20: Escape with zero characters deletes the text and clears the selection', async () => {
    await renderFullApp();
    const id = makeText(10, 10);
    selectAndEdit(id);

    pressKey(screen.getByTestId('text-textarea'), 'Escape');

    expect(screen.queryByTestId('text-textarea')).not.toBeInTheDocument();
    expect(hooks().getObjects().some((o) => o.id === id)).toBe(false);
    expect(hooks().getSelection()).toEqual([]);
  });

  it('TC-21: the text toolbar shows S/M/L/XL (M pressed); XL changes size, position unchanged', async () => {
    await renderFullApp();
    const id = makeText(10, 10, 'Hello');
    clickObject(id);

    expect(screen.getByTestId('text-toolbar')).toBeInTheDocument();
    expect(screen.getByTestId('text-size-S')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('text-size-M')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('text-size-L')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('text-size-XL')).toHaveAttribute('aria-pressed', 'false');

    act(() => {
      screen.getByTestId('text-size-XL').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await act(async () => {});

    const o = objectOf(id);
    expect(o.size).toBe('XL');
    expect(o.x).toBe(10);
    expect(o.y).toBe(10);
    expect(screen.getByTestId('text-size-XL')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('text-size-M')).toHaveAttribute('aria-pressed', 'false');
  });

  it('TC-22: a single selected text renders only the e and w handles', async () => {
    await renderFullApp();
    const id = makeText(10, 10, 'Hello');
    clickObject(id);

    const handles = [...document.querySelectorAll('[data-handle]')].map((h) => h.getAttribute('data-handle'));
    expect(handles.sort()).toEqual(['e', 'w']);
  });

  it('TC-23: text + sticky selected -> all eight handles; resize repositions the text, font size unchanged', async () => {
    await renderFullApp();
    const noteId = makeNote(0, 0);
    const textId = makeText(300, 300, 'hi');
    // Select both.
    const note = hooks().getNotes().find((n) => n.id === noteId)!;
    firePointer(objectElement(noteId), 'pointerdown', note.x + 100 + 512, note.y + 100 + 384);
    firePointer(objectElement(noteId), 'pointerup', note.x + 100 + 512, note.y + 100 + 384);
    clickObject(textId, { shift: true });

    const handles = [...document.querySelectorAll('[data-handle]')].map((h) => h.getAttribute('data-handle'));
    expect(handles.sort()).toEqual(['e', 'n', 'ne', 'nw', 's', 'se', 'sw', 'w']);

    // Drag the SE corner outward.
    const se = document.querySelector('[data-handle="se"]')!;
    const textBefore = objectOf(textId);
    firePointer(se, 'pointerdown', 800, 700);
    fireWindowPointer('pointermove', 900, 800);
    fireWindowPointer('pointerup', 900, 800);
    await act(async () => {});

    const textAfter = objectOf(textId);
    expect(textAfter.x).not.toBe(textBefore.x);
    expect(textAfter.y).not.toBe(textBefore.y);
    // The font size is part of the object, not the layout: unchanged.
    expect(textAfter.size).toBe('M');
  });

  it('TC-24: a remote delete while editing unmounts the editor without error', async () => {
    await renderFullApp();
    const id = makeText(10, 10, 'Hello');
    selectAndEdit(id);
    expect(screen.getByTestId('text-textarea')).toBeInTheDocument();

    const remote = new Y.Doc();
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(hooks().getDoc()));
    act(() => {
      remote.getMap('objects').delete(id);
    });
    act(() => {
      Y.applyUpdate(hooks().getDoc(), Y.encodeStateAsUpdate(remote));
    });
    await act(async () => {});

    expect(screen.queryByTestId('text-textarea')).not.toBeInTheDocument();
    expect(hooks().getObjects().some((o) => o.id === id)).toBe(false);
  });

  it('TC-25: after typing, one Ctrl+Z restores the text and the stored box', async () => {
    await renderFullApp();
    const id = makeText(10, 10);
    const ta = selectAndEdit(id);

    // Typing accumulates (fireEvent.input sets the full value).
    typeText(ta, 'a');
    typeText(ta, 'ab');
    typeText(ta, 'abc');
    await act(async () => {});
    expect(getTextContent(hooks().getDoc(), id)!.toString()).toBe('abc');
    const grown = objectOf(id);
    expect(grown.width).toBeGreaterThan(0);

    // One Ctrl+Z: the whole typing burst (content + box writes) is one step.
    pressKey(ta, 'z', { ctrlKey: true });
    await act(async () => {});

    expect(getTextContent(hooks().getDoc(), id)!.toString()).toBe('');
    const reverted = objectOf(id);
    expect(reverted.width ?? 0).toBe(0);
    expect(reverted.height ?? 0).toBe(0);
    // Redo brings it back.
    expect(hooks().canRedo()).toBe(true);
    act(() => {
      hooks().redo();
    });
    expect(getTextContent(hooks().getDoc(), id)!.toString()).toBe('abc');
  });
});
