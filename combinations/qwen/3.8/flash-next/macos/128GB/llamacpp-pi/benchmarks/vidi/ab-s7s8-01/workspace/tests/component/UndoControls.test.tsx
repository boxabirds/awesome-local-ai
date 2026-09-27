// Story 8, Task 11 — undo shortcuts, toolbar buttons, read-only lock and the
// text-field focus exemption (TC-18 to TC-21).

import { describe, it, expect } from 'vitest';
import { render, act } from '@testing-library/react';
import { App } from '../../src/client/App';
import { SharePanel } from '../../src/client/share/SharePanel';
import type { ProviderLike } from '../../src/client/sync/connectBoard';
import { fire, flushFrame, pointerEvent, pressKey, seed, objectEl, row, rows, viewport } from './harness';

const undoBtn = () => document.querySelector<HTMLButtonElement>('[data-testid="undo-button"]')!;
const redoBtn = () => document.querySelector<HTMLButtonElement>('[data-testid="redo-button"]')!;

/** Double-click empty board: one created note = one undo step (creation also
 * opens the editor, which adds no step of its own), then Escape back to the
 * board so the window-level shortcuts are live again. */
function createNote(x = 640, y = 400): void {
  fire(viewport(), pointerEvent('dblclick', x, y));
  const ta = document.querySelector('textarea[data-testid="sticky-textarea"]');
  expect(ta).not.toBeNull();
  fire(ta!, new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
}

/** Click a toolbar button through a real bubbling click event (act-wrapped). */
function clickButton(el: HTMLElement): void {
  fire(el, new MouseEvent('click', { bubbles: true, cancelable: true }));
}

describe('TC-18 empty stacks → both buttons disabled (boundary)', () => {
  it('a fresh board offers no Undo and no Redo', () => {
    render(<App />);
    expect(undoBtn().disabled).toBe(true);
    expect(redoBtn().disabled).toBe(true);
    expect(undoBtn().getAttribute('aria-label')).toBe('Undo');
    expect(redoBtn().getAttribute('aria-label')).toBe('Redo');
  });

  it('Undo enables after a local action; Redo only after an undo', () => {
    render(<App />);
    createNote();
    expect(undoBtn().disabled).toBe(false);
    expect(redoBtn().disabled).toBe(true); // nothing undone yet
    clickButton(undoBtn());
    expect(rows()).toHaveLength(0);
    expect(redoBtn().disabled).toBe(false);
  });
});

describe('TC-19 the five shortcut spellings route to the controller, each preventDefault-ed', () => {
  it('Ctrl+Z and Cmd+Z undo; Ctrl+Shift+Z, Cmd+Shift+Z and Ctrl+Y redo', () => {
    render(<App />);
    createNote();
    expect(rows()).toHaveLength(1);

    expect(pressKey('z', window, { ctrlKey: true })).toBe(true); // Ctrl+Z
    expect(rows()).toHaveLength(0);

    expect(pressKey('Z', window, { ctrlKey: true, shiftKey: true })).toBe(true); // Ctrl+Shift+Z
    expect(rows()).toHaveLength(1);

    expect(pressKey('z', window, { metaKey: true })).toBe(true); // Cmd+Z
    expect(rows()).toHaveLength(0);

    expect(pressKey('Z', window, { metaKey: true, shiftKey: true })).toBe(true); // Cmd+Shift+Z
    expect(rows()).toHaveLength(1);

    // Make a fresh undo step so Ctrl+Y has something to redo:
    clickButton(undoBtn());
    expect(rows()).toHaveLength(0);
    expect(pressKey('y', window, { ctrlKey: true })).toBe(true); // Ctrl+Y
    expect(rows()).toHaveLength(1);
  });
});

describe('TC-20 read-only board: shortcuts ignored, buttons disabled (negative)', () => {
  class FakeProvider implements ProviderLike {
    synced = false;
    private listeners = new Map<string, Set<(...args: unknown[]) => void>>();
    on(event: 'status' | 'synced' | 'connection-close', listener: (...args: unknown[]) => void): void {
      if (!this.listeners.has(event)) this.listeners.set(event, new Set());
      this.listeners.get(event)!.add(listener);
    }
    off(event: 'status' | 'synced' | 'connection-close', listener: (...args: unknown[]) => void): void {
      this.listeners.get(event)?.delete(listener);
    }
    destroy(): void {
      this.listeners.clear();
    }
    emitClose(code: number): void {
      for (const l of this.listeners.get('connection-close') ?? []) l({ code });
    }
  }

  it('load-failed board: buttons disabled even with content, Ctrl+Z does nothing', () => {
    const provider = new FakeProvider();
    render(<App boardId="board-1" providerFactory={() => provider} />);
    act(() => provider.emitClose(4500)); // → load_failed → read-only

    const a = seed(100, 100);
    // A drag writes nothing on a read-only board (story 7) — and produces no
    // undo step either.
    fire(objectEl(a), pointerEvent('pointerdown', 100, 100));
    fire(window, pointerEvent('pointermove', 180, 100));
    flushFrame();
    fire(window, pointerEvent('pointerup', 180, 100));

    expect(undoBtn().disabled).toBe(true);
    expect(redoBtn().disabled).toBe(true);
    // The shortcut is ignored — not even consumed (returns false = not prevented).
    expect(pressKey('z', window, { ctrlKey: true })).toBe(false);
    expect(rows()).toHaveLength(1); // document untouched
    expect(row(a).x).toBeCloseTo(0, 3); // (never even moved by the drag)
  });
});

describe('TC-21 Ctrl+Z with focus in a text field never reaches the controller (negative)', () => {
  it('share-link input focused: the note stays, no undo happens', () => {
    render(
      <>
        <App />
        <SharePanel boardId="board-1" />
      </>,
    );
    createNote();
    expect(rows()).toHaveLength(1);

    // Open the share panel; jsdom has no clipboard, so the panel falls back
    // to selecting the link in its input — focus lands in the text field.
    clickButton(document.querySelector<HTMLButtonElement>('[data-testid="share-button"]')!);
    const input = document.querySelector<HTMLInputElement>('[data-testid="share-link-field"]');
    expect(input).not.toBeNull();
    // The panel shows the link; the user selects it (select-and-copy fallback,
    // jsdom has no clipboard) — focus the field the way that interaction does.
    act(() => {
      input!.focus();
      input!.select();
    });
    expect(document.activeElement).toBe(input);

    expect(pressKey('z', window, { ctrlKey: true })).toBe(false); // not consumed
    expect(rows()).toHaveLength(1); // the note is still there: no undo
    expect(undoBtn().disabled).toBe(false); // history untouched
  });
});

describe('buttons mirror the controller exactly', () => {
  it('undo via button restores, redo via button re-applies, undo exhausts to disabled', () => {
    render(<App />);
    createNote(300, 300);
    createNote(700, 500);
    expect(rows()).toHaveLength(2);

    clickButton(undoBtn());
    expect(rows()).toHaveLength(1);
    clickButton(undoBtn());
    expect(rows()).toHaveLength(0);
    expect(undoBtn().disabled).toBe(true); // history exhausted

    clickButton(redoBtn());
    clickButton(redoBtn());
    expect(rows()).toHaveLength(2);
    expect(redoBtn().disabled).toBe(true);
  });
});
