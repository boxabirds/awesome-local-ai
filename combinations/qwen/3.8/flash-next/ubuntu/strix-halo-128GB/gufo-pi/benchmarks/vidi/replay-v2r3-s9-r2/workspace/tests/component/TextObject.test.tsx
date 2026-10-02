/**
 * Component tests for text objects (story 9, text.object): editing, empty
 * removal, the size toolbar, horizontal-only handles, remote deletion during
 * editing and undo of a typed line together with its box.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { createRef } from 'react';
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react';
import * as Y from 'yjs';
import { BoardHarness, type HarnessHandle } from './harness/BoardHarness';
import { deleteObject, getObjectsMap, initDoc, snapshot, snapshotObjects, createSticky, LOCAL_ORIGIN } from '../../src/shared/board-model';
import { applyTextDiff } from '../../src/shared/text-edit';
import { createText, getTextContent } from '../../src/shared/objects/text';
import type { TextSnapshot } from '../../src/shared/objects/text';
import {
  TEXT_AUTO_WIDTH_PADDING_WORLD,
  TEXT_LINE_HEIGHT,
  TEXT_SIZES,
} from '../../src/shared/config';
import type { Measurer } from '../../src/client/objects/textLayout';
import { pointer, frames, typeInto } from './pointerUtils';

/** Deterministic measurer: 0.5 world units per character per font px. */
const measure: Measurer = (text, fontPx) => Array.from(text).length * fontPx * 0.5;

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
  const doc = handle.doc;

  const makeText = (text = '', x = 200, y = 150): string => {
    let id = '';
    act(() => {
      id = createText(doc, { x, y }, 'tester')!;
    });
    frames();
    if (text) {
      // Typed after the object is on the board, as it is in the app: this client
      // measures the box of the change it just made.
      act(() => {
        applyTextDiff(getTextContent(doc, id)!, text, LOCAL_ORIGIN);
      });
      frames();
    }
    return id;
  };

  const editText = (id: string) => {
    act(() => {
      handle.selection.startEdit(id);
    });
    frames();
    return screen.getByTestId('text-editor') as HTMLTextAreaElement;
  };

  return { handle, doc, makeText, editText };
}

function texts(doc: Y.Doc): (TextSnapshot & { width: number; height: number })[] {
  return snapshotObjects(doc).filter((obj) => obj.type === 'text') as (
    TextSnapshot & { width: number; height: number }
  )[];
}

function textRoot(index = 0): HTMLElement {
  return screen.getAllByTestId('text-object')[index];
}

/** The single sticky note of the board, with its box narrowed to numbers. */
function stickyBox(doc: Y.Doc) {
  const note = snapshot(doc)[0];
  return { ...note, width: note.width ?? 0, height: note.height ?? 0 };
}

/** Relays updates between the board's doc and a simulated peer, as the server would. */
function linkDocs(a: Y.Doc, b: Y.Doc): () => void {
  let syncing = false;
  const relay = (from: Y.Doc, to: Y.Doc) => (update: Uint8Array, origin: unknown) => {
    if (syncing || origin === 'provider') return;
    syncing = true;
    try {
      to.transact(() => Y.applyUpdate(to, update), 'provider');
    } finally {
      syncing = false;
    }
  };
  const onA = relay(a, b);
  const onB = relay(b, a);
  a.on('update', onA);
  b.on('update', onB);
  return () => {
    a.off('update', onA);
    b.off('update', onB);
  };
}

/** Push everything `from` knows about into `to`, as the provider would. */
function syncDocs(from: Y.Doc, to: Y.Doc): void {
  to.transact(() => Y.applyUpdate(to, Y.encodeStateAsUpdate(from)), 'provider');
}

describe('TextObject (story 9)', () => {
  it('TC-19: the caret starts at the end of the text, Enter adds a line, Escape keeps it selected', () => {
    const { handle, doc, makeText, editText } = setup();
    const id = makeText('Went');

    let editor = editText(id);
    expect(editor).toHaveFocus();
    // The caret goes after the existing characters, not before them.
    expect(editor.value).toBe('Went');
    expect(editor.selectionStart).toBe(4);
    expect(editor.selectionEnd).toBe(4);

    // Enter belongs to the textarea: editing continues and the newline is kept.
    editor = editText(id);
    fireEvent.keyDown(editor, { key: 'Enter' });
    frames();
    typeInto(editor, 'Went\nwell');
    frames();
    expect(handle.getEditingId()).toBe(id);
    expect(getTextContent(doc, id)!.toString()).toBe('Went\nwell');
    // Two lines: the height follows the content.
    expect(texts(doc)[0].height).toBeCloseTo(2 * TEXT_SIZES.M * TEXT_LINE_HEIGHT, 6);

    fireEvent.keyDown(editor, { key: 'Escape' });
    frames();

    expect(handle.getEditingId()).toBeNull();
    expect(handle.getSelectedId()).toBe(id);
    expect(getTextContent(doc, id)!.toString()).toBe('Went\nwell');
    const content = screen.getByTestId('text-object-content');
    expect(content.textContent).toBe('Went\nwell');
    expect(content).toHaveTextContent('Went well');
  });

  it('TC-20: Escape with nothing typed removes the object and clears the selection', () => {
    const { handle, doc, makeText, editText } = setup();
    const id = makeText();

    const editor = editText(id);
    fireEvent.keyDown(editor, { key: 'Escape' });
    frames();

    // No invisible text is left behind.
    expect(texts(doc)).toHaveLength(0);
    expect(getObjectsMap(doc).get(id)).toBeUndefined();
    expect(handle.getSelectedIds().size).toBe(0);
    expect(handle.getEditingId()).toBeNull();
    expect(screen.queryByTestId('text-object')).not.toBeInTheDocument();
  });

  it('TC-20b: whitespace alone is content and survives the end of editing', () => {
    const { handle, doc, makeText, editText } = setup();
    const id = makeText();

    const editor = editText(id);
    typeInto(editor, '   ');
    frames();
    fireEvent.keyDown(editor, { key: 'Escape' });
    frames();

    expect(texts(doc)).toHaveLength(1);
    expect(handle.getSelectedId()).toBe(id);
  });

  it('TC-21: the toolbar shows S M L XL with the current size pressed, and XL keeps x and y', () => {
    const { handle, doc, makeText } = setup();
    const id = makeText('Went well', 210, 160);
    act(() => {
      handle.selection.click(id);
    });
    frames();

    const toolbar = screen.getByTestId('text-toolbar');
    expect(toolbar).toBeInTheDocument();
    for (const key of ['S', 'M', 'L', 'XL']) {
      expect(screen.getByTestId(`text-size-${key}`)).toBeInTheDocument();
    }
    expect(screen.getByTestId('text-size-M')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('text-size-XL')).toHaveAttribute('aria-pressed', 'false');

    const before = texts(doc)[0];
    fireEvent.click(screen.getByTestId('text-size-XL'));
    frames();

    const after = texts(doc)[0];
    expect(after.size).toBe('XL');
    // Only the font changes: the text stays exactly where it was.
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    // Its box grew with the font.
    expect(after.height).toBeCloseTo(TEXT_SIZES.XL * TEXT_LINE_HEIGHT, 6);
    expect(after.width).toBeGreaterThan(before.width);
    expect(screen.getByTestId('text-size-XL')).toHaveAttribute('aria-pressed', 'true');
  });

  it('TC-21b: the toolbar Delete button removes the text', () => {
    const { handle, doc, makeText } = setup();
    const id = makeText('Delete me');
    act(() => {
      handle.selection.click(id);
    });
    frames();

    fireEvent.click(screen.getByTestId('delete-text-button'));
    frames();

    expect(texts(doc)).toHaveLength(0);
    expect(handle.getSelectedIds().size).toBe(0);
  });

  it('TC-22: a single selected text shows only the east and west handles', () => {
    const { handle, makeText } = setup();
    const id = makeText('Wrap me');
    act(() => {
      handle.selection.click(id);
    });
    frames();

    expect(screen.getByTestId('resize-handle-e')).toBeInTheDocument();
    expect(screen.getByTestId('resize-handle-w')).toBeInTheDocument();
    for (const h of ['n', 's', 'nw', 'ne', 'se', 'sw']) {
      expect(screen.queryByTestId(`resize-handle-${h}`)).not.toBeInTheDocument();
    }
  });

  it('TC-22b: dragging the east handle fixes the width and rewraps the text', () => {
    const { handle, doc, makeText } = setup();
    const sentence = 'a'.repeat(20) + ' ' + 'b'.repeat(20) + ' ' + 'c'.repeat(20);
    const id = makeText(sentence);
    act(() => {
      handle.selection.click(id);
    });
    frames();

    const before = texts(doc)[0];
    expect(before.widthMode).toBe('auto');

    // Its east handle is at (x + width, y + height / 2) in world units.
    const startX = before.x + before.width;
    const startY = before.y + before.height / 2;
    pointer(screen.getByTestId('resize-handle-e'), 'pointerdown', startX, startY);
    pointer(window, 'pointermove', startX - 320, startY);
    frames();
    pointer(window, 'pointerup', startX - 320, startY);
    frames();

    const after = texts(doc)[0];
    expect(after.widthMode).toBe('fixed');
    expect(after.width).toBeCloseTo(before.width - 320, 6);
    expect(after.x).toBeCloseTo(before.x, 6);
    // The narrower box holds more lines: one word per line now.
    expect(after.height).toBeCloseTo(3 * TEXT_SIZES.M * TEXT_LINE_HEIGHT, 6);
    expect(after.height).toBeGreaterThan(before.height);
  });

  it('TC-23: a mixed selection shows every handle and resizes the text without changing its font', () => {
    const { handle, doc, makeText } = setup();
    const textId = makeText('Went well', 100, 100);
    let stickyId = '';
    act(() => {
      stickyId = createSticky(doc, { x: 500, y: 100 })!;
    });
    frames();

    act(() => {
      handle.selection.setMany([textId, stickyId], false);
    });
    frames();

    for (const h of ['n', 's', 'e', 'w', 'nw', 'ne', 'se', 'sw']) {
      expect(screen.getByTestId(`resize-handle-${h}`)).toBeInTheDocument();
    }

    const textBefore = texts(doc)[0];
    const stickyBefore = stickyBox(doc);
    expect(stickyBefore.x).toBeGreaterThan(textBefore.x);

    // Drag the bottom-right handle of the group outwards.
    pointer(screen.getByTestId('resize-handle-se'), 'pointerdown', 700, 300);
    pointer(window, 'pointermove', 800, 400);
    frames();
    pointer(window, 'pointerup', 800, 400);
    frames();

    const textAfter = texts(doc)[0];
    const stickyAfter = stickyBox(doc);

    // A handle never changes the font size, and an automatic width is left alone.
    expect(textAfter.size).toBe('M');
    expect(textAfter.width).toBe(textBefore.width);
    // The note grew and the gap between the objects grew with it, so the text
    // kept its place in the group rather than being stretched.
    expect(stickyAfter.width).toBeGreaterThan(stickyBefore.width);
    expect(stickyAfter.x - textAfter.x).toBeGreaterThan(stickyBefore.x - textBefore.x);
  });

  it('TC-24: a remote delete while editing ends editing silently', () => {
    const { handle, doc, makeText, editText } = setup();
    const errors: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      const message = args.map(String).join(' ');
      if (!message.includes('not wrapped in act')) errors.push(message);
    });

    const peer = new Y.Doc();
    initDoc(peer);
    const id = makeText('Shared heading');
    // The peer is a second browser that was already on the board.
    syncDocs(doc, peer);
    const unlink = linkDocs(doc, peer);

    const editor = editText(id);
    expect(editor).toBeInTheDocument();

    act(() => {
      deleteObject(peer, id);
      syncDocs(peer, doc);
    });
    frames();

    // The text is gone, the editor unmounted, nothing was recreated.
    expect(getObjectsMap(doc).get(id)).toBeUndefined();
    expect(screen.queryByTestId('text-editor')).not.toBeInTheDocument();
    expect(screen.queryByTestId('text-object')).not.toBeInTheDocument();
    act(() => {
      frames(4);
    });
    expect(getObjectsMap(doc).get(id)).toBeUndefined();
    expect(handle.getEditingId()).toBeNull();
    expect(errors).toEqual([]);

    spy.mockRestore();
    unlink();
    peer.destroy();
  });

  it('TC-25: one undo reverts the typed text and its box together', () => {
    const { handle, doc, makeText, editText } = setup();
    const id = makeText();
    const empty = texts(doc)[0];
    const emptyWidth = empty.width;
    const emptyHeight = empty.height;

    const editor = editText(id);
    typeInto(editor, 'Went well and a few more words');
    frames();
    const typed = texts(doc)[0];
    expect(typed.width).toBeGreaterThan(emptyWidth);
    expect(getTextContent(doc, id)!.toString()).toBe('Went well and a few more words');

    // Ctrl+Z inside the editor goes to the board's undo controller, not to the
    // textarea's own history.
    fireEvent.keyDown(editor, { key: 'z', ctrlKey: true });
    frames();

    const reverted = texts(doc)[0];
    expect(getTextContent(doc, id)!.toString()).toBe('');
    expect(reverted.width).toBeCloseTo(emptyWidth, 6);
    expect(reverted.height).toBeCloseTo(emptyHeight, 6);
    // Still editing, and the textarea shows the reverted text.
    expect(handle.getEditingId()).toBe(id);
    expect((screen.getByTestId('text-editor') as HTMLTextAreaElement).value).toBe('');

    // One more undo steps back past the creation, which removes it for good.
    fireEvent.keyDown(editor, { key: 'z', ctrlKey: true });
    frames();
    expect(getObjectsMap(doc).get(id)).toBeUndefined();
  });

  it('the text is drawn without any fill, at its stored box', () => {
    const { doc, makeText } = setup();
    makeText('Plain text');
    frames();

    const root = textRoot();
    expect(root).toHaveAttribute('aria-label', 'Text');
    expect(root.style.backgroundColor).toBeFalsy();
    const content = screen.getByTestId('text-object-content');
    expect(content.style.whiteSpace).toBe('pre-wrap');
    expect(content).toHaveTextContent('Plain text');
    // The stored box is wider than the words alone, and one line high.
    const stored = texts(doc)[0];
    expect(stored.width).toBeCloseTo(
      measure('Plain text', TEXT_SIZES.M) + TEXT_AUTO_WIDTH_PADDING_WORLD,
      6,
    );
    expect(stored.height).toBeCloseTo(TEXT_SIZES.M * TEXT_LINE_HEIGHT, 6);
  });
});
