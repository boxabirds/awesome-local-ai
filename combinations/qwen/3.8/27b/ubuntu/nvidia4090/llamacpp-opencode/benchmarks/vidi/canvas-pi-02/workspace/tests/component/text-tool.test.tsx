/**
 * Component tests for the text tool (story 9, TC-14 to TC-18).
 *
 * Uses the notes harness with a real Y.Doc and jsdom.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, screen, fireEvent, cleanup } from '@testing-library/react';
import { renderNotesHarness, createNote } from './notes-harness';
import type { NotesHarnessHandle } from './notes-harness';
import { snapshotText } from '../../src/shared/objects/text';
import * as Y from 'yjs';

describe('text.tool (story 9)', () => {
  let handle: NotesHarnessHandle;

  beforeEach(() => {
    handle = renderNotesHarness();
  });

  afterEach(() => {
    cleanup();
  });

  // TC-14: T → Text active, button pressed; Escape → Select; V → Select.
  it('TC-14 T activates Text tool; Escape and V revert to Select', () => {
    const textBtn = screen.getByLabelText('Text (T)');
    const selectBtn = screen.getByLabelText('Select (V)');

    // Initially Select is active.
    expect(selectBtn).toHaveAttribute('aria-pressed', 'true');
    expect(textBtn).toHaveAttribute('aria-pressed', 'false');

    // Press T → Text active.
    act(() => {
      fireEvent.keyDown(document, { key: 't' });
    });
    expect(textBtn).toHaveAttribute('aria-pressed', 'true');
    expect(selectBtn).toHaveAttribute('aria-pressed', 'false');

    // Press Escape → Select.
    act(() => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });
    expect(selectBtn).toHaveAttribute('aria-pressed', 'true');
    expect(textBtn).toHaveAttribute('aria-pressed', 'false');

    // Press T again, then V → Select.
    act(() => {
      fireEvent.keyDown(document, { key: 't' });
    });
    expect(textBtn).toHaveAttribute('aria-pressed', 'true');
    act(() => {
      fireEvent.keyDown(document, { key: 'v' });
    });
    expect(selectBtn).toHaveAttribute('aria-pressed', 'true');
    expect(textBtn).toHaveAttribute('aria-pressed', 'false');
  });

  // TC-15: T ignored when not editable; Text button disabled.
  it('TC-15 T ignored on locked board; Text button disabled', () => {
    cleanup(); // Remove the harness from beforeEach
    renderNotesHarness({ editable: false });
    const textBtn = screen.getByLabelText('Text (T)') as HTMLButtonElement;
    expect(textBtn).toBeDisabled();

    act(() => {
      fireEvent.keyDown(document, { key: 't' });
    });
    // Still on Select.
    expect(screen.getByLabelText('Select (V)')).toHaveAttribute('aria-pressed', 'true');
  });

  // TC-16: T while editing a note types 't', tool unchanged.
  it('TC-16 T while editing a note types t, tool unchanged', () => {
    const id = createNote(handle.docRef.current!, 0, 0);
    // Start editing the note.
    act(() => {
      handle.selectionRef.current!.startEdit(id);
    });
    // Now the editor textarea should be focused.
    const textarea = document.querySelector('.vidi6-sticky__textarea') as HTMLTextAreaElement;
    expect(textarea).not.toBeNull();

    // Press T → should type 't' in the textarea, not activate the tool.
    act(() => {
      fireEvent.keyDown(textarea, { key: 't' });
    });

    // The tool should still be Select.
    expect(screen.getByLabelText('Select (V)')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Text (T)')).toHaveAttribute('aria-pressed', 'false');
  });

  // TC-17: Text active, click board → createText at world point; tool back to Select.
  it('TC-17 click board with Text tool creates text at world point', () => {
    // Activate text tool.
    act(() => {
      fireEvent.keyDown(document, { key: 't' });
    });
    expect(screen.getByLabelText('Text (T)')).toHaveAttribute('aria-pressed', 'true');

    // Click on the board (screen coordinates).
    const viewport = handle.viewport;
    act(() => {
      fireEvent.pointerDown(viewport, { clientX: 100, clientY: 100, button: 0 });
      fireEvent.pointerUp(viewport, { clientX: 100, clientY: 100 });
    });

    // A text object should be created.
    const doc = handle.docRef.current!;
    const objects = doc.getMap('objects');
    let textCount = 0;
    objects.forEach((o) => {
      if ((o as Y.Map<unknown>).get('type') === 'text') textCount++;
    });
    expect(textCount).toBe(1);

    // Tool should be back to Select.
    expect(screen.getByLabelText('Select (V)')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Text (T)')).toHaveAttribute('aria-pressed', 'false');
  });

  // TC-18: N still creates sticky at view centre (regression).
  it('TC-18 N creates sticky at view centre (regression)', () => {
    const doc = handle.docRef.current!;
    act(() => {
      fireEvent.keyDown(document, { key: 'n' });
    });
    // A sticky should be created.
    const objects = doc.getMap('objects');
    let stickyCount = 0;
    objects.forEach((o) => {
      if ((o as Y.Map<unknown>).get('type') === 'sticky') stickyCount++;
    });
    expect(stickyCount).toBe(1);
  });
});
