import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import * as Y from 'yjs';
import {
  initDoc,
  createSticky,
  snapshot,
  setRegisteredTypes,
} from '../../src/shared/board-model';
import { createUndo, type UndoController } from '../../src/client/board/undo';
import { useUndo } from '../../src/client/board/useUndo';
import { Toolbar } from '../../src/client/board/Toolbar';
import { useBoardKeys } from '../../src/client/board/useBoardKeys';

function ToolbarHarness({ controller }: { controller: UndoController | null }) {
  const undo = useUndo(controller);
  return <Toolbar onCreateSticky={() => {}} undo={undo} />;
}

function KeysHarness({
  doc,
  canEdit,
  undo,
}: {
  doc: Y.Doc;
  canEdit: boolean;
  undo?: UndoController | null;
}) {
  useBoardKeys({
    doc,
    selection: {
      ids: new Set<string>(),
      editingId: null,
      click: vi.fn(),
      toggle: vi.fn(),
      setMany: vi.fn(),
      clear: vi.fn(),
      startEdit: vi.fn(),
      endEdit: vi.fn(),
    },
    snapshot: snapshot(doc),
    canEdit,
    undo: undo ?? undefined,
  });
  return <div data-testid="keys-harness" />;
}

let controller: UndoController | null = null;

beforeEach(() => {
  setRegisteredTypes(new Set(['sticky']));
});

afterEach(() => {
  controller?.destroy();
  controller = null;
  cleanup();
});

describe('undo/redo toolbar controls (story 8)', () => {
  // TC-18: enabled/disabled states track the stacks; clicks drive the controller
  it('TC-18: button states reflect the stacks and clicks drive the controller', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    controller = createUndo(doc);

    // No local changes yet → both buttons disabled
    render(<ToolbarHarness controller={controller} />);
    const undoBtn = document.querySelector<HTMLButtonElement>('[aria-label="Undo"]')!;
    const redoBtn = document.querySelector<HTMLButtonElement>('[aria-label="Redo"]')!;
    expect(undoBtn.disabled).toBe(true);
    expect(redoBtn.disabled).toBe(true);

    // One local change → undo enabled (the onChange subscription re-renders)
    act(() => {
      createSticky(doc, { x: 0, y: 0 });
    });
    const undoBtn2 = document.querySelector<HTMLButtonElement>('[aria-label="Undo"]')!;
    const redoBtn2 = document.querySelector<HTMLButtonElement>('[aria-label="Redo"]')!;
    expect(undoBtn2.disabled).toBe(false);
    expect(redoBtn2.disabled).toBe(true);

    // Click undo → the sticky is removed
    act(() => {
      undoBtn2.click();
    });
    expect(snapshot(doc).length).toBe(0);

    // Now redo is enabled, undo disabled
    const undoBtn3 = document.querySelector<HTMLButtonElement>('[aria-label="Undo"]')!;
    const redoBtn3 = document.querySelector<HTMLButtonElement>('[aria-label="Redo"]')!;
    expect(undoBtn3.disabled).toBe(true);
    expect(redoBtn3.disabled).toBe(false);

    // Click redo → the sticky is back
    act(() => {
      redoBtn3.click();
    });
    expect(snapshot(doc).length).toBe(1);
  });

  // TC-19: remote changes never enable the buttons (negative)
  it('TC-19: a remote change does not enable undo', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    controller = createUndo(doc);

    render(<ToolbarHarness controller={controller} />);

    // Simulate a remote update: a transaction with a non-local origin
    doc.transact(() => {
      createSticky(doc, { x: 0, y: 0 });
    }, 'remote-peer');

    const undoBtn = document.querySelector<HTMLButtonElement>('[aria-label="Undo"]')!;
    const redoBtn = document.querySelector<HTMLButtonElement>('[aria-label="Redo"]')!;
    expect(undoBtn.disabled).toBe(true);
    expect(redoBtn.disabled).toBe(true);
    expect(controller.canUndo()).toBe(false);
  });

  // TC-20: Ctrl+Z with canEdit=false does not call the controller (negative)
  it('TC-20: Ctrl+Z is ignored when the session is not editable', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const undoMock = { boundary: vi.fn(), undo: vi.fn(), redo: vi.fn() };

    render(<KeysHarness doc={doc} canEdit={false} undo={undoMock as unknown as UndoController} />);

    const event = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true });
    act(() => {
      window.dispatchEvent(event);
    });

    expect(undoMock.undo).not.toHaveBeenCalled();
    expect(undoMock.redo).not.toHaveBeenCalled();
  });

  // TC-21: Ctrl+Z with focus in the share-link input does not call the controller (negative)
  it('TC-21: Ctrl+Z is ignored when an input has focus', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const undoMock = { boundary: vi.fn(), undo: vi.fn(), redo: vi.fn() };

    render(<KeysHarness doc={doc} canEdit={true} undo={undoMock as unknown as UndoController} />);

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    const event = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true });
    act(() => {
      input.dispatchEvent(event);
    });

    expect(undoMock.undo).not.toHaveBeenCalled();
    input.remove();
  });
});
