/**
 * Component tests for toolbars (sticky.toolbar).
 * TC-27 to TC-29.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as Y from 'yjs';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  initDoc,
  createSticky,
  snapshot,
  deleteObject,
  setStickyColor,
} from '../../src/shared/board-model';
import { Toolbar } from '../../src/client/board/Toolbar';
import { NoteToolbar } from '../../src/client/objects/NoteToolbar';

describe('sticky.toolbar', () => {
  let doc: Y.Doc;
  let noteId: string;

  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
    noteId = createSticky(doc, { x: 100, y: 100 });
  });

  // TC-27: Pink swatch → model colour pink, selection kept
  it('TC-27: clicking Pink swatch changes colour to pink', () => {
    const onColor = vi.fn((c: string) => {
      setStickyColor(doc, noteId, c);
    });

    render(<NoteToolbar color="yellow" onColor={onColor} onDelete={vi.fn()} />);

    const pinkSwatch = screen.getByTestId('swatch-pink');
    fireEvent.click(pinkSwatch);

    expect(onColor).toHaveBeenCalledWith('pink');
    const snap = snapshot(doc)[0];
    expect(snap.color).toBe('pink');
    // Text and position unchanged
    expect(snap.text).toBe('');
  });

  // TC-28: Sticky note button → one note centred on viewport centre, Editing
  it('TC-28: Sticky note button creates a note', () => {
    const onCreateSticky = vi.fn(() => {
      const id = createSticky(doc, { x: 400, y: 300 });
      // In real app, this would also call startEdit(id)
    });

    render(
      <Toolbar
        tool="select"
        setTool={vi.fn()}
        canEdit
        onCreateSticky={onCreateSticky}
        undo={{ canUndo: false, canRedo: false, undo: vi.fn(), redo: vi.fn() }}
        shapeKind="rect"
        setShapeKind={vi.fn()}
      />,
    );

    const btn = screen.getByTestId('sticky-btn');
    fireEvent.click(btn);

    expect(onCreateSticky).toHaveBeenCalled();
    // A new note was created
    expect(snapshot(doc)).toHaveLength(2);
  });

  // Story 10: Shape button activates the shape tool and opens the kind menu.
  it('Shape button activates the shape tool and opens the kind menu', () => {
    const setTool = vi.fn();
    render(
      <Toolbar
        tool="select"
        setTool={setTool}
        canEdit
        onCreateSticky={vi.fn()}
        undo={{ canUndo: false, canRedo: false, undo: vi.fn(), redo: vi.fn() }}
        shapeKind="rect"
        setShapeKind={vi.fn()}
      />,
    );

    const shapeBtn = screen.getByTestId('shape-btn');
    expect(shapeBtn).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(shapeBtn);
    expect(setTool).toHaveBeenCalledWith('shape');
    // Menu is open.
    expect(screen.getByTestId('shape-menu')).toBeDefined();
    expect(screen.getByTestId('shape-kind-rect')).toBeDefined();
    expect(screen.getByTestId('shape-kind-ellipse')).toBeDefined();
    expect(screen.getByTestId('shape-kind-diamond')).toBeDefined();
  });

  // Story 10: picking a kind calls setShapeKind and closes the menu.
  it('picking a shape kind calls setShapeKind and closes the menu', () => {
    const setShapeKind = vi.fn();
    render(
      <Toolbar
        tool="shape"
        setTool={vi.fn()}
        canEdit
        onCreateSticky={vi.fn()}
        undo={{ canUndo: false, canRedo: false, undo: vi.fn(), redo: vi.fn() }}
        shapeKind="rect"
        setShapeKind={setShapeKind}
      />,
    );

    // Open the menu.
    fireEvent.click(screen.getByTestId('shape-btn'));
    // The current kind is marked pressed.
    expect(screen.getByTestId('shape-kind-rect')).toHaveAttribute('aria-pressed', 'true');

    // Pick ellipse.
    fireEvent.click(screen.getByTestId('shape-kind-ellipse'));
    expect(setShapeKind).toHaveBeenCalledWith('ellipse');
    // Menu closed.
    expect(screen.queryByTestId('shape-menu')).toBeNull();
  });

  // Story 10: Connector button activates the connector tool.
  it('Connector button activates the connector tool', () => {
    const setTool = vi.fn();
    render(
      <Toolbar
        tool="select"
        setTool={setTool}
        canEdit
        onCreateSticky={vi.fn()}
        undo={{ canUndo: false, canRedo: false, undo: vi.fn(), redo: vi.fn() }}
        shapeKind="rect"
        setShapeKind={vi.fn()}
      />,
    );

    const connectorBtn = screen.getByTestId('connector-btn');
    expect(connectorBtn).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(connectorBtn);
    expect(setTool).toHaveBeenCalledWith('connector');
  });

  // Story 10: shape and connector tools are disabled when not editable.
  it('shape and connector buttons are disabled when not editable', () => {
    render(
      <Toolbar
        tool="select"
        setTool={vi.fn()}
        canEdit={false}
        onCreateSticky={vi.fn()}
        undo={{ canUndo: false, canRedo: false, undo: vi.fn(), redo: vi.fn() }}
        shapeKind="rect"
        setShapeKind={vi.fn()}
      />,
    );

    expect(screen.getByTestId('shape-btn')).toBeDisabled();
    expect(screen.getByTestId('connector-btn')).toBeDisabled();
  });

  // TC-29: bin button → note removed, selection cleared
  it('TC-29: delete button removes the note', () => {
    const onDelete = vi.fn(() => {
      deleteObject(doc, noteId);
    });

    render(<NoteToolbar color="yellow" onColor={vi.fn()} onDelete={onDelete} />);

    const deleteBtn = screen.getByTestId('delete-note-btn');
    fireEvent.click(deleteBtn);

    expect(onDelete).toHaveBeenCalled();
    expect(snapshot(doc)).toHaveLength(0);
  });
});
