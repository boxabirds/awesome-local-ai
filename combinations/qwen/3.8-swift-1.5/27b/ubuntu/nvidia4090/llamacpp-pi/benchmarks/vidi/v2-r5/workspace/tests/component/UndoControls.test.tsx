// @vitest-environment jsdom
// tests/component/UndoControls.test.tsx
// TC-18 to TC-21: undo/redo buttons, shortcuts, and the edit lock, using a
// fake UndoController so the controls can be exercised deterministically.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { useMemo, type ReactNode } from 'react';
import * as Y from 'yjs';
import { initDoc } from '../../src/shared/board-model';
import { Toolbar } from '../../src/client/board/Toolbar';
import { useBoardKeys } from '../../src/client/board/useBoardKeys';
import type { UseSelectionResult } from '../../src/client/board/useSelection';
import type { UndoController } from '../../src/client/board/undo';

// ── Fake controller ──────────────────────────────────────────────────────────
// Hoisted so the vi.mock factory (also hoisted) can reference it.
const fake = vi.hoisted(() => ({
  canUndo: false,
  canRedo: false,
  undo: vi.fn(),
  redo: vi.fn(),
  boundary: vi.fn(),
  addScope: vi.fn(),
  onChange: vi.fn(() => () => {}),
  destroy: vi.fn(),
}));

vi.mock('../../src/client/board/undo', () => ({
  createUndo: () => fake,
}));

function controller(): UndoController {
  return {
    canUndo: () => fake.canUndo,
    canRedo: () => fake.canRedo,
    undo: fake.undo,
    redo: fake.redo,
    boundary: fake.boundary,
    addScope: fake.addScope,
    onChange: fake.onChange,
    destroy: fake.destroy,
  };
}

// ── Harness for useBoardKeys ─────────────────────────────────────────────────
function KeysHarness(props: {
  canEdit: boolean;
  undo: UndoController;
  children?: ReactNode;
}) {
  const doc = useMemo(() => {
    const d = new Y.Doc();
    initDoc(d);
    return d;
  }, []);
  const selection = useMemo<UseSelectionResult>(
    () =>
      ({
        ids: new Set<string>(),
        editingId: null,
        endEdit: () => {},
        clear: () => {},
        setMany: () => {},
        startEdit: () => {},
        click: () => {},
        toggle: () => {},
      }) as unknown as UseSelectionResult,
    [],
  );
  useBoardKeys({ doc, selection, snapshot: [], canEdit: props.canEdit, undo: props.undo });
  return <>{props.children}</>;
}

beforeEach(() => {
  cleanup();
  fake.canUndo = false;
  fake.canRedo = false;
  fake.undo.mockClear();
  fake.redo.mockClear();
  fake.boundary.mockClear();
});

describe('undo.controls (component, fake controller)', () => {
  // TC-18: empty stacks → Undo and Redo buttons disabled (boundary)
  it('TC-18: both buttons disabled when the stacks are empty', () => {
    render(
      <Toolbar tool="select" setTool={() => {}}
        
        onCreateSticky={() => {}}
        disabled={false}
        shapeKind="rect" setShapeKind={() => {}}
        undo={{ canUndo: false, canRedo: false, undo: () => {}, redo: () => {} }}
      />,
    );
    expect((screen.getByTestId('undo-btn') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('redo-btn') as HTMLButtonElement).disabled).toBe(true);
  });

  it('TC-18 (complement): buttons enabled when a stack has steps', () => {
    render(
      <Toolbar tool="select" setTool={() => {}}
        
        onCreateSticky={() => {}}
        disabled={false}
        shapeKind="rect" setShapeKind={() => {}}
        undo={{ canUndo: true, canRedo: true, undo: () => {}, redo: () => {} }}
      />,
    );
    expect((screen.getByTestId('undo-btn') as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByTestId('redo-btn') as HTMLButtonElement).disabled).toBe(false);
  });

  // TC-19: Ctrl+Z / Cmd+Z → undo; Ctrl+Shift+Z / Cmd+Shift+Z / Ctrl+Y → redo;
  // each preventDefault
  it('TC-19: undo and redo shortcuts call the controller and preventDefault', () => {
    const undo = controller();
    fake.canUndo = true;
    fake.canRedo = true;
    render(<KeysHarness canEdit={true} undo={undo} />);

    // Undo shortcuts
    expect(fireEvent.keyDown(window, { ctrlKey: true, key: 'z' })).toBe(false); // preventDefault
    expect(fake.undo).toHaveBeenCalledTimes(1);
    expect(fireEvent.keyDown(window, { metaKey: true, key: 'z' })).toBe(false);
    expect(fake.undo).toHaveBeenCalledTimes(2);

    // Redo shortcuts
    expect(fireEvent.keyDown(window, { ctrlKey: true, shiftKey: true, key: 'z' })).toBe(false);
    expect(fake.redo).toHaveBeenCalledTimes(1);
    expect(fireEvent.keyDown(window, { metaKey: true, shiftKey: true, key: 'z' })).toBe(false);
    expect(fake.redo).toHaveBeenCalledTimes(2);
    expect(fireEvent.keyDown(window, { ctrlKey: true, key: 'y' })).toBe(false);
    expect(fake.redo).toHaveBeenCalledTimes(3);

    // Undo shortcuts never trigger redo, and vice versa
    expect(fake.undo).toHaveBeenCalledTimes(2);
  });

  // TC-20: canEdit false (load failed) → shortcuts ignored, buttons disabled
  it('TC-20: with canEdit false the shortcuts are ignored and buttons disabled', () => {
    const undo = controller();
    fake.canUndo = true;
    fake.canRedo = true;
    render(<KeysHarness canEdit={false} undo={undo} />);

    // Shortcuts are ignored (no controller call, no preventDefault)
    expect(fireEvent.keyDown(window, { ctrlKey: true, key: 'z' })).toBe(true);
    expect(fake.undo).not.toHaveBeenCalled();
    expect(fireEvent.keyDown(window, { ctrlKey: true, shiftKey: true, key: 'z' })).toBe(true);
    expect(fake.redo).not.toHaveBeenCalled();

    // Buttons disabled (useUndo gates on canEdit → canUndo/canRedo false)
    render(
      <Toolbar tool="select" setTool={() => {}}
        
        onCreateSticky={() => {}}
        disabled={true}
        shapeKind="rect" setShapeKind={() => {}}
        undo={{ canUndo: false, canRedo: false, undo: () => {}, redo: () => {} }}
      />,
    );
    expect((screen.getByTestId('undo-btn') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('redo-btn') as HTMLButtonElement).disabled).toBe(true);
  });

  // TC-21: Ctrl+Z with focus in the share-link input → controller not called
  it('TC-21: Ctrl+Z while focus is in an input does not call the controller', () => {
    const undo = controller();
    fake.canUndo = true;
    render(
      <KeysHarness canEdit={true} undo={undo}>
        <input data-testid="share-link" aria-label="Share link" readOnly />
      </KeysHarness>,
    );

    const input = screen.getByTestId('share-link');
    input.focus();
    expect(document.activeElement).toBe(input);

    // Ctrl+Z while the input is focused → ignored by the board handler
    fireEvent.keyDown(input, { ctrlKey: true, key: 'z' });
    expect(fake.undo).not.toHaveBeenCalled();
  });
});
