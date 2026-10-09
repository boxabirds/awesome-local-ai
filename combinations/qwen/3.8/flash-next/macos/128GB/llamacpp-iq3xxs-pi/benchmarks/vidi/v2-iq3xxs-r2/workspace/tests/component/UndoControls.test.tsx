// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import { CLOSE_BOARD_LOAD_FAILED } from '../../src/shared/protocol';
import { LOAD_FAILED_LABEL } from '../../src/client/sync/ConnectionStatus';
import type { UndoController } from '../../src/client/board/undo';
import { flushFrames, renderBoard } from './fixtures/board';
import { pressBoardKey, pressCombo } from './fixtures/selection';
import { socketsCloseWith, socketsLive } from './fixtures/socket';

/**
 * The undo controls (`undo.controls`): the two buttons in the toolbar and the keyboard
 * shortcuts, tested against a recording double of the history so the tests can say what the
 * UI *asked* for, and set the history's side of the bargain (how many steps there are) from
 * outside.
 *
 * The point the last two cases make by absence: a person who cannot edit cannot undo, and a
 * field that is not the board keeps its own Ctrl+Z.
 */

const { fake } = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const state = { undo: false, redo: false };
  const calls: string[] = [];
  const notify = (): void => {
    for (const listener of [...listeners]) listener();
  };
  const controller = {
    calls,
    canUndo: () => state.undo,
    canRedo: () => state.redo,
    undo(): boolean {
      calls.push('undo');
      if (!state.undo) return false;
      state.undo = false;
      state.redo = true;
      notify();
      return true;
    },
    redo(): boolean {
      calls.push('redo');
      if (!state.redo) return false;
      state.redo = false;
      state.undo = true;
      notify();
      return true;
    },
    boundary(): void {
      calls.push('boundary');
    },
    addScope(): void {},
    onChange(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    destroy(): void {
      calls.push('destroy');
      listeners.clear();
    },
    /** The history changed, which is what `stack-item-added`/`-popped` do for the real one. */
    setStack(next: { undo?: boolean; redo?: boolean }): void {
      state.undo = next.undo ?? false;
      state.redo = next.redo ?? false;
      notify();
    },
    /** Forget what the UI asked for; the history's own state is left alone. */
    forget(): void {
      calls.length = 0;
    },
    last(): string | null {
      return calls[calls.length - 1] ?? null;
    },
  } satisfies UndoController & Record<string, unknown>;
  return { fake: controller };
});

vi.mock('../../src/client/board/undo', () => ({
  createUndo: () => fake,
}));

function buttonByLabel(label: string): HTMLButtonElement {
  const element = document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (!element) throw new Error(`no button with aria-label "${label}"`);
  return element;
}

const undoButton = (): HTMLButtonElement => buttonByLabel('Undo');
const redoButton = (): HTMLButtonElement => buttonByLabel('Redo');

/** The history gained or lost a step, and the board should notice. */
function setStack(next: { undo?: boolean; redo?: boolean }): void {
  act(() => {
    fake.setStack(next);
  });
}

beforeEach(async () => {
  await renderBoard();
  setStack({ undo: false, redo: false });
  fake.forget();
});

describe('the undo buttons (TC-18)', () => {
  it('TC-18 boundary: nothing to undo and nothing to redo leaves both buttons disabled', () => {
    expect(undoButton().disabled).toBe(true);
    expect(redoButton().disabled).toBe(true);

    // They are in the toolbar with the Sticky note button, and say what they do.
    const toolbar = document.querySelector<HTMLElement>('[data-testid="toolbar"]');
    expect(toolbar?.contains(undoButton())).toBe(true);
    expect(toolbar?.contains(redoButton())).toBe(true);
    expect(undoButton().title).toBe('Undo (Ctrl/Cmd+Z)');
    expect(redoButton().title).toBe('Redo (Ctrl/Cmd+Shift+Z)');
  });

  it('TC-18: one step in the history enables the button, and clicking it asks for that step', () => {
    setStack({ undo: true, redo: false });
    expect(undoButton().disabled).toBe(false);
    expect(redoButton().disabled).toBe(true);

    act(() => {
      undoButton().click();
    });
    expect(fake.last()).toBe('undo');
    // That step became a redo opportunity instead, and the buttons followed without being
    // asked twice.
    expect(undoButton().disabled).toBe(true);
    expect(redoButton().disabled).toBe(false);

    act(() => {
      redoButton().click();
    });
    expect(fake.last()).toBe('redo');
    expect(redoButton().disabled).toBe(true);
  });

  it('TC-18: a click that the history refuses leaves the buttons as they were', () => {
    setStack({ undo: false, redo: false });
    act(() => {
      undoButton().click();
    });
    expect(fake.calls).toEqual([]);
    expect(undoButton().disabled).toBe(true);
  });
});

describe('the undo shortcuts (TC-19)', () => {
  it('TC-19: Ctrl+Z and Cmd+Z undo, Ctrl+Shift+Z, Cmd+Shift+Z and Ctrl+Y redo, each taken from the browser', async () => {
    setStack({ undo: true, redo: false });
    fake.forget();

    expect(await pressBoardKey('z', { ctrl: true })).toBe(true);
    expect(fake.last()).toBe('undo');

    setStack({ undo: true, redo: false });
    expect(await pressBoardKey('z', { meta: true })).toBe(true);
    expect(fake.last()).toBe('undo');

    setStack({ undo: false, redo: true });
    expect(await pressBoardKey('z', { ctrl: true, shift: true })).toBe(true);
    expect(fake.last()).toBe('redo');

    setStack({ undo: false, redo: true });
    expect(await pressBoardKey('z', { meta: true, shift: true })).toBe(true);
    expect(fake.last()).toBe('redo');

    setStack({ undo: false, redo: true });
    expect(await pressBoardKey('y', { ctrl: true })).toBe(true);
    expect(fake.last()).toBe('redo');
  });

  it('TC-19: a plain z types a letter and steps nothing (negative)', async () => {
    setStack({ undo: true, redo: true });
    fake.forget();

    expect(await pressBoardKey('z')).toBe(false);
    expect(fake.calls).toEqual([]);
  });

  it('TC-19: Alt+Z is not the board’s either', async () => {
    setStack({ undo: true, redo: true });
    fake.forget();

    expect(await pressBoardKey('z', { ctrl: true, alt: true })).toBe(false);
    expect(fake.calls).toEqual([]);
  });
});

describe('a board this client cannot edit (TC-20)', () => {
  it('TC-20: with the steps there but the board not loadable, the shortcuts are ignored and the buttons stay disabled', async () => {
    await socketsLive();
    await socketsCloseWith(CLOSE_BOARD_LOAD_FAILED);
    await vi.waitFor(() => {
      const status = document.querySelector<HTMLElement>('[data-testid="connection-status"]');
      if (status?.textContent !== LOAD_FAILED_LABEL) {
        throw new Error(`board does not say it could not be loaded: ${status?.textContent}`);
      }
    });
    // The history of this tab has not gone anywhere: it still holds a step.
    setStack({ undo: true, redo: false });

    expect(undoButton().disabled).toBe(true);
    expect(redoButton().disabled).toBe(true);
    fake.forget();

    expect(await pressBoardKey('z', { ctrl: true })).toBe(false);
    expect(await pressBoardKey('z', { ctrl: true, shift: true })).toBe(false);
    expect(await pressBoardKey('y', { ctrl: true })).toBe(false);
    expect(fake.calls).toEqual([]);
  });
});

describe('a field that is not the board (TC-21)', () => {
  it('TC-21: Ctrl+Z with the caret in the share-link field leaves the history alone', async () => {
    setStack({ undo: true, redo: false });
    fake.forget();

    fireEvent.click(screen.getByTestId('share-button'));
    const link = screen.getByTestId('share-link') as HTMLInputElement;
    link.focus();
    expect(document.activeElement).toBe(link);

    expect(pressCombo('z', { ctrl: true, target: link })).toBe(false);
    expect(fake.calls).toEqual([]);

    // The very same shortcut, once the board has its keyboard back, is the board's.
    expect(await pressBoardKey('z', { ctrl: true })).toBe(true);
    expect(fake.last()).toBe('undo');
    await flushFrames();
  });
});
