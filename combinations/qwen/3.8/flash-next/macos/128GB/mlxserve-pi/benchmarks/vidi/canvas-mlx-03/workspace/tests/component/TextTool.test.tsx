// Story 9, tasks.md task 7 — tool mode (TC-14..18), component.
//
// The Text tool is a pure client state machine: a keyboard or toolbar toggle, a
// click-to-create that works even on top of an object, a cursor change, and it must
// not exist on a board that cannot be edited.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act, screen, cleanup } from '@testing-library/react';
import * as Y from 'yjs';
import BoardApp from '../../src/client/board/BoardApp.tsx';
import { initDoc, objectSnapshots, createSticky } from '../../src/shared/board-model.ts';

const viewport = () => document.querySelector('[data-testid="viewport"]') as HTMLElement;
const toolButton = (name: string) => screen.getByRole('button', { name }) as HTMLElement;
const texts = () => objectSnapshots(doc).filter((o) => o.type === 'text');

function firePointer(el: Element, type: string, x = 20, y = 20) {
  act(() => {
    el.dispatchEvent(
      new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true }),
    );
  });
}
function fireKey(key: string) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}

let doc: Y.Doc;

function setup(readonly = false, pre = true) {
  doc = new Y.Doc();
  initDoc(doc);
  if (pre) createSticky(doc, { x: 400, y: 300 });
  render(<BoardApp doc={doc} connection={readonly ? 'load_failed' : undefined} />);
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('story 9 tool mode', () => {
  it('TC-14: T / V (and the toolbar buttons) switch the tool', () => {
    setup();
    // Start in select.
    expect(toolButton('Select').getAttribute('aria-pressed')).toBe('true');
    // T enters text.
    fireKey('t');
    expect(toolButton('Text').getAttribute('aria-pressed')).toBe('true');
    expect(toolButton('Select').getAttribute('aria-pressed')).toBe('false');
    // V returns to select.
    fireKey('v');
    expect(toolButton('Select').getAttribute('aria-pressed')).toBe('true');
    // The toolbar button toggles too.
    firePointer(toolButton('Text'), 'click');
    expect(toolButton('Text').getAttribute('aria-pressed')).toBe('true');
    fireKey('v');
    expect(toolButton('Select').getAttribute('aria-pressed')).toBe('true');
  });

  it('TC-15: a read-only board has no text tool', () => {
    setup(true);
    // No Text tool button is offered at all.
    expect(screen.queryByRole('button', { name: 'Text' })).toBeNull();
    // And the T shortcut does nothing (cursor stays default).
    fireKey('t');
    expect(viewport().style.cursor).not.toBe('text');
  });

  it('TC-16: click empty board with the text tool creates exactly one text, top-left at the click', () => {
    setup(false, false);
    fireKey('t');
    const before = texts().length;
    firePointer(viewport(), 'pointerdown', 320, 210);
    firePointer(viewport(), 'pointerup', 320, 210);
    const created = texts();
    expect(created.length).toBe(before + 1);
    // The world point equals the screen point at the default identity camera; the new
    // text is anchored on its top-left there.
    const obj = created[0]!;
    expect(obj.x).toBe(320);
    expect(obj.y).toBe(210);
    // Exactly one, and no marquee / second object from the same click.
    expect(objectSnapshots(doc).length).toBe(1);
  });

  it('TC-17: click ON an existing object with the text tool still creates text, does not select/drag', () => {
    setup();
    const sticky = objectSnapshots(doc).find((o) => o.type === 'sticky')!;
    fireKey('t');
    // Click on top of the sticky note.
    firePointer(viewport(), 'pointerdown', 420, 320);
    firePointer(viewport(), 'pointerup', 420, 320);
    // A new text was created at the point (a create happened).
    expect(texts().length).toBe(1);
    // The sticky was NOT the thing edited and is not selected-as-editing; its position
    // is unchanged (no drag).
    const after = objectSnapshots(doc).find((o) => o.id === sticky.id)!;
    expect(after.x).toBe(sticky.x);
    expect(after.y).toBe(sticky.y);
    // And the sticky did not open its editor.
    expect(screen.queryByTestId('sticky-text-editor')).toBeNull();
  });

  it('TC-18: cursor is text while placing and the selection is unchanged', () => {
    setup();
    // Select the sticky first.
    const sticky = objectSnapshots(doc).find((o) => o.type === 'sticky')!;
    const stickyEl = document.querySelector(`[data-note-id="${sticky.id}"]`) as HTMLElement;
    firePointer(stickyEl, 'pointerdown');
    firePointer(stickyEl, 'pointerup');
    // Switch to the text tool without touching the board surface.
    fireKey('t');
    expect(viewport().style.cursor).toBe('text');
    // The selection is preserved: the overlay for the sticky is still shown.
    const overlay = document.querySelector('[data-testid="selection-overlay"]');
    expect(overlay).not.toBeNull();
  });

  it('placing a text enters its edit; Escape in the editor ends it, Escape in placing mode reverts to select', () => {
    setup(false, false);
    fireKey('t');
    firePointer(viewport(), 'pointerdown', 100, 100);
    firePointer(viewport(), 'pointerup', 100, 100);
    // The freshly created text is immediately editable.
    const ta = screen.getByTestId('text-object-editor') as HTMLElement;
    // Escape inside the editor ends the edit (a window Escape is swallowed by it).
    act(() => {
      ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    expect(screen.queryByTestId('text-object-editor')).toBeNull();
    vi.advanceTimersByTime(48);
    // Escape while merely placing (not editing) drops the tool back to Select.
    fireKey('t');
    fireKey('Escape');
    expect(toolButton('Select').getAttribute('aria-pressed')).toBe('true');
  });
});
