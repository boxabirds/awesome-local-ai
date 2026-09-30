import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { type ReactElement, type ReactNode, useState, useEffect } from 'react';
import * as Y from 'yjs';
import { initDoc, createSticky } from '@shared/board-model';
import { UndoButtons } from '@client/board/UndoButtons';
import { useUndo } from '@client/board/useUndo';
import { useBoardKeys } from '@client/board/useBoardKeys';
import { useSelection } from '@client/board/useSelection';
import { createUndo, type UndoController } from '@client/board/undo';
import { snapshot } from '@shared/board-model';

function TestWrapper({ children }: { children: ReactNode }): ReactElement {
  return <div data-board-viewport="true" style={{ position: 'fixed', inset: 0 }}>{children}</div>;
}

// ============================================================
// TC-18: empty stacks → Undo and Redo buttons disabled
// ============================================================
describe('TC-18: empty history buttons disabled', () => {
  it('Undo and Redo buttons are disabled with empty stacks', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const ctrl = createUndo(doc);

    function TestComp(): ReactElement {
      const undoState = useUndo(ctrl, true);
      return <TestWrapper><UndoButtons {...undoState} /></TestWrapper>;
    }

    const { getByLabelText } = render(<TestComp />);
    const undoBtn = getByLabelText('Undo') as HTMLButtonElement;
    const redoBtn = getByLabelText('Redo') as HTMLButtonElement;

    expect(undoBtn.disabled).toBe(true);
    expect(redoBtn.disabled).toBe(true);
    expect(undoBtn.getAttribute('aria-disabled')).toBe('true');
    expect(redoBtn.getAttribute('aria-disabled')).toBe('true');

    ctrl.destroy();
    doc.destroy();
  });
});

// ============================================================
// TC-19: shortcuts call controller with preventDefault
// ============================================================
describe('TC-19: keyboard shortcuts', () => {
  let doc: Y.Doc;
  let ctrl: UndoController;
  let undoSpy: ReturnType<typeof vi.spyOn>;
  let redoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
    ctrl = createUndo(doc);

    // Make a change so canUndo is true
    createSticky(doc, { x: 100, y: 100 });
    ctrl.boundary();

    undoSpy = vi.spyOn(ctrl, 'undo');
    redoSpy = vi.spyOn(ctrl, 'redo');
  });

  afterEach(() => {
    ctrl.destroy();
    doc.destroy();
  });

  function TestComp(): ReactElement {
    const [snap, setSnap] = useState(() => snapshot(doc));
    useEffect(() => {
      const objects = doc.getMap<Y.Map<unknown>>('objects');
      const observer = () => setSnap(snapshot(doc));
      objects.observeDeep(observer);
      return () => objects.unobserveDeep(observer);
    }, []);
    const selection = useSelection(snap);

    useBoardKeys({
      doc,
      selection,
      snapshot: snap,
      canEdit: true,
      undoController: ctrl,
    });

    return <TestWrapper><div data-testid="board-content" /></TestWrapper>;
  }

  it('Ctrl+Z calls undo with preventDefault', () => {
    render(<TestComp />);
    const event = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true });
    const pd = vi.spyOn(event, 'preventDefault');
    act(() => { window.dispatchEvent(event); });
    expect(pd).toHaveBeenCalled();
    expect(undoSpy).toHaveBeenCalled();
  });

  it('Cmd+Z calls undo with preventDefault', () => {
    render(<TestComp />);
    const event = new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true });
    const pd = vi.spyOn(event, 'preventDefault');
    act(() => { window.dispatchEvent(event); });
    expect(pd).toHaveBeenCalled();
    expect(undoSpy).toHaveBeenCalled();
  });

  it('Ctrl+Shift+Z calls redo with preventDefault', () => {
    render(<TestComp />);
    const event = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true, bubbles: true });
    const pd = vi.spyOn(event, 'preventDefault');
    act(() => { window.dispatchEvent(event); });
    expect(pd).toHaveBeenCalled();
    expect(redoSpy).toHaveBeenCalled();
  });

  it('Cmd+Shift+Z calls redo with preventDefault', () => {
    render(<TestComp />);
    const event = new KeyboardEvent('keydown', { key: 'z', metaKey: true, shiftKey: true, bubbles: true });
    const pd = vi.spyOn(event, 'preventDefault');
    act(() => { window.dispatchEvent(event); });
    expect(pd).toHaveBeenCalled();
    expect(redoSpy).toHaveBeenCalled();
  });

  it('Ctrl+Y calls redo with preventDefault', () => {
    render(<TestComp />);
    const event = new KeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true });
    const pd = vi.spyOn(event, 'preventDefault');
    act(() => { window.dispatchEvent(event); });
    expect(pd).toHaveBeenCalled();
    expect(redoSpy).toHaveBeenCalled();
  });
});

// ============================================================
// TC-20: canEdit false → shortcuts ignored, buttons disabled
// ============================================================
describe('TC-20: load failed disables undo/redo', () => {
  it('shortcuts ignored and buttons disabled when canEdit is false', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const ctrl = createUndo(doc);

    // Make a change so stack is non-empty
    createSticky(doc, { x: 100, y: 100 });
    ctrl.boundary();

    const undoSpy = vi.spyOn(ctrl, 'undo');

    function TestComp(): ReactElement {
      const [snap, setSnap] = useState(() => snapshot(doc));
      useEffect(() => {
        const objects = doc.getMap<Y.Map<unknown>>('objects');
        const observer = () => setSnap(snapshot(doc));
        objects.observeDeep(observer);
        return () => objects.unobserveDeep(observer);
      }, []);
      const selection = useSelection(snap);
      const undoState = useUndo(ctrl, false); // canEdit = false

      useBoardKeys({
        doc,
        selection,
        snapshot: snap,
        canEdit: false,
        undoController: ctrl,
      });

      return (
        <TestWrapper>
          <UndoButtons {...undoState} />
          <div data-testid="board-content" />
        </TestWrapper>
      );
    }

    const { getByLabelText } = render(<TestComp />);
    const undoBtn = getByLabelText('Undo') as HTMLButtonElement;
    const redoBtn = getByLabelText('Redo') as HTMLButtonElement;

    expect(undoBtn.disabled).toBe(true);
    expect(redoBtn.disabled).toBe(true);

    // Ctrl+Z should not call undo
    const event = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true });
    act(() => { window.dispatchEvent(event); });
    expect(undoSpy).not.toHaveBeenCalled();

    ctrl.destroy();
    doc.destroy();
  });
});

// ============================================================
// TC-21: Ctrl+Z with focus in non-board input → controller not called
// ============================================================
describe('TC-21: shortcut in non-board input is ignored', () => {
  it('Ctrl+Z with focus in an input outside the board does not call controller', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const ctrl = createUndo(doc);

    // Make a change so stack is non-empty
    createSticky(doc, { x: 100, y: 100 });
    ctrl.boundary();

    const undoSpy = vi.spyOn(ctrl, 'undo');

    function TestComp(): ReactElement {
      const [snap, setSnap] = useState(() => snapshot(doc));
      useEffect(() => {
        const objects = doc.getMap<Y.Map<unknown>>('objects');
        const observer = () => setSnap(snapshot(doc));
        objects.observeDeep(observer);
        return () => objects.unobserveDeep(observer);
      }, []);
      const selection = useSelection(snap);

      useBoardKeys({
        doc,
        selection,
        snapshot: snap,
        canEdit: true,
        undoController: ctrl,
      });

      return (
        <div style={{ position: 'fixed', inset: 0 }}>
          <div data-board-viewport="true" data-testid="board-content" />
          {/* Share link input NOT inside board viewport */}
          <input data-testid="share-link-input" aria-label="Share link" />
        </div>
      );
    }

    const { getByTestId } = render(<TestComp />);
    const input = getByTestId('share-link-input');
    (input as HTMLInputElement).focus();

    // Dispatch Ctrl+Z while input is focused
    const event = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true });
    act(() => { window.dispatchEvent(event); });

    // Controller should NOT have been called (focus is in a non-board input)
    expect(undoSpy).not.toHaveBeenCalled();

    ctrl.destroy();
    doc.destroy();
  });
});
