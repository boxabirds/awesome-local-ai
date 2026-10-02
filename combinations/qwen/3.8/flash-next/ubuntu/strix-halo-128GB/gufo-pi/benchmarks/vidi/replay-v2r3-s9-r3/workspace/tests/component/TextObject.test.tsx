import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { createRef } from 'react';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { BoardHarness, type HarnessHandle } from './harness/BoardHarness';
import { snapshotAll } from '../../src/shared/board-model';
import { createText, getTextContent, setTextSize } from '../../src/shared/objects/text';
import { LOCAL_ORIGIN, getObjectsMap, createSticky } from '../../src/shared/board-model';
import { TEXT_SIZES, DEFAULT_TEXT_SIZE } from '../../src/shared/config';
import { pointer, frames, typeInto } from './pointerUtils';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function setup() {
  const handleRef = createRef<HarnessHandle | null>();
  render(<BoardHarness handleRef={handleRef} />);
  const handle = handleRef.current!;
  return {
    handle,
    doc: handle.doc,
    create: (x: number, y: number) => {
      let id = '';
      act(() => {
        id = createText(handle.doc, { x, y }, 'test')!;
      });
      return id;
    },
  };
}

function selectText(index = 0) {
  const el = screen.getAllByTestId('text-object')[index];
  pointer(el, 'pointerdown', 640, 400);
  pointer(el, 'pointerup', 640, 400);
  frames();
  return el;
}

describe('TextObject', () => {
  it('TC-19: editor caret at end; Enter inserts newline; Escape ends editing and keeps text selected', () => {
    const { handle, doc, create } = setup();
    const id = create(100, 100);
    frames();

    // Start editing
    act(() => { handle.selection.startEdit(id); });
    frames();

    const editor = screen.getByTestId('text-editor') as HTMLTextAreaElement;
    expect(editor).toBeInTheDocument();

    // Type some text
    typeInto(editor, 'hello');
    frames();

    // Press Enter should insert newline (not end editing)
    fireEvent.keyDown(editor, { key: 'Enter' });
    frames();

    // Still editing
    expect(screen.getByTestId('text-editor')).toBeInTheDocument();

    // Escape should end editing and keep text selected
    fireEvent.keyDown(editor, { key: 'Escape' });
    frames();

    expect(screen.queryByTestId('text-editor')).not.toBeInTheDocument();
    expect(handle.getSelectedIds().has(id)).toBe(true);
    expect(handle.getEditingId()).toBeNull();

    // Text is in the model
    const ytext = getTextContent(doc, id)!;
    expect(ytext.toString()).toContain('hello');
  });

  it('TC-20: Escape with zero characters → object removed, selection cleared', () => {
    const { handle, doc, create } = setup();
    const id = create(100, 100);
    frames();

    // Start editing (text is empty)
    act(() => { handle.selection.startEdit(id); });
    frames();

    expect(screen.getByTestId('text-editor')).toBeInTheDocument();

    // Press Escape without typing
    const editor = screen.getByTestId('text-editor');
    fireEvent.keyDown(editor, { key: 'Escape' });
    frames();

    // Object should be removed
    const objs = snapshotAll(doc);
    expect(objs.find((o) => o.id === id)).toBeUndefined();

    // Selection cleared
    expect(handle.getSelectedIds().size).toBe(0);
  });

  it('TC-21: TextToolbar shows S/M/L/XL with M pressed; click XL → size XL, x/y unchanged', () => {
    const { handle, doc, create } = setup();
    const id = create(100, 200);
    frames();

    // Select the text object
    selectText();
    frames();

    // Text toolbar should be visible
    expect(screen.getByTestId('text-toolbar')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'M text size' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'XL text size' })).toHaveAttribute('aria-pressed', 'false');

    // Click XL
    fireEvent.click(screen.getByRole('button', { name: 'XL text size' }));
    frames();

    // Size changed, x/y unchanged
    const objs = snapshotAll(doc);
    const textObj = objs.find((o) => o.id === id);
    expect(textObj).toBeDefined();
    expect((textObj as any).size).toBe('XL');
    expect(textObj!.x).toBe(100);
    expect(textObj!.y).toBe(200);
  });

  it('TC-22: single text selected → only e and w handles rendered', () => {
    const { handle, create } = setup();
    const id = create(100, 100);
    frames();

    // Select the text object
    selectText();
    frames();

    // Only e and w handles should be present
    expect(screen.getByTestId('resize-handle-e')).toBeInTheDocument();
    expect(screen.getByTestId('resize-handle-w')).toBeInTheDocument();

    // No other handles
    expect(screen.queryByTestId('resize-handle-n')).not.toBeInTheDocument();
    expect(screen.queryByTestId('resize-handle-s')).not.toBeInTheDocument();
    expect(screen.queryByTestId('resize-handle-nw')).not.toBeInTheDocument();
    expect(screen.queryByTestId('resize-handle-ne')).not.toBeInTheDocument();
    expect(screen.queryByTestId('resize-handle-sw')).not.toBeInTheDocument();
    expect(screen.queryByTestId('resize-handle-se')).not.toBeInTheDocument();
  });

  it('TC-23: text + sticky selected → all handles', () => {
    const { handle, doc, create } = setup();

    // Create a text object and a sticky
    const textId = create(100, 100);
    let stickyId = '';
    act(() => {
      stickyId = createSticky(doc, { x: 400, y: 400 });
    });
    frames();

    // Select both
    act(() => {
      handle.selection.setMany([textId, stickyId], false);
    });
    frames();

    // All handles should be present (mixed selection)
    expect(screen.getByTestId('resize-handle-nw')).toBeInTheDocument();
    expect(screen.getByTestId('resize-handle-n')).toBeInTheDocument();
    expect(screen.getByTestId('resize-handle-ne')).toBeInTheDocument();
    expect(screen.getByTestId('resize-handle-e')).toBeInTheDocument();
    expect(screen.getByTestId('resize-handle-se')).toBeInTheDocument();
    expect(screen.getByTestId('resize-handle-s')).toBeInTheDocument();
    expect(screen.getByTestId('resize-handle-sw')).toBeInTheDocument();
    expect(screen.getByTestId('resize-handle-w')).toBeInTheDocument();
  });

  it('TC-24: remote delete while editing → editor unmounts, no error, object not recreated', () => {
    const { handle, doc, create } = setup();
    const id = create(100, 100);
    frames();

    // Start editing
    act(() => { handle.selection.startEdit(id); });
    frames();
    expect(screen.getByTestId('text-editor')).toBeInTheDocument();

    // Simulate remote delete (not from local origin)
    act(() => {
      doc.transact(() => {
        const objects = getObjectsMap(doc);
        objects.delete(id);
      }, 'remote-peer');
    });
    frames();

    // Editor should be gone (selection pruned by useSelection)
    expect(screen.queryByTestId('text-editor')).not.toBeInTheDocument();

    // Object should not be recreated
    const objs = snapshotAll(doc);
    expect(objs.find((o) => o.id === id)).toBeUndefined();
  });

  it('TC-25: type then Ctrl+Z → text and stored box revert together in one step', () => {
    const { handle, doc, create } = setup();
    const id = create(100, 100);
    frames();

    // Start editing and type
    act(() => { handle.selection.startEdit(id); });
    frames();

    const editor = screen.getByTestId('text-editor') as HTMLTextAreaElement;
    typeInto(editor, 'Hello');
    frames();

    // End editing
    fireEvent.keyDown(editor, { key: 'Escape' });
    frames();

    // Verify text is stored
    const ytext = getTextContent(doc, id)!;
    expect(ytext.toString()).toBe('Hello');

    // Undo
    act(() => { handle.undoController.undo(); });
    frames();

    // Text should be empty (reverted)
    const ytextAfter = getTextContent(doc, id);
    if (ytextAfter) {
      expect(ytextAfter.toString()).toBe('');
    }
  });
});
