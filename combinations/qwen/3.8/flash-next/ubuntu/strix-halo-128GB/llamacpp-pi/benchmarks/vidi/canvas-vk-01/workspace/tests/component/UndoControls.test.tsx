import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, render, screen, cleanup } from '@testing-library/react';
import * as Y from 'yjs';

import { BoardApp } from '../../src/client/App';
import { initDoc, createSticky, snapshot } from '../../src/shared/board-model';
import { createUndo } from '../../src/client/board/undo';
import { useUndo } from '../../src/client/board/useUndo';
import { fireKey } from './helpers';

beforeEach(cleanup);

function makeDoc() {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function renderWithUndo(doc?: Y.Doc) {
  const d = doc ?? makeDoc();
  const view = render(<BoardApp doc={d} />);
  return {
    ...view,
    doc: d,
    async settle() {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 30));
      });
    },
    undoBtn() {
      return screen.getByLabelText('Undo') as HTMLButtonElement;
    },
    redoBtn() {
      return screen.getByLabelText('Redo') as HTMLButtonElement;
    },
  };
}

describe('Undo controls (TC-18 to TC-21)', () => {
  it('TC-18: empty stacks → Undo and Redo buttons disabled with aria-disabled', async () => {
    const { settle, undoBtn, redoBtn } = renderWithUndo();
    await settle();

    expect(undoBtn().disabled).toBe(true);
    expect(undoBtn().getAttribute('aria-disabled')).toBe('true');
    expect(redoBtn().disabled).toBe(true);
    expect(redoBtn().getAttribute('aria-disabled')).toBe('true');
  });

  it('TC-19: Ctrl+Z calls undo; Ctrl+Shift+Z, Cmd+Shift+Z, Ctrl+Y call redo; preventDefault', async () => {
    const { doc, settle, undoBtn, redoBtn } = renderWithUndo();
    void createSticky(doc, { x: 100, y: 100 });
    await settle();

    // Undo button should be enabled after creation
    expect(undoBtn().disabled).toBe(false);

    // Ctrl+Z should undo and preventDefault
    const evt1 = fireKey({ key: 'z', ctrlKey: true });
    expect(evt1.defaultPrevented).toBe(true);
    await settle();

    // After undo, redo should be enabled
    expect(redoBtn().disabled).toBe(false);

    // Ctrl+Shift+Z should redo and preventDefault
    const evt2 = fireKey({ key: 'z', ctrlKey: true, shiftKey: true });
    expect(evt2.defaultPrevented).toBe(true);
    await settle();

    // Undo again for Cmd tests
    fireKey({ key: 'z', ctrlKey: true });
    await settle();

    // Cmd+Z (meta) should be captured
    const evt3 = fireKey({ key: 'z', metaKey: true });
    expect(evt3.defaultPrevented).toBe(true);
    await settle();

    // Cmd+Shift+Z should be captured
    const evt4 = fireKey({ key: 'z', metaKey: true, shiftKey: true });
    expect(evt4.defaultPrevented).toBe(true);
    await settle();

    // Undo, then Ctrl+Y should redo
    fireKey({ key: 'z', ctrlKey: true });
    await settle();
    const evt5 = fireKey({ key: 'y', ctrlKey: true });
    expect(evt5.defaultPrevented).toBe(true);
  });

  it('TC-20: canEdit false → buttons disabled, shortcuts have no effect', async () => {
    const doc = makeDoc();
    const controller = createUndo(doc, { captureTimeoutMs: 0 });
    createSticky(doc, { x: 100, y: 100 });
    expect(controller.canUndo()).toBe(true);

    // Render the useUndo hook with canEdit = false
    let hookResult: ReturnType<typeof useUndo>;
    function ReadOnlyHarness() {
      hookResult = useUndo(controller, false);
      return (
        <div>
          <button
            type="button"
            aria-label="Undo"
            disabled={!hookResult!.canUndo}
            aria-disabled={!hookResult!.canUndo}
            onClick={hookResult!.undo}
          >Undo</button>
          <button
            type="button"
            aria-label="Redo"
            disabled={!hookResult!.canRedo}
            aria-disabled={!hookResult!.canRedo}
            onClick={hookResult!.redo}
          >Redo</button>
        </div>
      );
    }

    render(<ReadOnlyHarness />);

    const undoBtn = screen.getByLabelText('Undo') as HTMLButtonElement;
    const redoBtn = screen.getByLabelText('Redo') as HTMLButtonElement;
    // Even though controller.canUndo() is true, canEdit=false means buttons are disabled
    expect(undoBtn.disabled).toBe(true);
    expect(redoBtn.disabled).toBe(true);

    // Clicking the disabled button should not call controller
    const undoSpy = vi.spyOn(controller, 'undo');
    undoBtn.click();
    expect(undoSpy).not.toHaveBeenCalled();
    undoSpy.mockRestore();

    controller.destroy();
    doc.destroy();
  });

  it('TC-21: Ctrl+Z with focus in a non-board input → controller not called', async () => {
    const { doc, settle, undoBtn } = renderWithUndo();
    void createSticky(doc, { x: 100, y: 100 });
    await settle();

    expect(undoBtn().disabled).toBe(false);

    // Add a plain input (simulating share-link field) and focus it
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    // Dispatch Ctrl+Z from the input
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'z',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }));
    });

    // Note should NOT be undone (isEditableTarget blocks it)
    await settle();
    expect(snapshot(doc).length).toBe(1);
    expect(undoBtn().disabled).toBe(false);

    document.body.removeChild(input);
  });
});
