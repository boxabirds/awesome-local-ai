/**
 * Story 8 component tests — the Undo / Redo controls and keyboard.
 *
 * The buttons and the shortcuts are two ways to reach the same controller; these
 * check both agree with the history, and that a board which cannot be edited
 * offers neither (PRD undo.buttons, undo.keyboard, undo.text, undo.not_editable).
 */

import type * as Y from 'yjs';
import { act, fireEvent } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { snapshot, type StickySnapshot } from '../../src/shared/board-model';
import { CLOSE_BOARD_LOAD_FAILED } from '../../src/shared/protocol';
import { canRedo, canUndo, redoButton, undoButton } from './boardHarness';
import { fireKey, renderSelection } from './selectionHarness';
import {
  dblClickNote,
  flushFrames,
  renderApp,
  seedSticky,
  textareaFor,
  typeInto,
} from './stickyHarness';
import { standInRoom } from './standInRoom';

function noteCount(doc: Y.Doc): number {
  return (snapshot(doc) as StickySnapshot[]).length;
}

function textOf(doc: Y.Doc, id: string): string {
  return (snapshot(doc) as StickySnapshot[]).find((n) => n.id === id)?.text ?? '';
}

describe('undo buttons (undo.buttons)', () => {
  it('TC-18: each button is enabled exactly when its history has a step', () => {
    const doc = renderSelection();

    // Nothing done yet: both dim and inert.
    expect(undoButton().disabled).toBe(true);
    expect(undoButton().getAttribute('aria-disabled')).toBe('true');
    expect(redoButton().disabled).toBe(true);

    // A change makes Undo live, Redo still empty.
    seedSticky(doc);
    expect(undoButton().disabled).toBe(false);
    expect(undoButton().getAttribute('aria-disabled')).toBe('false');
    expect(canRedo()).toBe(false);

    // Undoing moves the step across to the redo side.
    fireEvent.click(undoButton());
    expect(noteCount(doc)).toBe(0);
    expect(undoButton().disabled).toBe(true);
    expect(redoButton().disabled).toBe(false);

    // Redo brings it back and empties its own side.
    fireEvent.click(redoButton());
    expect(noteCount(doc)).toBe(1);
    expect(redoButton().disabled).toBe(true);
    expect(canUndo()).toBe(true);
  });
});

describe('undo keyboard (undo.keyboard)', () => {
  it('TC-19: Ctrl/Cmd+Z on the board reverses this person own change', () => {
    const doc = renderSelection();
    seedSticky(doc);
    expect(noteCount(doc)).toBe(1);

    fireKey('z', { ctrl: true });
    expect(noteCount(doc)).toBe(0); // undone through the board's own handler

    fireKey('z', { ctrl: true, shift: true });
    expect(noteCount(doc)).toBe(1); // Ctrl/Cmd+Shift+Z redoes it
  });
});

describe('undo while the board cannot be edited (undo.not_editable)', () => {
  it('TC-20: a locked board disables the buttons and ignores the shortcuts', async () => {
    const doc = renderApp();
    await act(async () => {}); // handshake completes; the board is live
    seedSticky(doc);
    expect(canUndo()).toBe(true); // there genuinely is a step in the history

    // The room says it could not load this board — the one state that locks editing.
    act(() => standInRoom.refuseConnections(CLOSE_BOARD_LOAD_FAILED, 'could not read it'));
    await act(async () => {});

    expect(undoButton().disabled).toBe(true);
    expect(redoButton().disabled).toBe(true);

    fireKey('z', { ctrl: true });
    expect(noteCount(doc)).toBe(1); // the locked board reverses nothing
  });
});

describe('undo inside a text field (undo.text)', () => {
  it('TC-21: Ctrl/Cmd+Z in an open note undoes the shared text, not the browser edit', async () => {
    const doc = renderApp();
    await act(async () => {}); // the board is live and editable
    const id = seedSticky(doc);

    dblClickNote(id);
    const field = textareaFor(id);
    expect(field).toBeTruthy();

    typeInto(field!, 'ab');
    expect(textOf(doc, id)).toBe('ab');

    // Ctrl/Cmd+Z: our handler must win over the browser's textarea undo.
    const event = new KeyboardEvent('keydown', {
      key: 'z',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      field!.dispatchEvent(event);
    });
    flushFrames();

    expect(event.defaultPrevented).toBe(true); // the browser's undo is not used
    expect(textOf(doc, id)).toBe(''); // the shared document moved instead
  });
});
