import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UndoController } from '../../src/client/board/undo';
import { SharePanel } from '../../src/client/share/SharePanel';
import { renderNotesHarness } from './notes-harness';
import { enableFakeFrameTimers } from './test-utils';

/**
 * Story 8 component tests (task 11, TC-18 to TC-21): undo.controls — the
 * toolbar buttons and the Ctrl/Cmd+Z shortcuts, in jsdom with a FAKE
 * UndoController (the controller's own history is covered by the unit suite).
 *
 * The harness injects the fake as the active controller, so the board keys,
 * the sticky editor and the toolbar buttons all call through to it; the fake
 * records the calls and drives the button enabled state via its
 * canUndo/canRedo + onChange.
 */

interface FakeController extends UndoController {
  undo: ReturnType<typeof vi.fn>;
  redo: ReturnType<typeof vi.fn>;
  boundary: ReturnType<typeof vi.fn>;
  /** Flip the reported stack state and notify subscribers (under act). */
  setStacks(canUndo: boolean, canRedo: boolean): void;
}

function makeFakeController(): FakeController {
  const undo = vi.fn(() => true);
  const redo = vi.fn(() => true);
  const boundary = vi.fn();
  const addScope = vi.fn();
  const destroy = vi.fn();
  const listeners = new Set<() => void>();
  let canUndoVal = false;
  let canRedoVal = false;
  const setStacks = (u: boolean, r: boolean): void => {
    canUndoVal = u;
    canRedoVal = r;
    for (const cb of [...listeners]) cb();
  };
  return {
    undo,
    redo,
    boundary,
    addScope,
    destroy,
    canUndo: () => canUndoVal,
    canRedo: () => canRedoVal,
    onChange: (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    setStacks,
  };
}

const undoButton = () => screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement;
const redoButton = () => screen.getByRole('button', { name: 'Redo' }) as HTMLButtonElement;

/** A window-level Ctrl/Cmd key; returns whether the default was prevented. */
const key = (init: KeyboardEventInit): boolean => fireEvent.keyDown(window, init);

beforeEach(() => {
  enableFakeFrameTimers();
});

describe('undo.controls (jsdom, fake controller)', () => {
  it('TC-18 empty stacks → Undo and Redo buttons disabled (boundary)', () => {
    const fake = makeFakeController();
    renderNotesHarness({ undo: fake });

    // Fresh controller: nothing to undo or redo.
    expect(fake.canUndo()).toBe(false);
    expect(fake.canRedo()).toBe(false);
    expect(undoButton().disabled).toBe(true);
    expect(redoButton().disabled).toBe(true);
  });

  it('TC-18b non-empty stacks enable the matching button (via onChange)', () => {
    const fake = makeFakeController();
    renderNotesHarness({ undo: fake });
    expect(undoButton().disabled).toBe(true);

    act(() => {
      fake.setStacks(true, true);
    });
    expect(undoButton().disabled).toBe(false);
    expect(redoButton().disabled).toBe(false);
  });

  it('TC-19 Ctrl+Z and Cmd+Z undo; Ctrl+Shift+Z, Cmd+Shift+Z and Ctrl+Y redo; each preventDefault', () => {
    const fake = makeFakeController();
    renderNotesHarness({ undo: fake });

    // Undo shortcuts.
    expect(key({ key: 'z', ctrlKey: true })).toBe(false); // preventDefault
    expect(fake.undo).toHaveBeenCalledTimes(1);
    expect(key({ key: 'z', metaKey: true })).toBe(false);
    expect(fake.undo).toHaveBeenCalledTimes(2);

    // Redo shortcuts.
    expect(key({ key: 'z', ctrlKey: true, shiftKey: true })).toBe(false);
    expect(fake.redo).toHaveBeenCalledTimes(1);
    expect(key({ key: 'z', metaKey: true, shiftKey: true })).toBe(false);
    expect(fake.redo).toHaveBeenCalledTimes(2);
    expect(key({ key: 'y', ctrlKey: true })).toBe(false);
    expect(fake.redo).toHaveBeenCalledTimes(3);

    // The shortcuts never call boundary.
    expect(fake.boundary).not.toHaveBeenCalled();
  });

  it('TC-20 (negative) a locked board (canEdit false): shortcuts ignored, buttons disabled', () => {
    const fake = makeFakeController();
    renderNotesHarness({ editable: false, undo: fake });

    // The edit lock disables the buttons even with a non-empty stack.
    act(() => {
      fake.setStacks(true, true);
    });
    expect(undoButton().disabled).toBe(true);
    expect(redoButton().disabled).toBe(true);

    // The shortcuts are ignored (no controller call, no preventDefault).
    expect(key({ key: 'z', ctrlKey: true })).toBe(true); // not prevented
    expect(fake.undo).not.toHaveBeenCalled();
    expect(key({ key: 'z', ctrlKey: true, shiftKey: true })).toBe(true);
    expect(fake.redo).not.toHaveBeenCalled();
  });

  it('TC-21 (negative) Ctrl+Z with focus in the share-link input is not hijacked', () => {
    const fake = makeFakeController();
    renderNotesHarness({ undo: fake });
    render(<SharePanel boardId="b_share_test" />);

    // Open the share panel and focus its (read-only) link input.
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    const input = screen.getByTestId('share-link-input') as HTMLInputElement;
    act(() => {
      input.focus();
    });
    expect(document.activeElement).toBe(input);

    // Ctrl+Z while the input is focused: the board shortcut must stay out.
    fireEvent.keyDown(input, { key: 'z', ctrlKey: true });
    expect(fake.undo).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'z', ctrlKey: true, shiftKey: true });
    expect(fake.redo).not.toHaveBeenCalled();
  });
});
