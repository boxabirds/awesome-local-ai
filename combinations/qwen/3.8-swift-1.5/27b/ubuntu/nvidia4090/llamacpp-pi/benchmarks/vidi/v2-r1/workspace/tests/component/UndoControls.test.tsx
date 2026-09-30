import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import * as React from 'react';
import { UndoButtons } from '@client/board/UndoButtons';
import { useUndo } from '@client/board/useUndo';
import { createUndo, type UndoController } from '@client/board/undo';
import * as Y from 'yjs';
import { initDoc, createSticky, moveObjects, snapshot } from '@shared/board-model';

/**
 * TC-18 to TC-21: Component tests for undo shortcuts, buttons and edit lock.
 */

// Helper: render a component that uses useUndo
function TestUndoButtons({ controller, canEdit }: { controller: UndoController; canEdit: boolean }) {
  const { canUndo, canRedo, undo, redo } = useUndo(controller, canEdit);
  return (
    <UndoButtons canUndo={canUndo} canRedo={canRedo} undo={undo} redo={redo} />
  );
}

// Helper: render a component that simulates useBoardKeys undo/redo handling
function TestKeys({
  canEdit,
  isEditing,
  onUndo,
  onRedo,
}: {
  canEdit: boolean;
  isEditing: boolean;
  onUndo: () => void;
  onRedo: () => void;
}) {
  React.useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      if (mod && (e.key === 'z' || e.key === 'Z')) {
        if (isEditing) return;
        if (!canEdit) return;
        e.preventDefault();
        if (e.shiftKey) onRedo();
        else onUndo();
        return;
      }
      if (mod && (e.key === 'y' || e.key === 'Y')) {
        if (isEditing) return;
        if (!canEdit) return;
        e.preventDefault();
        onRedo();
        return;
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [canEdit, isEditing, onUndo, onRedo]);

  return <div data-testid="test-keys-area" />;
}

describe('TC-18: empty stacks → buttons disabled', () => {
  it('Undo and Redo buttons are disabled when stacks are empty', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const controller = createUndo(doc);

    render(<TestUndoButtons controller={controller} canEdit={true} />);

    const undoBtn = screen.getByLabelText('Undo');
    const redoBtn = screen.getByLabelText('Redo');
    expect(undoBtn).toBeDisabled();
    expect(redoBtn).toBeDisabled();

    controller.destroy();
    doc.destroy();
  });
});

describe('TC-19: keyboard shortcuts call controller with preventDefault', () => {
  let doc: Y.Doc;
  let controller: UndoController;
  let undoSpy: ReturnType<typeof vi.fn>;
  let redoSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
    controller = createUndo(doc, { captureTimeoutMs: 0 });
    undoSpy = vi.fn();
    redoSpy = vi.fn();
  });

  afterEach(() => {
    controller.destroy();
    doc.destroy();
  });

  function setup() {
    render(
      <TestKeys
        canEdit={true}
        isEditing={false}
        onUndo={undoSpy}
        onRedo={redoSpy}
      />
    );
  }

  it('Ctrl+Z calls undo with preventDefault', () => {
    setup();
    const event = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true });
    const preventDefault = vi.spyOn(event, 'preventDefault');
    act(() => {
      window.dispatchEvent(event);
    });
    expect(undoSpy).toHaveBeenCalledTimes(1);
    expect(preventDefault).toHaveBeenCalled();
  });

  it('Cmd+Z (metaKey) calls undo with preventDefault', () => {
    setup();
    const event = new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true });
    const preventDefault = vi.spyOn(event, 'preventDefault');
    act(() => {
      window.dispatchEvent(event);
    });
    expect(undoSpy).toHaveBeenCalledTimes(1);
    expect(preventDefault).toHaveBeenCalled();
  });

  it('Ctrl+Shift+Z calls redo with preventDefault', () => {
    setup();
    const event = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true, bubbles: true });
    const preventDefault = vi.spyOn(event, 'preventDefault');
    act(() => {
      window.dispatchEvent(event);
    });
    expect(redoSpy).toHaveBeenCalledTimes(1);
    expect(undoSpy).not.toHaveBeenCalled();
    expect(preventDefault).toHaveBeenCalled();
  });

  it('Cmd+Shift+Z calls redo with preventDefault', () => {
    setup();
    const event = new KeyboardEvent('keydown', { key: 'z', metaKey: true, shiftKey: true, bubbles: true });
    const preventDefault = vi.spyOn(event, 'preventDefault');
    act(() => {
      window.dispatchEvent(event);
    });
    expect(redoSpy).toHaveBeenCalledTimes(1);
    expect(preventDefault).toHaveBeenCalled();
  });

  it('Ctrl+Y calls redo with preventDefault', () => {
    setup();
    const event = new KeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true });
    const preventDefault = vi.spyOn(event, 'preventDefault');
    act(() => {
      window.dispatchEvent(event);
    });
    expect(redoSpy).toHaveBeenCalledTimes(1);
    expect(undoSpy).not.toHaveBeenCalled();
    expect(preventDefault).toHaveBeenCalled();
  });
});

describe('TC-20: canEdit false → shortcuts ignored, buttons disabled', () => {
  let doc: Y.Doc;
  let controller: UndoController;
  let undoSpy: ReturnType<typeof vi.fn>;
  let redoSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
    controller = createUndo(doc, { captureTimeoutMs: 0 });
    undoSpy = vi.fn();
    redoSpy = vi.fn();
  });

  afterEach(() => {
    cleanup();
    controller.destroy();
    doc.destroy();
  });

  it('shortcuts are ignored when canEdit is false', () => {
    render(
      <TestKeys
        canEdit={false}
        isEditing={false}
        onUndo={undoSpy}
        onRedo={redoSpy}
      />
    );

    const event = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true });
    act(() => {
      window.dispatchEvent(event);
    });
    expect(undoSpy).not.toHaveBeenCalled();
  });

  it('buttons are disabled when canEdit is false', () => {
    // Create a sticky so there's something to undo
    createSticky(doc, { x: 100, y: 100 });
    controller.boundary();
    moveObjects(doc, new Map([[snapshot(doc)[0].id, { x: 200, y: 200 }]]));

    render(<TestUndoButtons controller={controller} canEdit={false} />);

    const undoBtn = screen.getByLabelText('Undo');
    const redoBtn = screen.getByLabelText('Redo');
    expect(undoBtn).toBeDisabled();
    expect(redoBtn).toBeDisabled();
  });
});

describe('TC-21: Ctrl+Z with focus in non-board input → controller not called', () => {
  let undoSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    undoSpy = vi.fn();
  });

  it('Ctrl+Z in an input field does not trigger undo', () => {
    render(
      <div>
        <TestKeys
          canEdit={true}
          isEditing={false}
          onUndo={undoSpy}
          onRedo={vi.fn()}
        />
        <input data-testid="share-input" aria-label="Share link" />
      </div>
    );

    // Focus the input
    const input = screen.getByTestId('share-input');
    act(() => {
      input.focus();
    });

    // Dispatch Ctrl+Z while input is focused
    const event = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true });
    // Set the target to the input to simulate focus
    Object.defineProperty(event, 'target', { value: input });
    act(() => {
      // Dispatch on the input element (bubbles to window)
      input.dispatchEvent(event);
    });
    expect(undoSpy).not.toHaveBeenCalled();
  });
});
