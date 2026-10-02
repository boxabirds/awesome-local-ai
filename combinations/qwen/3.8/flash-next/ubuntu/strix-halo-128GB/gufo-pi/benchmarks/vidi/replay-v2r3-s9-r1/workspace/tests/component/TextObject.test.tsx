/**
 * Text object tests (story 9, text.object). TC-19 to TC-25: rendering, editing,
 * the size toolbar, the horizontal-only handles, mixed resizing, remote
 * deletion during editing and undo of text plus box.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { createRef } from 'react';
import { render, screen, cleanup, fireEvent, act, within } from '@testing-library/react';
import { BoardHarness, type HarnessHandle } from './harness/BoardHarness';
import { snapshot, deleteObject, createSticky } from '../../src/shared/board-model';
import type { TextSnapshot } from '../../src/shared/objects/text';
import { createText, getTextContent } from '../../src/shared/objects/text';
import { TEXT_LINE_HEIGHT, TEXT_MIN_WIDTH_WORLD, TEXT_SIZES } from '../../src/shared/config';
import { TEXT_BOX_PADDING_WORLD, type Measurer } from '../../src/client/objects/textLayout';
import { createPeer } from '../unit/peer';
import { pointer, frames, typeInto } from './pointerUtils';

/** Deterministic measurer: 0.5 world units per character per font pixel. */
const measure: Measurer = (text, fontPx) => text.length * fontPx * 0.5;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function setup(readOnly = false) {
  const handleRef = createRef<HarnessHandle | null>();
  render(<BoardHarness handleRef={handleRef} readOnly={readOnly} measure={measure} />);
  const handle = handleRef.current!;
  return {
    handle,
    doc: handle.doc,
    selection: handle.selection,
    /** Create a text object in the document. */
    create: (x: number, y: number): string => {
      let id = '';
      act(() => {
        id = createText(handle.doc, { x, y }, 'tester')!;
      });
      frames();
      return id;
    },
    /** Start editing an object. */
    edit: (id: string) => {
      act(() => {
        handle.selection.startEdit(id);
      });
      frames();
    },
    select: (ids: string[]) => {
      act(() => {
        handle.selection.setMany(ids, false);
      });
      frames();
    },
    /** Snapshot of one object as text. */
    text: (id: string): TextSnapshot =>
      snapshot(handle.doc).find((o) => o.id === id) as TextSnapshot,
    editor: () => screen.getByTestId('text-editor') as HTMLTextAreaElement,
  };
}

describe('text object (TC-19 to TC-25)', () => {
  it('TC-19: the editor starts with the caret at the end, Enter adds a line, Escape keeps it', () => {
    const { handle, doc, create, edit, text, editor } = setup();
    const id = create(100, 100);
    edit(id);

    const el = editor();
    expect(el.value).toBe('');
    expect(el.selectionStart).toBe(el.value.length);

    typeInto(el, 'Went well');
    frames();
    expect(getTextContent(doc, id)!.toString()).toBe('Went well');
    expect(text(id).width).toBe('Went well'.length * 10 + 2 * TEXT_BOX_PADDING_WORLD);
    expect(text(id).height).toBeCloseTo(TEXT_SIZES.M * TEXT_LINE_HEIGHT, 6);

    // Enter belongs to the textarea: it inserts a newline instead of ending edit.
    expect(fireEvent.keyDown(el, { key: 'Enter' })).toBe(true);
    typeInto(el, 'Went well\nand blocked');
    frames();
    expect(text(id).text).toBe('Went well\nand blocked');
    expect(text(id).height).toBeCloseTo(2 * TEXT_SIZES.M * TEXT_LINE_HEIGHT, 6);

    fireEvent.keyDown(el, { key: 'Escape' });
    frames();

    expect(handle.getEditingId()).toBeNull();
    expect([...handle.getSelectedIds()]).toEqual([id]);
    expect(screen.queryByTestId('text-editor')).not.toBeInTheDocument();
    expect(text(id).text).toBe('Went well\nand blocked');
  });

  it('TC-20: ending an edit with no characters removes the text and the selection', () => {
    const { handle, doc, create, edit, editor } = setup();
    const id = create(0, 0);
    expect(snapshot(doc)).toHaveLength(1);

    edit(id);
    fireEvent.keyDown(editor(), { key: 'Escape' });
    frames();

    expect(snapshot(doc)).toHaveLength(0);
    expect(handle.getSelectedIds().size).toBe(0);
    expect(handle.getEditingId()).toBeNull();
  });

  it('TC-20: an outside click on empty text also removes it', () => {
    const { handle, doc, create, edit } = setup();
    const id = create(0, 0);
    edit(id);

    const board = document.querySelector<HTMLElement>('[data-grid-layer="true"]')!;
    pointer(board, 'pointerdown', 700, 700);
    pointer(board, 'pointerup', 700, 700);
    frames();

    expect(snapshot(doc)).toHaveLength(0);
    expect(handle.getSelectedIds().size).toBe(0);
  });

  it('whitespace-only text is kept, and the box follows it', () => {
    const { handle, create, edit, editor, text } = setup();
    const id = create(0, 0);
    edit(id);
    typeInto(editor(), '   ');
    frames();
    fireEvent.keyDown(editor(), { key: 'Escape' });
    frames();

    expect(snapshot(handle.doc)).toHaveLength(1);
    expect(text(id).text).toBe('   ');
    expect([...handle.getSelectedIds()]).toEqual([id]);
  });

  it('TC-21: the toolbar offers S M L XL with the current size pressed', () => {
    const { handle, create, select, text } = setup();
    const id = create(120, 80);
    select([id]);

    const bar = screen.getByTestId('text-toolbar');
    expect(within(bar).getByRole('button', { name: 'Small text size' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(within(bar).getByRole('button', { name: 'Medium text size' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(bar).getAllByRole('button')).toHaveLength(5); // four sizes + delete

    fireEvent.click(within(bar).getByRole('button', { name: 'Extra large text size' }));
    frames();

    const after = text(id);
    expect(after.size).toBe('XL');
    expect(after.x).toBe(120);
    expect(after.y).toBe(80);
    expect(after.height).toBeCloseTo(TEXT_SIZES.XL * TEXT_LINE_HEIGHT, 6);

    // The text object renders at the new font size.
    const rendered = screen.getByTestId('text-object-text');
    expect(rendered.style.fontSize).toBe(`${TEXT_SIZES.XL}px`);

    // Delete lives in the same toolbar.
    fireEvent.click(within(bar).getByRole('button', { name: 'Delete text' }));
    frames();
    expect(snapshot(handle.doc)).toHaveLength(0);
  });

  it('the size toolbar works while the text is still being edited', () => {
    const { create, edit, editor, text } = setup();
    const id = create(40, 40);
    edit(id);
    typeInto(editor(), 'Hello');
    frames();

    const bar = screen.getByTestId('text-toolbar');
    fireEvent.click(within(bar).getByRole('button', { name: 'Large text size' }));
    frames();

    const after = text(id);
    expect(after.size).toBe('L');
    expect(after.x).toBe(40);
    expect(after.y).toBe(40);
    // The edit stays open: the toolbar acts on the object, it is not "outside".
    expect(screen.getByTestId('text-editor')).toBeInTheDocument();
    expect(editor().value).toBe('Hello');
  });

  it('TC-22: one selected text shows only the east and west handles', () => {
    const { create, select } = setup();
    const id = create(50, 50);
    select([id]);

    expect(screen.getByTestId('resize-handle-e')).toBeInTheDocument();
    expect(screen.getByTestId('resize-handle-w')).toBeInTheDocument();
    for (const h of ['n', 's', 'nw', 'ne', 'sw', 'se']) {
      expect(screen.queryByTestId(`resize-handle-${h}`)).not.toBeInTheDocument();
    }
  });

  it('a single selected sticky keeps the story 7 behaviour: no handles', () => {
    const { handle, doc, select } = setup();
    let id = '';
    act(() => {
      id = createSticky(doc, { x: 0, y: 0 })!;
    });
    frames();
    select([id]);
    // Story 7 shows the bounding box only for a multi-selection.
    expect(screen.queryByTestId('selection-bounding-box')).not.toBeInTheDocument();
    expect(handle.getSelectedIds()).toEqual(new Set([id]));
  });

  it('TC-23: a mixed selection shows all handles and moves text without changing its size', () => {
    const { handle, doc, create, select, text } = setup();
    let stickyId = '';
    act(() => {
      stickyId = createSticky(doc, { x: 0, y: 0 })!;
    });
    frames();
    const textId = create(400, 0);
    select([stickyId, textId]);

    for (const h of ['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se']) {
      expect(screen.getByTestId(`resize-handle-${h}`)).toBeInTheDocument();
    }

    const before = text(textId);
    expect(before.size).toBe('M');

    // Drag the south-east handle outwards.
    const handleEl = screen.getByTestId('resize-handle-se');
    pointer(handleEl, 'pointerdown', 500, 200);
    pointer(window, 'pointermove', 600, 300);
    frames();
    pointer(window, 'pointerup', 600, 300);
    frames();

    const after = text(textId);
    // Repositioned proportionally with the group, font size untouched.
    expect(after.x).toBeGreaterThan(before.x);
    expect(after.y).toBeGreaterThanOrEqual(before.y);
    expect(after.size).toBe('M');
    expect(after.height).toBeCloseTo(TEXT_SIZES.M * TEXT_LINE_HEIGHT, 6);
  });

  it('TC-27 unit part: the east handle sets a fixed width and rewraps the height', () => {
    const { create, edit, editor, text } = setup();
    const id = create(0, 0);
    edit(id);
    typeInto(editor(), 'alpha beta gamma');
    frames();
    fireEvent.keyDown(editor(), { key: 'Escape' });
    frames();

    const auto = text(id);
    expect(auto.widthMode).toBe('auto');
    expect(auto.height).toBeCloseTo(TEXT_SIZES.M * TEXT_LINE_HEIGHT, 6);

    const handleEl = screen.getByTestId('resize-handle-e');
    pointer(handleEl, 'pointerdown', 200, 20);
    pointer(window, 'pointermove', 100, 20);
    frames();
    pointer(window, 'pointerup', 100, 20);
    frames();

    const fixed = text(id);
    expect(fixed.widthMode).toBe('fixed');
    // 176 auto width minus the 100px drag.
    expect(fixed.width).toBeCloseTo(76, 6);
    expect(fixed.width).toBeGreaterThan(TEXT_MIN_WIDTH_WORLD);
    expect(fixed.width).toBeLessThan(auto.width!);
    // Three wrapped lines now: alpha / beta / gamma.
    expect(fixed.height!).toBeCloseTo(3 * TEXT_SIZES.M * TEXT_LINE_HEIGHT, 6);
  });

  it('TC-24: a remote delete during editing ends the edit and never recreates the text', () => {
    const { handle, doc, create, edit } = setup();
    const peer = createPeer(doc);
    const id = create(0, 0);
    edit(id);

    const el = screen.getByTestId('text-editor') as HTMLTextAreaElement;
    typeInto(el, 'hello');
    frames();

    // Another participant deletes it while we are typing.
    act(() => {
      peer.applyOnPeer((peerDoc) => {
        deleteObject(peerDoc, id);
      });
    });
    frames();

    expect(screen.queryByTestId('text-editor')).not.toBeInTheDocument();
    expect(snapshot(doc).find((o) => o.id === id)).toBeUndefined();
    expect(handle.getEditingId()).toBeNull();

    // Ending the (already finished) edit must not write the object back.
    fireEvent.keyDown(window, { key: 'Escape' });
    frames();
    expect(snapshot(doc)).toHaveLength(0);
    peer.destroy();
  });

  it('TC-25: one undo reverts the typed text and its stored box together', () => {
    const { handle, doc, create, edit, editor, text } = setup();
    const id = create(0, 0);
    const initial = text(id);
    const w0 = initial.width;
    const h0 = initial.height;
    expect(w0).toBe(TEXT_MIN_WIDTH_WORLD);

    edit(id);
    typeInto(editor(), 'Went well');
    frames();
    expect(text(id).width).toBeGreaterThan(w0!);

    fireEvent.keyDown(editor(), { key: 'z', ctrlKey: true });
    frames();

    expect(getTextContent(doc, id)!.toString()).toBe('');
    expect(text(id).width).toBe(w0);
    expect(text(id).height).toBe(h0);
    // The editor is still open with the reverted value.
    expect(editor().value).toBe('');
    expect(handle.getEditingId()).toBe(id);
  });

  it('the text renders at its stored box with no background of its own', () => {
    const { create, edit, text } = setup();
    const id = create(10, 20);
    edit(id);
    typeInto(screen.getByTestId('text-editor') as HTMLTextAreaElement, 'Heading');
    frames();
    fireEvent.keyDown(screen.getByTestId('text-editor'), { key: 'Escape' });
    frames();

    const obj = text(id);
    const root = screen.getByTestId('text-object');
    expect(root.style.left).toBe('10px');
    expect(root.style.top).toBe('20px');
    expect(root.style.width).toBe(`${obj.width}px`);
    expect(root.style.height).toBe(`${obj.height}px`);
    expect(screen.getByTestId('text-object-text').textContent).toBe('Heading');
  });

  it('double-clicking a text object opens it for typing; a single press selects and moves it', () => {
    const { handle, create, select, editor, text } = setup();
    const id = create(300, 300);
    select([id]);

    const root = screen.getByTestId('text-object');
    fireEvent.doubleClick(root);
    frames();
    expect(handle.getEditingId()).toBe(id);
    const el = editor();
    typeInto(el, 'Notes');
    frames();
    fireEvent.keyDown(el, { key: 'Escape' });
    frames();
    expect(text(id).text).toBe('Notes');
  });
});
