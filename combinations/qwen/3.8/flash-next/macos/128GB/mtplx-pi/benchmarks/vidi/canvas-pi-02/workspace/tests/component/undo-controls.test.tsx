import { fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { renderApp, flush, type AppHarness } from './appHarness';
import { createUndo, type UndoController } from '../../src/client/board/undo';
import { LOCAL_ORIGIN, moveObject, setStickyColor } from '../../src/shared/board-model';
import { dispatch } from './harness';

/**
 * Story 8, undo.controls at the component level (TC-18 to TC-21): the
 * buttons and the shortcuts.
 *
 * The buttons show exactly what the stacks say - empty history, disabled
 * buttons; disabled clicks change nothing; the five shortcut combinations
 * reach the controller and mark the event handled; and neither a read-only
 * board nor a keystroke that belongs to a text field can touch this
 * person's history.
 */

let harness: AppHarness | null = null;
let undoUnderTest: UndoController | null = null;

afterEach(() => {
  undoUnderTest?.destroy();
  undoUnderTest = null;
  harness = null;
});

function renderWithHistory(
  seed: { x: number; y: number; color?: 'yellow'; text?: string }[],
  options: { canEdit?: boolean } = {},
) {
  const built: UndoController[] = [];
  const harnessNow = renderApp(seed, {
    canEdit: options.canEdit,
    undoFactory: (doc: Y.Doc) => {
      const undo = createUndo(doc);
      built.push(undo);
      undoUnderTest = undo;
      return undo;
    },
  });
  harness = harnessNow;
  undoUnderTest = built[built.length - 1] ?? null;
  return harnessNow;
}

function pressKey(
  key: string,
  options: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean } = {},
  target: EventTarget = window,
): Promise<{ defaultPrevented: boolean }> {
  const event = new KeyboardEvent('keydown', {
    key,
    ctrlKey: options.ctrlKey ?? false,
    metaKey: options.metaKey ?? false,
    shiftKey: options.shiftKey ?? false,
    bubbles: true,
    cancelable: true,
  });
  return dispatch(target, event);
}

function notePosition(h: AppHarness, id: string): { x: number; y: number } {
  const note = h.notes().find((entry) => entry.id === id);
  if (!note) throw new Error(`note ${id} is gone`);
  return { x: note.x, y: note.y };
}

/** One isolated step: a move to x = 500, with capture groups closed on both sides. */
function moveStep(h: AppHarness, id: string): void {
  const undo = undoUnderTest!;
  undo.boundary();
  h.doc.transact(() => moveObject(h.doc, id, 500, 100), LOCAL_ORIGIN);
  undo.boundary();
}

describe('undo.controls at the component level (TC-18 to TC-21)', () => {
  it('TC-18 with nothing in the history, both buttons are disabled and say so', async () => {
    const h = renderWithHistory([{ x: 300, y: 100 }]);
    await flush();

    const before = JSON.parse(JSON.stringify(h.notes()));

    for (const name of ['Undo', 'Redo']) {
      const button = h.button(name);
      expect(button.disabled, `${name} should start disabled`).toBe(true);
      expect(button.getAttribute('aria-disabled')).toBe('true');
      // A click on the disabled button must be inert, in either of the two
      // ways a harness can produce one.
      fireEvent.click(button);
      button.click();
      await flush();
    }

    // Empty stacks are never entered, never thrown about, never half-applied.
    expect(JSON.parse(JSON.stringify(h.notes()))).toEqual(before);
  });

  it('TC-19 Ctrl+Z, Cmd+Z, Ctrl+Shift+Z, Cmd+Shift+Z and Ctrl+Y all reach the controller, preventDefault included', async () => {
    const h = renderWithHistory([{ x: 300, y: 100 }]);
    await flush();
    const [id] = h.notes().map((note) => note.id);
    const undo = undoUnderTest!;

    moveStep(h, id!);
    const moved = notePosition(h, id!);
    expect(moved.x).toBeCloseTo(500, 1);

    // Ctrl+Z: undo. The note comes back.
    let result = await pressKey('z', { ctrlKey: true });
    expect(result.defaultPrevented).toBe(true);
    expect(notePosition(h, id!).x).toBeCloseTo(300, 1);
    expect(undo.stackSize()).toEqual({ undo: 0, redo: 1 });

    // Ctrl+Y: redo. The note goes forward again.
    result = await pressKey('y', { ctrlKey: true });
    expect(result.defaultPrevented).toBe(true);
    expect(notePosition(h, id!).x).toBeCloseTo(500, 1);

    // Ctrl+Z again, then Cmd+Shift+Z: undo and redo on the Mac side of the
    // keyboard, both reaching the controller.
    result = await pressKey('z', { ctrlKey: true });
    expect(result.defaultPrevented).toBe(true);
    expect(notePosition(h, id!).x).toBeCloseTo(300, 1);
    result = await pressKey('z', { metaKey: true, shiftKey: true });
    expect(result.defaultPrevented).toBe(true);
    expect(notePosition(h, id!).x).toBeCloseTo(500, 1);

    // Cmd+Z is still undo: a fresh step, then undo it with the plain combo.
    undo.boundary();
    h.doc.transact(() => setStickyColor(h.doc, id!, 'pink'), LOCAL_ORIGIN);
    undo.boundary();
    result = await pressKey('z', { metaKey: true });
    expect(result.defaultPrevented).toBe(true);
    expect(h.notes().find((note) => note.id === id)!.color).toBe('yellow');

    // And the negative control: a bare z is nobody's shortcut.
    const before = JSON.parse(JSON.stringify(h.notes()));
    result = await pressKey('z');
    expect(result.defaultPrevented).toBe(false);
    expect(JSON.parse(JSON.stringify(h.notes()))).toEqual(before);
  });

  it('TC-20 a board that cannot be edited ignores the shortcuts and greys the buttons out', async () => {
    const h = renderWithHistory([{ x: 300, y: 100 }], { canEdit: false });
    await flush();
    const [id] = h.notes().map((note) => note.id);
    const undo = undoUnderTest!;

    // There IS a history - built outside the UI, since no input path may
    // write here. The buttons must still refuse it, and the shortcuts must
    // not reach the controller either.
    moveStep(h, id!);
    await flush();
    expect(undo.canUndo()).toBe(true);

    for (const name of ['Undo', 'Redo']) {
      const button = h.button(name);
      expect(button.disabled, `${name} must be greyed out while read-only`).toBe(true);
      expect(button.getAttribute('aria-disabled')).toBe('true');
    }

    const before = JSON.parse(JSON.stringify(h.notes()));
    const result = await pressKey('z', { ctrlKey: true });
    expect(result.defaultPrevented).toBe(false); // the shortcut itself is refused
    await flush();
    expect(JSON.parse(JSON.stringify(h.notes()))).toEqual(before); // and inert
    expect(undo.stackSize().undo).toBe(1); // controller untouched
  });

  it('TC-21 Ctrl+Z with the focus in a text field never touches the board history', async () => {
    const h = renderWithHistory([{ x: 300, y: 100 }]);
    await flush();
    const [id] = h.notes().map((note) => note.id);
    const undo = undoUnderTest!;

    moveStep(h, id!);
    expect(undo.stackSize().undo).toBe(1);

    // A text field that is not part of the board - the share-link input the
    // design names, modelled as its jsdom equivalent - keeps its own
    // Ctrl+Z: the board's history is not called, and the event is not
    // swallowed (the field would undo its own text otherwise).
    const field = document.createElement('input');
    field.type = 'text';
    field.value = 'hello';
    h.container.appendChild(field);

    const result = await pressKey('z', { ctrlKey: true }, field);
    expect(result.defaultPrevented).toBe(false);
    expect(undo.stackSize().undo).toBe(1); // history untouched
    expect(notePosition(h, id!).x).toBeCloseTo(500, 1); // and the note stayed put
  });
});