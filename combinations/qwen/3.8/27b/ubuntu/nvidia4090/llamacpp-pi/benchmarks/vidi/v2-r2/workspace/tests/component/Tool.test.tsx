/**
 * Story 9, text tool tests (design TC-14 to TC-18): the Text tool, the
 * V/T/N shortcuts, click-to-create, the load_failed lock-out and the N
 * regression.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent } from '@testing-library/react';
import { createSticky, getStickyText, snapshotAll } from '../../src/shared/board-model';
import { CLOSE_BOARD_LOAD_FAILED } from '../../src/shared/protocol';
import { getTextContent } from '../../src/shared/objects/text';
import { mockProviders } from './setup';
import { renderStickyBoard, type StickyBoardHarnessResult } from './harness';

afterEach(() => {
  vi.useRealTimers();
});

/** Window-level key press (the board listens on window keydown). */
function pressKey(key: string, init: KeyboardEventInit = {}): void {
  fireEvent.keyDown(window, { key, ...init });
}

/** Activate the Text tool the same way the T shortcut does. */
function armTextTool(): void {
  pressKey('t');
}

function textButton(utils: StickyBoardHarnessResult): HTMLButtonElement {
  return utils.getByTestId('text-button') as HTMLButtonElement;
}
function selectButton(utils: StickyBoardHarnessResult): HTMLButtonElement {
  return utils.getByTestId('select-button') as HTMLButtonElement;
}

/**
 * Click the board at a viewport-local point with a fresh pointer sequence;
 * returns the world point that was clicked (screen (640,400) is world (0,0)
 * at the fixture camera).
 */
function clickBoard(utils: StickyBoardHarnessResult, x = 640, y = 400): void {
  const viewport = utils.getByTestId('board-viewport');
  fireEvent.pointerDown(viewport, { clientX: x, clientY: y, pointerId: 1 });
  fireEvent.pointerUp(viewport, { clientX: x, clientY: y, pointerId: 1 });
}

describe('story 9: text tool (TC-14 to TC-18)', () => {
  it('TC-14: T activates the Text tool (button pressed); Escape and V revert to Select', () => {
    vi.useFakeTimers();
    const utils = renderStickyBoard();

    // Initial state: Select is the active tool.
    expect(selectButton(utils).getAttribute('aria-pressed')).toBe('true');
    expect(textButton(utils).getAttribute('aria-pressed')).toBe('false');

    pressKey('t');
    expect(textButton(utils).getAttribute('aria-pressed')).toBe('true');
    expect(selectButton(utils).getAttribute('aria-pressed')).toBe('false');

    // Escape reverts to Select.
    pressKey('Escape');
    expect(selectButton(utils).getAttribute('aria-pressed')).toBe('true');
    expect(textButton(utils).getAttribute('aria-pressed')).toBe('false');

    // T again, then V reverts to Select.
    pressKey('t');
    expect(textButton(utils).getAttribute('aria-pressed')).toBe('true');
    pressKey('v');
    expect(selectButton(utils).getAttribute('aria-pressed')).toBe('true');
    expect(textButton(utils).getAttribute('aria-pressed')).toBe('false');
  });

  it('TC-15: on a load-failed board the Text button is disabled, T is ignored, and an active Text tool reverts to Select', () => {
    vi.useFakeTimers();
    const utils = renderStickyBoard();
    const provider = mockProviders[mockProviders.length - 1];
    act(() => {
      provider.emitStatus('connected');
      provider.emitSync(true);
    });

    // Arm the Text tool on the live board …
    pressKey('t');
    expect(textButton(utils).getAttribute('aria-pressed')).toBe('true');

    // … then the load fails (close 4500): the tool reverts to Select and
    // the Text button is disabled.
    act(() => {
      provider.emitConnectionClose(CLOSE_BOARD_LOAD_FAILED);
      provider.emitStatus('disconnected');
    });
    expect(textButton(utils).disabled).toBe(true);
    expect(selectButton(utils).getAttribute('aria-pressed')).toBe('true');

    // T is ignored while the board is not editable.
    pressKey('t');
    expect(selectButton(utils).getAttribute('aria-pressed')).toBe('true');
    expect(textButton(utils).getAttribute('aria-pressed')).toBe('false');
  });

  it('TC-16: pressing T while editing a note types a character and does not change the tool', () => {
    vi.useFakeTimers();
    const utils = renderStickyBoard();
    let id = '';
    act(() => {
      id = createSticky(utils.doc, { x: 0, y: 0 });
    });

    // Start editing the note (double-click).
    const note = utils.getByTestId('sticky-note');
    fireEvent.doubleClick(note, { clientX: 640, clientY: 400 });
    const ta = utils.getByTestId('sticky-textarea') as HTMLTextAreaElement;

    // Type 't' in the editor (keydown + the resulting input event).
    fireEvent.keyDown(ta, { key: 't' });
    act(() => {
      ta.value = 't';
    });
    fireEvent.input(ta);

    // The character landed in the note …
    expect(getStickyText(utils.doc, id)!.toString()).toBe('t');
    // … and the tool did NOT switch to Text.
    expect(textButton(utils).getAttribute('aria-pressed')).toBe('false');
    expect(selectButton(utils).getAttribute('aria-pressed')).toBe('true');
  });

  it('TC-17: with the Text tool active, clicking the board creates a text at the world point, reverts to Select, and starts editing', () => {
    vi.useFakeTimers();
    const utils = renderStickyBoard();

    armTextTool();
    expect(textButton(utils).getAttribute('aria-pressed')).toBe('true');

    // Click the board centre: world (0,0).
    clickBoard(utils, 640, 400);

    // A text object was created with its top-left at the click point …
    const all = snapshotAll(utils.doc);
    expect(all).toHaveLength(1);
    expect(all[0].type).toBe('text');
    expect(all[0].x).toBe(0);
    expect(all[0].y).toBe(0);
    expect(getTextContent(utils.doc, all[0].id)!.toString()).toBe('');

    // … it is rendering with an active editor …
    const obj = utils.getByTestId('text-object');
    expect(obj.getAttribute('data-editing')).toBe('true');
    expect(utils.getByTestId('text-textarea')).toBeTruthy();

    // … and the tool reverted to Select.
    expect(selectButton(utils).getAttribute('aria-pressed')).toBe('true');
    expect(textButton(utils).getAttribute('aria-pressed')).toBe('false');
  });

  it('TC-18: N still creates a sticky note at the view centre (regression)', () => {
    vi.useFakeTimers();
    const utils = renderStickyBoard();

    pressKey('n');

    const all = snapshotAll(utils.doc);
    expect(all).toHaveLength(1);
    expect(all[0].type).toBe('sticky');
    // Viewport centre (640,400) at zoom 1 is world (0,0); top-left is (-100,-100).
    expect(all[0].x).toBe(-100);
    expect(all[0].y).toBe(-100);
    // The new note starts editing immediately.
    expect(utils.getByTestId('sticky-textarea')).toBeTruthy();
  });
});
