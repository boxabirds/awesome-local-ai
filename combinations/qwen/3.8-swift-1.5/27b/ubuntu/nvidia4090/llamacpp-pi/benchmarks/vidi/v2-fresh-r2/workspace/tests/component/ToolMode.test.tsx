/**
 * Component tests for the board tool mode (story 9, text.tool).
 *
 * TC-14: the Text toolbar button activates the Text tool; V reverts to Select.
 * TC-15: a Text-tool click creates a text object in editing and reverts to Select.
 * TC-16: a Text-tool click on a sticky creates text on top; the sticky is untouched.
 * TC-17: a Text-tool click on empty space creates text at the clicked world point.
 * TC-18: the Text button is disabled when the board cannot be edited (load failed).
 *
 * The board runs against a fake (offline) provider; jsdom has a zero-size,
 * identity camera so screen coordinates equal world coordinates.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderBoard, insertSticky, hook } from './harness';
import { objects } from '../../src/shared/board-model';
import { setTestMeasurer, type Measurer } from '../../src/client/objects/textLayout';

/** Deterministic measurer: each non-space char is fontPx/2 world units wide. */
const measure: Measurer = (text, fontPx) => text.replace(/ /g, '').length * (fontPx / 2);

let unmount: (() => void) | undefined;

beforeEach(() => {
  setTestMeasurer(measure);
});
afterEach(() => {
  setTestMeasurer(null);
  unmount?.();
  unmount = undefined;
});

describe('tool mode (component)', () => {
  // TC-14: Text button activates the Text tool; V reverts to Select.
  it('TC-14: Text button activates the text tool; V reverts to select', () => {
    const utils = renderBoard();
    unmount = utils.unmount;

    const textBtn = screen.getByTestId('text-btn');
    const selectBtn = screen.getByTestId('select-btn');
    expect(textBtn).toHaveAttribute('aria-pressed', 'false');
    expect(selectBtn).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(textBtn);
    expect(textBtn).toHaveAttribute('aria-pressed', 'true');
    expect(selectBtn).toHaveAttribute('aria-pressed', 'false');

    // V reverts to the Select tool.
    fireEvent.keyDown(window, { key: 'v' });
    expect(selectBtn).toHaveAttribute('aria-pressed', 'true');
    expect(textBtn).toHaveAttribute('aria-pressed', 'false');
  });

  // TC-15: a Text-tool click creates a text object in editing; the tool reverts.
  it('TC-15: text-tool click creates a text object in editing and reverts to select', () => {
    const utils = renderBoard();
    unmount = utils.unmount;

    fireEvent.click(screen.getByTestId('text-btn'));
    fireEvent.click(screen.getByTestId('board-viewport'), { clientX: 100, clientY: 50 });

    // The editor is open for the new text object.
    expect(screen.getByTestId('text-editor-textarea')).toBeTruthy();
    // The tool reverted to Select.
    expect(screen.getByTestId('select-btn')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('text-btn')).toHaveAttribute('aria-pressed', 'false');

    // A text object now exists on the board.
    const texts = objects(hook().getDoc!()).filter((o) => o.type === 'text');
    expect(texts).toHaveLength(1);
  });

  // TC-16: a Text-tool click on a sticky creates text on top; the sticky is
  // untouched (no drag, no selection change to the sticky).
  it('TC-16: text-tool click on a sticky creates text on top, sticky unchanged', () => {
    const utils = renderBoard();
    unmount = utils.unmount;

    const stickyId = insertSticky(200, 150);
    const before = objects(hook().getDoc!()).find((o) => o.id === stickyId)!;

    fireEvent.click(screen.getByTestId('text-btn'));
    const sticky = screen.getByTestId('sticky-note');
    fireEvent.click(sticky, { clientX: 200, clientY: 150 });

    // A text object was created in editing.
    expect(screen.getByTestId('text-editor-textarea')).toBeTruthy();
    const texts = objects(hook().getDoc!()).filter((o) => o.type === 'text');
    expect(texts).toHaveLength(1);

    // The sticky is byte-for-byte unchanged.
    const after = objects(hook().getDoc!()).find((o) => o.id === stickyId)!;
    expect(after).toEqual(before);
  });

  // TC-17: a Text-tool click on empty space creates text at the clicked point.
  it('TC-17: text-tool click on empty space creates text at the clicked world point', () => {
    const utils = renderBoard();
    unmount = utils.unmount;

    fireEvent.click(screen.getByTestId('text-btn'));
    fireEvent.click(screen.getByTestId('board-viewport'), { clientX: 320, clientY: 240 });

    const [text] = objects(hook().getDoc!()).filter((o) => o.type === 'text');
    expect(text).toBeTruthy();
    expect(text.x).toBe(320);
    expect(text.y).toBe(240);
  });

  // TC-18: the Text button is disabled when the board cannot be edited.
  it('TC-18: text button disabled after load failed', () => {
    const utils = renderBoard();
    unmount = utils.unmount;

    expect(screen.getByTestId('text-btn')).not.toBeDisabled();
    utils.forceLoadFailed();
    expect(screen.getByTestId('text-btn')).toBeDisabled();
  });
});
