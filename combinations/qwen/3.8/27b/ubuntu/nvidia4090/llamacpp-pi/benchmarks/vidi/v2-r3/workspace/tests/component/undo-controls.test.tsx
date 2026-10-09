/**
 * Story 8 component tests (TC-18 to TC-21): undo.controls — the toolbar
 * buttons and the keyboard shortcuts. The shortcut tests drive the real
 * `useBoardKeys` hook with a fake UndoController (spies); the button tests
 * render the presentational `UndoButtons` directly.
 */
import type { ReactElement, ReactNode } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import * as Y from 'yjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initDoc } from '../../src/shared/board-model';
import { useBoardKeys } from '../../src/client/board/useBoardKeys';
import { UndoButtons } from '../../src/client/board/UndoButtons';
import type { UndoController } from '../../src/client/board/undo';
import type { SelectionApi } from '../../src/client/board/useSelection';

function fakeController(): UndoController {
  return {
    undo: vi.fn(() => true),
    redo: vi.fn(() => true),
    boundary: vi.fn(),
    canUndo: () => false,
    canRedo: () => false,
    addScope: vi.fn(),
    onChange: () => () => {},
    destroy: vi.fn(),
  } as unknown as UndoController;
}

function fakeSelection(): SelectionApi {
  return {
    editingId: null,
    ids: new Set<string>(),
    click: vi.fn(),
    toggle: vi.fn(),
    setMany: vi.fn(),
    clear: vi.fn(),
    startEdit: vi.fn(),
    endEdit: vi.fn(),
  } as unknown as SelectionApi;
}

/** Hosts the real useBoardKeys hook against a fake controller. */
function renderKeys(canEdit: boolean, controller: UndoController, children?: ReactNode) {
  const doc = new Y.Doc();
  initDoc(doc);
  function Host(): ReactElement {
    useBoardKeys({
      doc,
      selection: fakeSelection(),
      snapshot: [],
      canEdit,
      undo: controller,
      setTool: () => {},
    });
    return <div>{children}</div>;
  }
  const r = render(<Host />);
  return { ...r, controller };
}

afterEach(() => {
  cleanup();
});

describe('undo.controls', () => {
  it('TC-18: empty stacks → Undo and Redo buttons disabled', () => {
    render(<UndoButtons canUndo={false} canRedo={false} onUndo={() => {}} onRedo={() => {}} />);
    expect((screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Redo' }) as HTMLButtonElement).disabled).toBe(true);

    // A non-empty stack re-enables the matching button.
    cleanup();
    render(<UndoButtons canUndo={true} canRedo={false} onUndo={() => {}} onRedo={() => {}} />);
    expect((screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: 'Redo' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('TC-19: Ctrl/Cmd+Z undo; Ctrl/Cmd+Shift+Z and Ctrl+Y redo; preventDefault', () => {
    const { controller } = renderKeys(true, fakeController());
    const undo = controller.undo as ReturnType<typeof vi.fn>;
    const redo = controller.redo as ReturnType<typeof vi.fn>;

    const cases: Array<{ init: Record<string, boolean>; key: string; expect: 'undo' | 'redo' }> = [
      { init: { ctrlKey: true }, key: 'z', expect: 'undo' },
      { init: { metaKey: true }, key: 'z', expect: 'undo' },
      { init: { ctrlKey: true, shiftKey: true }, key: 'z', expect: 'redo' },
      { init: { metaKey: true, shiftKey: true }, key: 'z', expect: 'redo' },
      { init: { ctrlKey: true }, key: 'y', expect: 'redo' },
    ];
    for (const c of cases) {
      undo.mockClear();
      redo.mockClear();
      const notPrevented = fireEvent.keyDown(window, { key: c.key, ...c.init });
      expect(notPrevented).toBe(false); // preventDefault was called
      if (c.expect === 'undo') {
        expect(undo).toHaveBeenCalledTimes(1);
        expect(redo).not.toHaveBeenCalled();
      } else {
        expect(redo).toHaveBeenCalledTimes(1);
        expect(undo).not.toHaveBeenCalled();
      }
    }
  });

  it('TC-20: canEdit false → shortcuts ignored and buttons disabled', () => {
    const { controller } = renderKeys(false, fakeController());
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true, shiftKey: true });
    expect(controller.undo).not.toHaveBeenCalled();
    expect(controller.redo).not.toHaveBeenCalled();

    cleanup();
    render(
      <UndoButtons
        canUndo={true}
        canRedo={true}
        disabled={true}
        onUndo={() => {}}
        onRedo={() => {}}
      />,
    );
    expect((screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Redo' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('TC-21: Ctrl+Z while focus is in an input → controller not called', () => {
    const { controller } = renderKeys(true, fakeController(), <input aria-label="share-link" />);
    const input = screen.getByLabelText('share-link') as HTMLInputElement;
    input.focus();
    fireEvent.keyDown(input, { key: 'z', ctrlKey: true });
    expect(controller.undo).not.toHaveBeenCalled();
    expect(controller.redo).not.toHaveBeenCalled();
  });
});
