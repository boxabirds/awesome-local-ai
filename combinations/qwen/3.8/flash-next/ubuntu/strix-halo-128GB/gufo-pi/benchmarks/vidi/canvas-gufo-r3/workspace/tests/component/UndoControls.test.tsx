import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import * as Y from 'yjs';
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react';
import { createUndo, UndoController } from '@client/board/undo';
import { useUndo } from '@client/board/useUndo';
import { UndoButtons } from '@client/board/UndoButtons';
import { useBoardKeys } from '@client/board/useBoardKeys';
import { useSelection } from '@client/board/useSelection';
import {
  LOCAL_ORIGIN,
  createSticky,
  moveObjects,
  snapshot,
} from '@shared/board-model';
import { STICKY_SIZE_WORLD } from '@shared/config';

const HALF = STICKY_SIZE_WORLD / 2;

// --- Test component that wires useUndo + UndoButtons + useBoardKeys ---
function UndoTestApp({
  controller,
  canEdit,
}: {
  controller: UndoController | null;
  canEdit: boolean;
}) {
  const doc = new Y.Doc();
  const snap = snapshot(doc);
  const selection = useSelection(snap);

  useBoardKeys({
    doc,
    selection,
    snapshot: snap,
    canEdit,
    undoController: controller,
  });

  const undoState = useUndo(controller, canEdit);

  return (
    <div>
      <UndoButtons {...undoState} />
    </div>
  );
}

describe('TC-18: Undo and Redo buttons disabled when stack is empty', () => {
  afterEach(cleanup);

  it('both buttons are disabled with empty stacks', () => {
    const doc = new Y.Doc();
    const ctrl = createUndo(doc);

    render(<UndoTestApp controller={ctrl} canEdit={true} />);

    const undoBtn = screen.getByLabelText('Undo');
    const redoBtn = screen.getByLabelText('Redo');

    expect(undoBtn).toBeDisabled();
    expect(redoBtn).toBeDisabled();

    ctrl.destroy();
    doc.destroy();
  });

  it('undo button enabled after local action, redo still disabled', () => {
    const doc = new Y.Doc();
    const ctrl = createUndo(doc);

    doc.transact(() => {
      createSticky(doc, { x: HALF, y: HALF });
    }, LOCAL_ORIGIN);
    ctrl.boundary();

    render(<UndoTestApp controller={ctrl} canEdit={true} />);

    const undoBtn = screen.getByLabelText('Undo');
    const redoBtn = screen.getByLabelText('Redo');

    expect(undoBtn).not.toBeDisabled();
    expect(redoBtn).toBeDisabled();

    ctrl.destroy();
    doc.destroy();
  });
});

describe('TC-19: keyboard shortcuts call controller with preventDefault', () => {
  afterEach(cleanup);

  it('Ctrl+Z calls undo', () => {
    const doc = new Y.Doc();
    const ctrl = createUndo(doc);
    const undoSpy = vi.spyOn(ctrl, 'undo');

    // Add a step
    doc.transact(() => {
      createSticky(doc, { x: HALF, y: HALF });
    }, LOCAL_ORIGIN);
    ctrl.boundary();

    render(<UndoTestApp controller={ctrl} canEdit={true} />);

    const event = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true });
    const preventSpy = vi.spyOn(event, 'preventDefault');
    window.dispatchEvent(event);

    expect(preventSpy).toHaveBeenCalled();
    expect(undoSpy).toHaveBeenCalled();

    ctrl.destroy();
    doc.destroy();
  });

  it('Cmd+Z calls undo', () => {
    const doc = new Y.Doc();
    const ctrl = createUndo(doc);
    const undoSpy = vi.spyOn(ctrl, 'undo');

    doc.transact(() => {
      createSticky(doc, { x: HALF, y: HALF });
    }, LOCAL_ORIGIN);
    ctrl.boundary();

    render(<UndoTestApp controller={ctrl} canEdit={true} />);

    const event = new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true });
    const preventSpy = vi.spyOn(event, 'preventDefault');
    window.dispatchEvent(event);

    expect(preventSpy).toHaveBeenCalled();
    expect(undoSpy).toHaveBeenCalled();

    ctrl.destroy();
    doc.destroy();
  });

  it('Ctrl+Shift+Z calls redo', () => {
    const doc = new Y.Doc();
    const ctrl = createUndo(doc);
    const redoSpy = vi.spyOn(ctrl, 'redo');

    doc.transact(() => {
      createSticky(doc, { x: HALF, y: HALF });
    }, LOCAL_ORIGIN);
    ctrl.boundary();
    ctrl.undo(); // populate redo stack

    render(<UndoTestApp controller={ctrl} canEdit={true} />);

    const event = new KeyboardEvent('keydown', { key: 'Z', ctrlKey: true, shiftKey: true, bubbles: true });
    const preventSpy = vi.spyOn(event, 'preventDefault');
    window.dispatchEvent(event);

    expect(preventSpy).toHaveBeenCalled();
    expect(redoSpy).toHaveBeenCalled();

    ctrl.destroy();
    doc.destroy();
  });

  it('Cmd+Shift+Z calls redo', () => {
    const doc = new Y.Doc();
    const ctrl = createUndo(doc);
    const redoSpy = vi.spyOn(ctrl, 'redo');

    doc.transact(() => {
      createSticky(doc, { x: HALF, y: HALF });
    }, LOCAL_ORIGIN);
    ctrl.boundary();
    ctrl.undo();

    render(<UndoTestApp controller={ctrl} canEdit={true} />);

    const event = new KeyboardEvent('keydown', { key: 'Z', metaKey: true, shiftKey: true, bubbles: true });
    const preventSpy = vi.spyOn(event, 'preventDefault');
    window.dispatchEvent(event);

    expect(preventSpy).toHaveBeenCalled();
    expect(redoSpy).toHaveBeenCalled();

    ctrl.destroy();
    doc.destroy();
  });

  it('Ctrl+Y calls redo', () => {
    const doc = new Y.Doc();
    const ctrl = createUndo(doc);
    const redoSpy = vi.spyOn(ctrl, 'redo');

    doc.transact(() => {
      createSticky(doc, { x: HALF, y: HALF });
    }, LOCAL_ORIGIN);
    ctrl.boundary();
    ctrl.undo();

    render(<UndoTestApp controller={ctrl} canEdit={true} />);

    const event = new KeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true });
    const preventSpy = vi.spyOn(event, 'preventDefault');
    window.dispatchEvent(event);

    expect(preventSpy).toHaveBeenCalled();
    expect(redoSpy).toHaveBeenCalled();

    ctrl.destroy();
    doc.destroy();
  });
});

describe('TC-20: shortcuts ignored and buttons disabled when canEdit is false', () => {
  afterEach(cleanup);

  it('Ctrl+Z does not call undo when canEdit is false', () => {
    const doc = new Y.Doc();
    const ctrl = createUndo(doc);
    const undoSpy = vi.spyOn(ctrl, 'undo');

    doc.transact(() => {
      createSticky(doc, { x: HALF, y: HALF });
    }, LOCAL_ORIGIN);
    ctrl.boundary();

    render(<UndoTestApp controller={ctrl} canEdit={false} />);

    const event = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true });
    const preventSpy = vi.spyOn(event, 'preventDefault');
    window.dispatchEvent(event);

    expect(preventSpy).not.toHaveBeenCalled();
    expect(undoSpy).not.toHaveBeenCalled();

    ctrl.destroy();
    doc.destroy();
  });

  it('Undo and Redo buttons are disabled when canEdit is false', () => {
    const doc = new Y.Doc();
    const ctrl = createUndo(doc);

    doc.transact(() => {
      createSticky(doc, { x: HALF, y: HALF });
    }, LOCAL_ORIGIN);
    ctrl.boundary();

    render(<UndoTestApp controller={ctrl} canEdit={false} />);

    const undoBtn = screen.getByLabelText('Undo');
    const redoBtn = screen.getByLabelText('Redo');

    expect(undoBtn).toBeDisabled();
    expect(redoBtn).toBeDisabled();

    ctrl.destroy();
    doc.destroy();
  });
});

describe('TC-21: Ctrl+Z in non-board input does not call controller', () => {
  afterEach(cleanup);

  it('Ctrl+Z with focus in a text input is not intercepted', () => {
    const doc = new Y.Doc();
    const ctrl = createUndo(doc);
    const undoSpy = vi.spyOn(ctrl, 'undo');

    doc.transact(() => {
      createSticky(doc, { x: HALF, y: HALF });
    }, LOCAL_ORIGIN);
    ctrl.boundary();

    function InputTestApp() {
      const selection = useSelection([] as any);
      useBoardKeys({ doc, selection, snapshot: [], canEdit: true, undoController: ctrl });
      return (
        <div>
          <input data-testid="some-input" />
        </div>
      );
    }

    render(<InputTestApp />);

    const input = screen.getByTestId('some-input');
    input.focus();

    const event = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true });
    Object.defineProperty(event, 'target', { value: input });
    input.dispatchEvent(event);

    expect(undoSpy).not.toHaveBeenCalled();

    ctrl.destroy();
    doc.destroy();
  });
});
