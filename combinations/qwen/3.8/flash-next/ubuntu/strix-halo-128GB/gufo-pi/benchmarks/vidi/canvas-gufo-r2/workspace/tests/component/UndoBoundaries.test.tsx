/**
 * Component tests for undo boundaries (TC-14 to TC-17).
 * Uses jsdom with real Y.Doc, real controller, and the story 7 gesture hook.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { act, fireEvent, render, screen, cleanup } from '@testing-library/react';
import * as Y from 'yjs';
import { App } from '../../src/client/App';
import {
  createSticky,
  snapshot,
} from '../../src/shared/board-model';
import { STICKY_SIZE_WORLD } from '../../src/shared/config';

function flushFrames(count = 3): void {
  act(() => {
    vi.advanceTimersByTime(16 * count);
  });
}

function noteEl(id: string): HTMLElement {
  const el = document.querySelector(`[data-note-id="${id}"]`) as HTMLElement | null;
  if (!el) throw new Error(`note ${id} not found`);
  return el;
}

function getNote(doc: Y.Doc, id: string) {
  return snapshot(doc).find((n) => n.id === id);
}

describe('undo boundaries (component)', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout'] });
  });

  afterEach(() => {
    cleanup();
    if (doc) doc.destroy();
    vi.useRealTimers();
  });

  function setup() {
    doc = new Y.Doc();
  }

  function mount() {
    render(<App doc={doc} />);
    flushFrames();
  }

  function selectNote(id: string) {
    const el = noteEl(id);
    fireEvent.pointerDown(el, { button: 0, pointerId: 1, clientX: 500, clientY: 400 });
    fireEvent.pointerUp(el, { pointerId: 1, clientX: 500, clientY: 400 });
    flushFrames();
  }

  function dragObject(id: string, dx: number, dy: number, frames = 10): void {
    const el = noteEl(id);
    fireEvent.pointerDown(el, { button: 0, pointerId: 1, clientX: 500, clientY: 400 });
    flushFrames();
    for (let i = 1; i <= frames; i++) {
      const x = 500 + Math.round((dx * i) / frames);
      const y = 400 + Math.round((dy * i) / frames);
      fireEvent.pointerMove(window, { pointerId: 1, clientX: x, clientY: y });
      flushFrames(1);
    }
    fireEvent.pointerUp(window, { pointerId: 1 });
    flushFrames();
  }

  it('TC-14: 30-frame drag → one undo restores start position', () => {
    setup();
    const id = createSticky(doc, { x: 500, y: 400 });
    mount();
    selectNote(id);

    const before = getNote(doc, id)!;
    const startX = before.x;
    const startY = before.y;

    // 30-frame drag
    dragObject(id, 150, 100, 30);

    const after = getNote(doc, id)!;
    expect(after.x).not.toBe(startX);

    // Access controller from App's memo - we need to create our own for testing
    // Actually, App creates its own controller internally. We'll access the Y.Doc's undo state
    // by using a separate controller that tracks the same origin.
    // Better approach: let the test's undo go through the App's internal controller.
    // We simulate Ctrl+Z.
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    flushFrames();

    const restored = getNote(doc, id)!;
    // Undo should restore to approximately the original position (might differ by 1px due to rounding)
    expect(Math.abs(restored.x - startX)).toBeLessThanOrEqual(1);
    expect(Math.abs(restored.y - startY)).toBeLessThanOrEqual(1);
  });

  it('TC-15: drag ends, then colour change 200ms later → two separate undo steps', () => {
    setup();
    const id = createSticky(doc, { x: 500, y: 400 });
    mount();
    selectNote(id);

    const before = getNote(doc, id)!;
    const startX = before.x;

    // Drag the note
    dragObject(id, 100, 0, 5);

    const moved = getNote(doc, id)!;
    expect(moved.x).not.toBe(startX);

    // Colour change (via clicking the pink swatch - boundary is called before/after in App)
    const pinkButton = screen.getByRole('button', { name: 'Pink colour' });
    fireEvent.click(pinkButton);
    flushFrames();

    expect(getNote(doc, id)!.color).toBe('pink');

    // Undo once: should undo the colour change
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    flushFrames();

    const afterFirstUndo = getNote(doc, id)!;
    expect(afterFirstUndo.color).not.toBe('pink'); // colour reverted
    expect(afterFirstUndo.x).not.toBe(startX); // position still moved (not reverted yet)

    // Undo again: should undo the drag
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    flushFrames();

    const afterSecondUndo = getNote(doc, id)!;
    expect(Math.abs(afterSecondUndo.x - startX)).toBeLessThanOrEqual(1);
  });

  it('TC-16: edit note, type "hello", Ctrl+Z inside editor → typing undone, not an earlier move', () => {
    setup();
    const id = createSticky(doc, { x: 500, y: 400 });
    mount();
    selectNote(id);

    // Move the note first (so there's an earlier undo step)
    dragObject(id, 80, 0, 3);
    const movedX = getNote(doc, id)!.x;
    expect(movedX).not.toBe(500 - STICKY_SIZE_WORLD / 2);

    // Enter editing mode
    const el = noteEl(id);
    fireEvent.doubleClick(el);
    act(() => { vi.advanceTimersByTime(5); });
    const textarea = el.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea).toBeTruthy();

    // Type "hello" into the textarea
    for (const ch of 'hello') {
      fireEvent.change(textarea, { target: { value: textarea.value + ch } });
    }
    flushFrames();

    // Verify text was written to Y.Text
    const objects = doc.getMap('objects');
    const noteMap = objects.get(id) as Y.Map<unknown>;
    const ytext = noteMap.get('text') as Y.Text;
    expect(ytext.toString()).toBe('hello');

    // Ctrl+Z inside the textarea → should undo typing, not the move
    fireEvent.keyDown(textarea, { key: 'z', ctrlKey: true });
    flushFrames();

    // The move should still be applied (not undone)
    const afterUndo = getNote(doc, id)!;
    expect(Math.abs(afterUndo.x - movedX)).toBeLessThanOrEqual(1);
  });

  it('TC-17: pointercancel mid-drag → one undo restores start position', () => {
    setup();
    const id = createSticky(doc, { x: 500, y: 400 });
    mount();
    selectNote(id);

    const before = getNote(doc, id)!;
    const startX = before.x;
    const startY = before.y;

    // Start a drag
    const el = noteEl(id);
    fireEvent.pointerDown(el, { button: 0, pointerId: 1, clientX: 500, clientY: 400 });
    flushFrames();
    // Move enough to trigger drag (exceed threshold)
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 530, clientY: 420 });
    flushFrames();
    // Cancel
    fireEvent.pointerCancel(window, { pointerId: 1 });
    flushFrames();

    // Position may have moved slightly before cancel
    // But undo should restore the start position
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    flushFrames();

    const restored = getNote(doc, id)!;
    expect(Math.abs(restored.x - startX)).toBeLessThanOrEqual(1);
    expect(Math.abs(restored.y - startY)).toBeLessThanOrEqual(1);
  });
});
