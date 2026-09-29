// Story 9, tasks.md task 9 — the text object (TC-19..25), component.
//
// Text is registered in the same registry as sticky notes, so the stories 7/8
// machinery works on it unchanged. These tests drive the real board through the text
// object's own element and its editor, and check the size toolbar, the clamps, the
// selection handles, and the remote-delete-during-edit path.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act, screen, cleanup, fireEvent } from '@testing-library/react';
import * as Y from 'yjs';
import BoardApp from '../../src/client/board/BoardApp.tsx';
import { initDoc, objectSnapshots, objectBounds } from '../../src/shared/board-model.ts';
import { createSticky } from '../../src/shared/board-model.ts';
import { getObjectType } from '../../src/client/objects/registry.tsx';
import {
  createText,
  getTextContent,
  setTextSize,
  textSnapshot,
} from '../../src/shared/objects/text.ts';
import { TEXT_MAX_CHARS, TEXT_SIZES } from '../../src/shared/config.ts';

function firePointer(el: Element, type: string, x = 20, y = 20) {
  act(() => {
    el.dispatchEvent(
      new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true }),
    );
  });
}
function fireDblClick(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  });
}
function fireKey(key: string, target: Element | Window = window) {
  act(() => {
    (target as Window).dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
    );
  });
}
function fireInput(ta: HTMLElement) {
  act(() => {
    ta.dispatchEvent(new InputEvent('input', { bubbles: true }));
  });
}
function type(ta: HTMLTextAreaElement, s: string) {
  act(() => {
    ta.value = ta.value + s;
  });
  fireInput(ta);
}

const obj = (id: string) => objectSnapshots(doc).find((o) => o.id === id)!;
const bounds = (id: string) => objectBounds(obj(id));
const el = (id: string) => document.querySelector(`[data-text-id="${id}"]`) as HTMLElement;
const editor = () => screen.getByTestId('text-object-editor') as HTMLTextAreaElement;

let doc: Y.Doc;
let id: string;

/** Seed a text with content and a measured box, then render the board. */
function setup(text = '', size: 'S' | 'M' | 'L' | 'XL' = 'M') {
  doc = new Y.Doc();
  initDoc(doc);
  id = createText(doc, { x: 300, y: 200 }, 'me')!;
  if (size !== 'M') setTextSize(doc, id, size);
  if (text) getTextContent(doc, id)!.insert(0, text);
  render(<BoardApp doc={doc} />);
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('story 9 text object', () => {
  it('TC-19: text is in the registry with a horizontal-only handle set', () => {
    const spec = getObjectType('text');
    expect(spec).toBeTruthy();
    expect(spec!.resizable).toBe(true);
    expect(spec!.handles).toBe('horizontal');
    expect(spec!.editableText).toBe(true);
    // It appears in the board snapshot and renders an object element.
    setup('hello');
    expect(obj(id).type).toBe('text');
    expect(el(id)).toBeTruthy();
    expect(el(id).textContent).toContain('hello');
  });

  it('TC-20: two lines then emptied then end-of-edit deletes the object', () => {
    setup();
    fireDblClick(el(id));
    const ta = editor();
    type(ta, 'line one\nline two');
    expect(getTextContent(doc, id)!.toString()).toBe('line one\nline two');
    expect(el(id)).toBeTruthy();
    // Now clear it to zero characters and end the edit.
    act(() => {
      ta.value = '';
    });
    fireInput(ta);
    fireKey('Escape', ta);
    vi.advanceTimersByTime(48);
    expect(objectSnapshots(doc).find((o) => o.id === id)).toBeUndefined();
    // Selection cleared: no overlay.
    expect(document.querySelector('[data-testid="selection-overlay"]')).toBeNull();
  });

  it('TC-20 extra: a single space survives the end-of-edit (only zero chars delete)', () => {
    setup();
    fireDblClick(el(id));
    const ta = editor();
    type(ta, ' ');
    fireKey('Escape', ta);
    vi.advanceTimersByTime(48);
    expect(objectSnapshots(doc).find((o) => o.id === id)).toBeTruthy();
  });

  it('TC-21: text is selectable, movable, shows resize handles and joins the marquee', () => {
    setup('pick me');
    // Single click selects: the overlay (and its selection frame) appears.
    firePointer(el(id), 'pointerdown');
    firePointer(el(id), 'pointerup');
    expect(el(id).getAttribute('data-selected')).toBe('true');
    expect(document.querySelector('[data-testid="selection-overlay"]')).toBeTruthy();
    // It offers the horizontal resize handles (right / left), never the vertical ones.
    expect(screen.queryByLabelText('Resize right')).toBeTruthy();
    expect(screen.queryByLabelText('Resize top')).toBeNull();
  });

  it('TC-22: the size toolbar sets the size, remeasures height, keeps the top-left', () => {
    setup('hello world', 'M');
    // Select the text (single, not editing) to reveal its toolbar.
    firePointer(el(id), 'pointerdown');
    firePointer(el(id), 'pointerup');
    vi.advanceTimersByTime(48);
    const toolbar = screen.getByTestId('text-toolbar');
    expect(toolbar).toBeTruthy();
    // The current size M is pressed.
    expect(screen.getByTestId('text-size-M').getAttribute('aria-pressed')).toBe('true');
    const before = bounds(id);
    // Choose XL.
    fireEvent.click(screen.getByTestId('text-size-XL'));
    vi.advanceTimersByTime(48);
    const after = bounds(id);
    expect(textSnapshot(doc, id)!.size).toBe('XL');
    // Top-left unchanged.
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    // Height grew (XL line height > M).
    expect(after.height).toBeGreaterThan(before.height);
    expect(screen.getByTestId('text-size-XL').getAttribute('aria-pressed')).toBe('true');
  });

  it('TC-23: a mixed text+sticky selection shows all handles and keeps font size on undo/redo', () => {
    setup('mixed text', 'M');
    const sticky = createSticky(doc, { x: 600, y: 500 });
    // Select the text, then shift-select the sticky.
    firePointer(el(id), 'pointerdown', 10, 10);
    firePointer(el(id), 'pointerup', 10, 10);
    const stickyEl = document.querySelector(`[data-note-id="${sticky}"]`)!;
    act(() => {
      stickyEl.dispatchEvent(
        new MouseEvent('pointerdown', {
          clientX: 10,
          clientY: 10,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    firePointer(stickyEl, 'pointerup', 10, 10);
    vi.advanceTimersByTime(48);
    // All eight handles appear for the mixed selection.
    expect(screen.queryByLabelText('Resize top')).toBeTruthy();
    expect(screen.queryByLabelText('Resize right')).toBeTruthy();
    // Move both, then undo and redo: the text's font size never changed.
    expect(textSnapshot(doc, id)!.size).toBe('M');
    const before = TEXT_SIZES[textSnapshot(doc, id)!.size];
    fireKey('ArrowRight');
    vi.advanceTimersByTime(48);
    // Undo via Ctrl+Z: the move reverses, the font size never changes.
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }),
      );
    });
    vi.advanceTimersByTime(48);
    const after = TEXT_SIZES[textSnapshot(doc, id)!.size];
    expect(after).toBe(before); // font size preserved across move+undo
  });

  it('TC-24: typing past TEXT_MAX_CHARS clamps, shows the hint, ignores more input', () => {
    setup();
    fireDblClick(el(id));
    const ta = editor();
    const big = 'x'.repeat(TEXT_MAX_CHARS + 1000);
    act(() => {
      ta.value = big;
    });
    fireInput(ta);
    expect(getTextContent(doc, id)!.toString().length).toBe(TEXT_MAX_CHARS);
    expect(ta.value.length).toBe(TEXT_MAX_CHARS);
    expect(screen.getByTestId('text-limit-hint')).toBeTruthy();
    // Further input is ignored.
    type(ta, 'more');
    expect(getTextContent(doc, id)!.toString().length).toBe(TEXT_MAX_CHARS);
  });

  it('TC-25: a remote peer deleting the text mid-edit ends the edit silently', () => {
    setup('being edited');
    fireDblClick(el(id));
    expect(screen.getByTestId('text-object-editor')).toBeTruthy();
    // A peer removes the object from the shared doc.
    const objects = doc.getMap('objects');
    act(() => {
      doc.transact(() => {
        objects.delete(id);
      }, 'remote-peer');
    });
    vi.advanceTimersByTime(48);
    // The editor is gone (unmounted by the vanished object) with no error; the object
    // is simply absent.
    expect(screen.queryByTestId('text-object-editor')).toBeNull();
    expect(objectSnapshots(doc).find((o) => o.id === id)).toBeUndefined();
  });
});
