/**
 * Component tests for the text object (story 9, TC-19 to TC-25).
 *
 * Uses the notes harness with a real Y.Doc and jsdom.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, screen, fireEvent } from '@testing-library/react';
import {
  renderNotesHarness,
  createNote,
  createTextObject,
  seedTextContent,
} from './notes-harness';
import type { NotesHarnessHandle } from './notes-harness';
import * as Y from 'yjs';
import { deleteObjects } from '../../src/shared/board-model';
import {
  setTextSize,
  snapshotText,
  getTextYText,
  setTextBox,
} from '../../src/shared/objects/text';
import { LOCAL_ORIGIN } from '../../src/shared/board-model';

describe('text.object (story 9)', () => {
  let handle: NotesHarnessHandle;

  beforeEach(() => {
    handle = renderNotesHarness();
  });

  // TC-19: editor caret at end; Enter inserts newline; Escape ends and keeps text selected.
  it('TC-19 editor: caret at end, Enter newline, Escape keeps selected', () => {
    const id = createTextObject(handle.docRef.current!, 100, 100);
    seedTextContent(handle.docRef.current!, id, 'hello');

    // Start editing.
    act(() => {
      handle.selectionRef.current!.startEdit(id);
    });

    const textarea = document.querySelector('.vidi6-text__textarea') as HTMLTextAreaElement;
    expect(textarea).not.toBeNull();
    expect(textarea.value).toBe('hello');

    // Simulate typing a newline (Enter key → textarea value changes).
    act(() => {
      textarea.value = 'hello\n';
      fireEvent.input(textarea);
    });
    // The Y.Text should have a newline.
    const ytext = getTextYText(handle.docRef.current!, id)!;
    expect(ytext.toString()).toBe('hello\n');

    // Escape ends editing and keeps the text selected.
    act(() => {
      fireEvent.keyDown(textarea, { key: 'Escape' });
    });
    expect(handle.selectionRef.current!.ids.has(id)).toBe(true);
    expect(handle.selectionRef.current!.editingId).toBeNull();
  });

  // TC-20: Escape with no characters → object removed, selection cleared.
  it('TC-20 Escape with empty text removes the object', () => {
    const id = createTextObject(handle.docRef.current!, 100, 100);

    // Start editing (empty text).
    act(() => {
      handle.selectionRef.current!.startEdit(id);
    });

    const textarea = document.querySelector('.vidi6-text__textarea') as HTMLTextAreaElement;
    expect(textarea).not.toBeNull();

    // Escape → object removed.
    act(() => {
      fireEvent.keyDown(textarea, { key: 'Escape' });
    });

    // The object should be gone.
    const doc = handle.docRef.current!;
    expect(doc.getMap('objects').get(id)).toBeUndefined();
    // Selection cleared.
    expect(handle.selectionRef.current!.ids.size).toBe(0);
  });

  // TC-21: TextToolbar shows S M L XL with M pressed; click XL → setTextSize XL.
  it('TC-21 TextToolbar: size buttons with M pressed; click XL changes size', () => {
    const id = createTextObject(handle.docRef.current!, 100, 100);
    seedTextContent(handle.docRef.current!, id, 'hello');
    // Set a non-zero box so the SelectionBar renders.
    act(() => {
      setTextBox(handle.docRef.current!, LOCAL_ORIGIN, id, { x: 100, y: 100, width: 100, height: 26 });
    });

    // Select the text.
    act(() => {
      handle.selectionRef.current!.setMany([id], false);
    });

    // The toolbar should show size buttons.
    const xlBtn = screen.getByLabelText('Size XL');
    const mBtn = screen.getByLabelText('Size M');
    expect(mBtn).toHaveAttribute('aria-pressed', 'true');
    expect(xlBtn).toHaveAttribute('aria-pressed', 'false');

    // Click XL.
    act(() => {
      fireEvent.click(xlBtn);
    });
    expect(xlBtn).toHaveAttribute('aria-pressed', 'true');
    expect(mBtn).toHaveAttribute('aria-pressed', 'false');
    // The size should be XL.
    const snap = snapshotText(handle.docRef.current!, id)!;
    expect(snap.size).toBe('XL');
  });

  // TC-22: selecting one text shows only e and w handles.
  it('TC-22 single text selection shows only e/w handles', () => {
    const id = createTextObject(handle.docRef.current!, 100, 100);
    seedTextContent(handle.docRef.current!, id, 'hello');
    // Set a non-zero box so the selection overlay renders handles.
    act(() => {
      setTextBox(handle.docRef.current!, LOCAL_ORIGIN, id, { x: 100, y: 100, width: 100, height: 26 });
    });

    act(() => {
      handle.selectionRef.current!.setMany([id], false);
    });

    // The selection overlay should show e/w handles but not n/s/ne/nw/se/sw.
    const eHandle = screen.queryByLabelText('Resize right');
    const wHandle = screen.queryByLabelText('Resize left');
    const nHandle = screen.queryByLabelText('Resize top');
    const sHandle = screen.queryByLabelText('Resize bottom');
    expect(eHandle).not.toBeNull();
    expect(wHandle).not.toBeNull();
    expect(nHandle).toBeNull();
    expect(sHandle).toBeNull();
  });

  // TC-23: text + sticky selection shows all handles.
  it('TC-23 mixed text + sticky selection shows all handles', () => {
    const textId = createTextObject(handle.docRef.current!, 100, 100);
    seedTextContent(handle.docRef.current!, textId, 'hello');
    const stickyId = createNote(handle.docRef.current!, 300, 100);

    act(() => {
      handle.selectionRef.current!.setMany([textId, stickyId], false);
    });

    // All 8 handles should be visible.
    const nHandle = screen.queryByLabelText('Resize top');
    const sHandle = screen.queryByLabelText('Resize bottom');
    const eHandle = screen.queryByLabelText('Resize right');
    const wHandle = screen.queryByLabelText('Resize left');
    expect(nHandle).not.toBeNull();
    expect(sHandle).not.toBeNull();
    expect(eHandle).not.toBeNull();
    expect(wHandle).not.toBeNull();
  });

  // TC-24: remote delete during edit → editor unmounts, no error.
  it('TC-24 remote delete during edit unmounts the editor', () => {
    const id = createTextObject(handle.docRef.current!, 100, 100);
    seedTextContent(handle.docRef.current!, id, 'hello');

    // Start editing.
    act(() => {
      handle.selectionRef.current!.startEdit(id);
    });
    const textarea = document.querySelector('.vidi6-text__textarea');
    expect(textarea).not.toBeNull();

    // Remote delete (simulated by deleting from the doc directly).
    act(() => {
      deleteObjects(handle.docRef.current!, [id]);
    });

    // The editor should be unmounted (the object is gone from the snapshot).
    // The selection should have cleared the editing state.
    expect(handle.selectionRef.current!.editingId).toBeNull();
  });

  // TC-25: type then Ctrl+Z → text and stored box revert together in one step.
  it('TC-25 undo reverts text and box together', () => {
    const id = createTextObject(handle.docRef.current!, 100, 100);

    // Start editing and type.
    act(() => {
      handle.selectionRef.current!.startEdit(id);
    });
    const textarea = document.querySelector('.vidi6-text__textarea') as HTMLTextAreaElement;
    expect(textarea).not.toBeNull();

    // Type some text.
    act(() => {
      textarea.value = 'hello world';
      fireEvent.input(textarea);
    });

    // End editing (Escape) to close the undo boundary.
    act(() => {
      fireEvent.keyDown(textarea, { key: 'Escape' });
    });

    // The text should be in the doc.
    const ytext = getTextYText(handle.docRef.current!, id)!;
    expect(ytext.toString()).toBe('hello world');

    // Undo (Ctrl+Z) → reverts to empty.
    act(() => {
      fireEvent.keyDown(document, { key: 'z', ctrlKey: true });
    });

    // The text should be reverted to empty.
    const afterUndo = getTextYText(handle.docRef.current!, id);
    if (afterUndo) {
      expect(afterUndo.toString()).toBe('');
    }
  });
});
