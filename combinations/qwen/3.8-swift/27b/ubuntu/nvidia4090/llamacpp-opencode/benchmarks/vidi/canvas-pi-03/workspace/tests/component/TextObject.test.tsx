/**
 * Story 9 component tests — text.object / text.editing (TC-19 to TC-25):
 * double-click editing with live box remeasure, the size toolbar, the
 * horizontal-only resize handle, empty-text removal on edit end, remote
 * deletion during editing, Ctrl+Z reverting typing, and the text-vs-note
 * toolbar switch.
 *
 * The jsdom canvas has no 2d context, so the shared measurer uses its
 * estimate fallback: width = charCount × fontPx × 0.6, deterministic per
 * preset (M: 12/char, 26/line; XL: 33.6/char, 72.8/line).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as Y from 'yjs';
import { App } from 'src/client/App';
import { boardReady } from './ready';
import {
  createText,
  getTextContent,
  getTextSize,
  getTextWidthMode,
} from 'src/shared/objects/text';
import { applyTextDiff } from 'src/shared/text-edit';
import { createCanvasMeasurer } from 'src/client/objects/textLayout';
import { remeasureTextBox } from 'src/client/objects/useTextBoxSync';
import { TEXT_SIZES, TEXT_LINE_HEIGHT } from 'src/shared/config';
import { createSticky, deleteObject, snapshot } from 'src/shared/board-model';

const measurer = createCanvasMeasurer();
const M_CHAR = TEXT_SIZES.M * 0.6; // 12
const M_LINE = TEXT_SIZES.M * TEXT_LINE_HEIGHT; // 26
const XL_CHAR = TEXT_SIZES.XL * 0.6; // 33.6
const XL_LINE = TEXT_SIZES.XL * TEXT_LINE_HEIGHT; // 72.8

function getDoc(): Y.Doc {
  const w = window as unknown as { __vidi6: { doc: Y.Doc } };
  return w.__vidi6.doc;
}

/** Creates a text object at (x, y) with the given content, measured. */
function makeText(text = '', x = 0, y = 0): string {
  const doc = getDoc();
  let id = '';
  act(() => {
    id = createText(doc, { x, y }, 'tester')!;
    if (text) {
      applyTextDiff(getTextContent(doc, id)!, text);
      remeasureTextBox(doc, id, measurer);
    }
  });
  return id;
}

function boxOf(doc: Y.Doc, id: string): { width: number; height: number } {
  const obj = doc.getMap('objects').get(id) as Y.Map<Record<string, unknown>>;
  return {
    width: obj.get('width') as unknown as number,
    height: obj.get('height') as unknown as number,
  };
}

/** Simulates the story 7 handle drag (fireEvent pointer sequence). */
function dragHandle(handle: HTMLElement, from: { x: number; y: number }, to: { x: number; y: number }): void {
  fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientX: from.x, clientY: from.y });
  fireEvent.pointerMove(handle, { pointerId: 1, clientX: to.x, clientY: to.y });
  fireEvent.pointerUp(handle, { pointerId: 1, clientX: to.x, clientY: to.y });
}

describe('text.object (component)', () => {
  beforeEach(async () => {
    render(<App />);
    await boardReady();
  });

  it('TC-19: double-click starts editing; typing updates the Y.Text and the box; end shows the text', async () => {
    const doc = getDoc();
    const id = makeText('Hi'); // 24 × 26 at world (0,0)
    const el = screen.getByTestId('text-object');

    const user = userEvent.setup();
    await user.click(el);
    expect(el.hasAttribute('data-selected')).toBe(true);

    await user.dblClick(el);
    const ta = screen.getByTestId('text-textarea');
    expect(ta).toHaveFocus();

    await user.type(ta, 'World');
    // Y.Text updated and the box remeasured: 7 chars × 12 = 84 × 26.
    expect(getTextContent(doc, id)!.toString()).toBe('HiWorld');
    expect(boxOf(doc, id)).toEqual({ width: 7 * M_CHAR, height: M_LINE });

    await user.keyboard('{Escape}');
    // Editor unmounted; the plain text node shows the content.
    expect(screen.queryByTestId('text-editor')).toBeNull();
    expect(screen.getByTestId('text-object-text')).toHaveTextContent('HiWorld');
  });

  it('TC-20: the size toolbar changes the preset and the box follows', async () => {
    const doc = getDoc();
    const id = makeText('Hi');
    const el = screen.getByTestId('text-object');

    const user = userEvent.setup();
    await user.click(el);
    const toolbar = screen.getByTestId('text-toolbar');
    expect(screen.getByTestId('text-size-button-M')).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByTestId('text-size-button-XL'));
    expect(getTextSize(doc, id)).toBe('XL');
    // 2 chars at XL: 67.2 × 72.8.
    expect(boxOf(doc, id)).toEqual({
      width: expect.closeTo(2 * XL_CHAR, 5),
      height: expect.closeTo(XL_LINE, 5),
    });
    expect(screen.getByTestId('text-size-button-XL')).toHaveAttribute('aria-pressed', 'true');
    expect(toolbar).toBeVisible();
  });

  it('TC-21: only east/west handles render; dragging one sets a fixed width and keeps x/y', async () => {
    const doc = getDoc();
    const id = makeText('abc'); // 36 × 26 at (0,0)
    const el = screen.getByTestId('text-object');

    const user = userEvent.setup();
    await user.click(el);

    // Exactly two handles: e and w.
    const handles = screen.getAllByTestId('resize-handle');
    expect(handles).toHaveLength(2);
    const east = handles.find((h) => h.getAttribute('data-handle') === 'e')!;

    // The east handle sits at world x = 36 → screen x = 548 (centre 512);
    // the box midline is at screen y = 384 + 13 = 397.
    dragHandle(east, { x: 548, y: 397 }, { x: 648, y: 397 });
    // Width 36 + 100 = 136, fixed mode; x and y untouched, height re-fits.
    expect(getTextWidthMode(doc, id)).toBe('fixed');
    expect(boxOf(doc, id)).toEqual({ width: 136, height: M_LINE });
    const obj = doc.getMap('objects').get(id) as Y.Map<Record<string, unknown>>;
    expect(obj.get('x')).toBe(0);
    expect(obj.get('y')).toBe(0);
  });

  it('TC-22: editing an empty text and ending it removes the object', async () => {
    const doc = getDoc();
    const id = makeText('');
    const el = screen.getByTestId('text-object');

    const user = userEvent.setup();
    await user.click(el);
    await user.dblClick(el);
    expect(screen.getByTestId('text-editor')).toBeVisible();

    await user.keyboard('{Escape}');
    // Abandoned empty text is gone (text.empty_removed).
    expect(doc.getMap('objects').get(id)).toBeUndefined();
    expect(snapshot(doc)).toHaveLength(0);
    expect(screen.queryByTestId('text-object')).toBeNull();
  });

  it('TC-23: a remote deletion during editing unmounts the editor', async () => {
    const doc = getDoc();
    const id = makeText('Hi');
    const el = screen.getByTestId('text-object');

    const user = userEvent.setup();
    await user.click(el);
    await user.dblClick(el);
    expect(screen.getByTestId('text-editor')).toBeVisible();

    // A peer deletes the object (direct doc mutation = a remote change).
    act(() => {
      deleteObject(doc, id);
    });
    expect(screen.queryByTestId('text-editor')).toBeNull();
    expect(screen.queryByTestId('text-object')).toBeNull();
    expect(snapshot(doc)).toHaveLength(0);
  });

  it('TC-24: Ctrl+Z after editing reverts the typing', async () => {
    const doc = getDoc();
    const id = makeText('');
    const el = screen.getByTestId('text-object');

    const user = userEvent.setup();
    await user.click(el);
    await user.dblClick(el);
    const ta = screen.getByTestId('text-textarea');
    await user.type(ta, 'Hello');
    expect(getTextContent(doc, id)!.toString()).toBe('Hello');

    // End the edit (non-empty → the object survives), then undo the step.
    await user.keyboard('{Escape}');
    expect(fireEvent.keyDown(window, { key: 'z', ctrlKey: true })).toBe(false);
    expect(getTextContent(doc, id)!.toString()).toBe('');
  });

  it('TC-25: a single selected text shows the text toolbar (not the note one); a single sticky shows the note toolbar (not the text one)', async () => {
    const doc = getDoc();
    const tid = makeText('Hi', -200, 0);
    const textEl = screen.getByTestId('text-object');

    const user = userEvent.setup();
    await user.click(textEl);
    expect(screen.getByTestId('text-toolbar')).toBeVisible();
    expect(screen.queryByTestId('note-toolbar')).toBeNull();

    // Switch the single selection to a sticky note.
    let sid = '';
    act(() => {
      sid = createSticky(doc, { x: 100, y: 0 }, 'yellow', 'note')!;
    });
    const stickyEl = screen.getByTestId('sticky-note');
    await user.click(stickyEl);
    expect(stickyEl.hasAttribute('data-selected')).toBe(true);
    expect(screen.getByTestId('note-toolbar')).toBeVisible();
    expect(screen.queryByTestId('text-toolbar')).toBeNull();
    expect(tid).toBeTruthy();
    expect(sid).toBeTruthy();
  });
});
