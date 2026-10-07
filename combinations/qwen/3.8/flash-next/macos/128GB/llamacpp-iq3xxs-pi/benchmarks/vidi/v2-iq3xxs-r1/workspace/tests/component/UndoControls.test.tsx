import { describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { Board } from '../../src/client/board/Board';
import { REDO_BUTTON_TOOLTIP, UNDO_BUTTON_TOOLTIP } from '../../src/client/board/UndoButtons';
import { CLOSE_BOARD_LOAD_FAILED } from '../../src/shared/protocol';
import { NUDGE_STEP_WORLD } from '../../src/shared/config';
import type { SeedNote } from '../../src/client/canvas/testHooks';
import { TEST_BOARD_ID, dispatchKey, flushFrame, flushUntil } from './util';
import { clickElement, clickWithPointer, getSnapshot, hook, noteEl } from './stickyUtil';
import { FakeClock, FakeProvider } from './fake-sync';

/**
 * Story 8 — undo shortcuts and buttons (undo.shortcuts, undo.buttons, undo.not_editable).
 *
 * The board is rendered as a person reaches it, the notes come from the same fixture
 * path the browser tests use, and the assertions are about what the *user* can do:
 * is the button dark, did the shortcut move the note back, was the browser's own
 * action taken away.
 */

const undoButton = () => screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement;
const redoButton = () => screen.getByRole('button', { name: 'Redo' }) as HTMLButtonElement;

function seed(specs: readonly SeedNote[]): string[] {
  let ids: string[] = [];
  act(() => {
    ids = hook().seedNotes(specs);
  });
  return ids;
}

const noteX = (id: string): number => getSnapshot().find((n) => n.id === id)!.x;

/** A key pressed while a specific element (not the board) has focus. */
function keyOn(
  el: Element,
  keys: { key: string; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean },
): boolean {
  const event = new KeyboardEvent('keydown', {
    key: keys.key,
    ctrlKey: keys.ctrlKey ?? false,
    metaKey: keys.metaKey ?? false,
    shiftKey: keys.shiftKey ?? false,
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    el.dispatchEvent(event);
  });
  return event.defaultPrevented;
}

/** A selected note, then `steps` separate nudge steps (each is one undo step). */
function nudgedNote(steps: number): string {
  const [id] = seed([{ x: 100, y: 100, color: 'yellow', text: 'nudge me' }]);
  clickWithPointer(noteEl(0), { x: 140, y: 140 });
  for (let i = 0; i < steps; i++) expect(dispatchKey({ key: 'ArrowRight' })).toBe(true);
  return id!;
}

describe('undo.buttons — the toolbar says what is available', () => {
  // TC-18: nothing done yet, so both buttons are dark (boundary: empty stacks).
  it('TC-18 shows Undo and Redo disabled while the history is empty', () => {
    render(<Board boardId={TEST_BOARD_ID} sync={false} />);
    expect(hook().canUndo()).toBe(false);
    expect(hook().canRedo()).toBe(false);

    expect(undoButton().disabled).toBe(true);
    expect(redoButton().disabled).toBe(true);
    expect(undoButton().getAttribute('aria-disabled')).toBe('true');
    expect(redoButton().getAttribute('aria-disabled')).toBe('true');
    // The tooltip is where the shortcut is written down.
    expect(undoButton().title).toBe(UNDO_BUTTON_TOOLTIP);
    expect(redoButton().title).toBe(REDO_BUTTON_TOOLTIP);
    expect(UNDO_BUTTON_TOOLTIP).toBe('Undo (Ctrl/Cmd+Z)');
    expect(REDO_BUTTON_TOOLTIP).toBe('Redo (Ctrl/Cmd+Shift+Z)');
  });

  // The buttons light up and go dark again with the stacks.
  it('enables Undo after a change and Redo after undoing it', async () => {
    render(<Board boardId={TEST_BOARD_ID} sync={false} />);
    const id = nudgedNote(1);
    await flushFrame();
    expect(undoButton().disabled).toBe(false);
    expect(redoButton().disabled).toBe(true);

    act(() => expect(hook().undo()).toBe(true));
    await flushUntil(() => undoButton().disabled && !redoButton().disabled);
    expect(undoButton().disabled).toBe(true);
    expect(redoButton().disabled).toBe(false);

    clickElement(redoButton());
    // The redo is a board-level change: wait for the frame that commits it, then check
    // the number we expected, not merely that something moved.
    await flushUntil(() => noteX(id) !== 100);
    expect(noteX(id)).toBeCloseTo(100 + NUDGE_STEP_WORLD, 6);
    expect(redoButton().disabled).toBe(true);
  });
});

describe('undo.shortcuts — the keys step through my own changes', () => {
  // TC-19: Ctrl/Cmd+Z undo; Ctrl/Cmd+Shift+Z, Cmd+Shift+Z and Ctrl+Y redo, each
  // with the browser's own action taken away.
  it('TC-19 answers every documented shortcut with a step', async () => {
    render(<Board boardId={TEST_BOARD_ID} sync={false} />);
    const id = nudgedNote(3);
    await flushFrame();
    const start = 100;
    const after = 100 + 3 * NUDGE_STEP_WORLD;
    expect(noteX(id)).toBeCloseTo(after, 6);

    // Three undo presses: Ctrl+Z, Cmd+Z, then Ctrl+Z again.
    for (const press of [
      { key: 'z', ctrlKey: true },
      { key: 'z', metaKey: true },
      { key: 'z', ctrlKey: true },
    ] as const) {
      expect(dispatchKey(press)).toBe(true);
      await flushFrame();
    }
    expect(noteX(id)).toBeCloseTo(start, 6);
    expect(undoButton().disabled).toBe(true);
    expect(redoButton().disabled).toBe(false);

    // Three redo presses, one per documented combination.
    for (const press of [
      { key: 'z', ctrlKey: true, shiftKey: true },
      { key: 'z', metaKey: true, shiftKey: true },
      { key: 'y', ctrlKey: true },
    ] as const) {
      expect(dispatchKey(press)).toBe(true);
      await flushFrame();
    }
    expect(noteX(id)).toBeCloseTo(after, 6);
    expect(undoButton().disabled).toBe(false);
    expect(redoButton().disabled).toBe(true);
  });

  // TC-20: a board that could not be loaded is not undone (negative).
  it('TC-20 ignores the shortcuts and keeps the buttons dark on a board that failed to load', async () => {
    const provider = new FakeProvider();
    const clock = new FakeClock();
    render(<Board boardId={TEST_BOARD_ID} sync connect={{ after: clock.after }} provider={provider} />);
    act(() => {
      provider.emitStatus('connecting');
      provider.emitStatus('connected');
      provider.emitSync(true);
    });
    await flushFrame();

    // A step of mine exists, and then the board locks.
    const id = nudgedNote(1);
    await flushFrame();
    const moved = noteX(id);
    expect(undoButton().disabled).toBe(false);

    act(() => provider.emitConnectionClose(CLOSE_BOARD_LOAD_FAILED));
    await flushFrame();

    // Undo and Redo are unavailable even though there is something I could undo.
    expect(undoButton().disabled).toBe(true);
    expect(redoButton().disabled).toBe(true);
    expect(dispatchKey({ key: 'z', ctrlKey: true })).toBe(false);
    expect(dispatchKey({ key: 'z', ctrlKey: true, shiftKey: true })).toBe(false);
    expect(dispatchKey({ key: 'y', ctrlKey: true })).toBe(false);
    await flushFrame();
    expect(noteX(id)).toBeCloseTo(moved, 6);
    expect(hook().canUndo()).toBe(true);
  });

  // TC-21: Ctrl+Z typed in an ordinary field of the page is left alone (negative).
  it('TC-21 leaves the browser undo alone when a field that is not the board has focus', async () => {
    render(<Board boardId={TEST_BOARD_ID} sync={false} />);
    const id = nudgedNote(1);
    await flushFrame();
    const moved = noteX(id);

    // The share panel's link field: a place where Ctrl+Z belongs to the browser.
    await clickElement(screen.getByTestId('share-button'));
    await flushFrame();
    const link = screen.getByTestId('share-link');
    expect(keyOn(link, { key: 'z', ctrlKey: true })).toBe(false);
    expect(keyOn(link, { key: 'z', metaKey: true })).toBe(false);
    await flushFrame();

    // Nothing of mine was stepped back.
    expect(noteX(id)).toBeCloseTo(moved, 6);
    expect(hook().canUndo()).toBe(true);
    expect(undoButton().disabled).toBe(false);
  });
});
