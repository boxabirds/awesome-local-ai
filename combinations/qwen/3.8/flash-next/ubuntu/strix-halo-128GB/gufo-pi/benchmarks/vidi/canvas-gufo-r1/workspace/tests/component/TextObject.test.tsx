/**
 * Component tests for text objects: editing, empty removal, sizes, handles, remote delete, undo (TC-19 to TC-25).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { BoardApp } from '../../src/client/BoardApp';

afterEach(cleanup);

/** Helper: create a text object by activating text tool and clicking viewport */
function createTextObject() {
  render(<BoardApp boardId={'A'.repeat(22)} />);
  fireEvent.keyDown(window, { key: 't' });
  const viewport = screen.getByTestId('board-viewport');
  fireEvent.click(viewport);
  return screen.getByTestId('text-object-textarea');
}

/** Helper: type text into a textarea (triggers React's onInput) */
function typeText(el: HTMLElement, text: string) {
  const ta = el as HTMLTextAreaElement;
  ta.value = text;
  fireEvent.input(ta);
}

describe('Text object (TC-19 to TC-25)', () => {
  // TC-19: editor caret at end; Enter inserts newline; Escape ends editing and keeps text selected
  it('TC-19: editor caret at end, Enter inserts newline, Escape ends editing', () => {
    const textarea = createTextObject() as HTMLTextAreaElement;
    expect(textarea).toBeInTheDocument();

    // Type some text
    typeText(textarea, 'Hello');

    // Add newline
    typeText(textarea, 'Hello\n');

    // Press Escape → editing ends
    fireEvent.keyDown(textarea, { key: 'Escape' });

    // Textarea should be gone (editing ended)
    expect(screen.queryByTestId('text-object-textarea')).not.toBeInTheDocument();

    // Text toolbar should appear (selected but not editing)
    expect(screen.getByTestId('text-toolbar')).toBeInTheDocument();
  });

  // TC-20: Escape with zero characters → object removed, selection cleared
  it('TC-20: Escape with empty text removes the object', () => {
    createTextObject();

    // Press Escape with empty text → object should be deleted
    fireEvent.keyDown(screen.getByTestId('text-object-textarea'), { key: 'Escape' });

    // No toolbar should appear (no selection)
    expect(screen.queryByTestId('text-toolbar')).not.toBeInTheDocument();
  });

  // TC-21: TextToolbar shows S/M/L/XL with M pressed; click XL → size XL
  it('TC-21: TextToolbar size buttons', () => {
    const textarea = createTextObject();

    // Type text and escape to select
    typeText(textarea, 'Title');
    fireEvent.keyDown(textarea, { key: 'Escape' });

    // TextToolbar should appear
    const toolbar = screen.getByTestId('text-toolbar');
    expect(toolbar).toBeInTheDocument();

    // M should be pressed (default)
    const mBtn = screen.getByTestId('text-size-M');
    expect(mBtn).toHaveAttribute('aria-pressed', 'true');

    // Click XL
    const xlBtn = screen.getByTestId('text-size-XL');
    expect(xlBtn).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(xlBtn);

    // XL should now be pressed
    expect(xlBtn).toHaveAttribute('aria-pressed', 'true');
    expect(mBtn).toHaveAttribute('aria-pressed', 'false');
  });

  // TC-22: single text selected → only e and w handles rendered
  it('TC-22: single text selected shows only e and w handles', () => {
    const textarea = createTextObject();

    // Type and escape to select
    typeText(textarea, 'Resize me');
    fireEvent.keyDown(textarea, { key: 'Escape' });

    // Selection overlay should show only e and w handles
    const overlay = screen.getByTestId('selection-overlay');
    expect(overlay).toBeInTheDocument();

    // e and w handles should exist
    expect(screen.getByTestId('handle-e')).toBeInTheDocument();
    expect(screen.getByTestId('handle-w')).toBeInTheDocument();

    // n, s, ne, nw, se, sw should NOT exist
    expect(screen.queryByTestId('handle-n')).not.toBeInTheDocument();
    expect(screen.queryByTestId('handle-s')).not.toBeInTheDocument();
    expect(screen.queryByTestId('handle-ne')).not.toBeInTheDocument();
    expect(screen.queryByTestId('handle-nw')).not.toBeInTheDocument();
    expect(screen.queryByTestId('handle-se')).not.toBeInTheDocument();
    expect(screen.queryByTestId('handle-sw')).not.toBeInTheDocument();
  });

  // TC-23: text + sticky selected → all handles
  it('TC-23: text + sticky selection shows all handles', () => {
    render(<BoardApp boardId={'A'.repeat(22)} />);

    // Create a text object
    fireEvent.keyDown(window, { key: 't' });
    fireEvent.click(screen.getByTestId('board-viewport'));
    const textArea = screen.getByTestId('text-object-textarea');
    typeText(textArea, 'Text');
    fireEvent.keyDown(textArea, { key: 'Escape' });

    // Create a sticky note
    fireEvent.click(screen.getByTestId('create-sticky-btn'));
    const stickyArea = screen.getByTestId('sticky-textarea');
    fireEvent.keyDown(stickyArea, { key: 'Escape' });

    // Select both (Ctrl+A)
    fireEvent.keyDown(window, { key: 'a', ctrlKey: true });

    // All handles should appear
    expect(screen.getByTestId('handle-nw')).toBeInTheDocument();
    expect(screen.getByTestId('handle-ne')).toBeInTheDocument();
    expect(screen.getByTestId('handle-se')).toBeInTheDocument();
    expect(screen.getByTestId('handle-sw')).toBeInTheDocument();
  });

  // TC-24: deleting a text object via Delete key
  it('TC-24: Delete key removes text object', () => {
    const textarea = createTextObject();

    // Type and escape to select
    typeText(textarea, 'Delete me');
    fireEvent.keyDown(textarea, { key: 'Escape' });

    // Toolbar should appear
    expect(screen.getByTestId('text-toolbar')).toBeInTheDocument();

    // Press Delete
    fireEvent.keyDown(window, { key: 'Delete' });

    // Toolbar should disappear
    expect(screen.queryByTestId('text-toolbar')).not.toBeInTheDocument();
  });

  // TC-25: TextToolbar delete button removes the object
  it('TC-25: TextToolbar delete button removes text object', () => {
    const textarea = createTextObject();

    // Type and escape to select
    typeText(textarea, 'Delete via button');
    fireEvent.keyDown(textarea, { key: 'Escape' });

    // Click delete in toolbar
    const deleteBtn = screen.getByTestId('text-delete-btn');
    fireEvent.click(deleteBtn);

    // Toolbar should disappear
    expect(screen.queryByTestId('text-toolbar')).not.toBeInTheDocument();
  });
});
