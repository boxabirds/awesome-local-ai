import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { App } from '../../src/client/App';

afterEach(cleanup);

describe('Toolbars', () => {
  // TC-27: Click Pink swatch → model colour pink, selection kept
  it('TC-27 clicking pink swatch changes note colour and keeps selection', () => {
    render(<App />);
    const createBtn = screen.getByLabelText('Sticky note');
    fireEvent.click(createBtn);

    // End editing to get to selected state (toolbar shows only when not editing)
    const textarea = screen.getByTestId('sticky-textarea');
    fireEvent.keyDown(textarea, { key: 'Escape' });

    // Now the note toolbar should appear
    expect(screen.getByTestId('note-toolbar')).toBeInTheDocument();

    // Click pink swatch
    const pinkSwatch = screen.getByLabelText('pink colour');
    fireEvent.click(pinkSwatch);

    // Note toolbar should still be present (selection kept)
    expect(screen.getByTestId('note-toolbar')).toBeInTheDocument();
    // Pink swatch should be pressed
    expect(screen.getByLabelText('pink colour')).toHaveAttribute('aria-pressed', 'true');
  });

  // TC-28: Click Sticky note button → one note created, editing
  it('TC-28 clicking Sticky note button creates a note and starts editing', () => {
    render(<App />);
    const createBtn = screen.getByLabelText('Sticky note');
    fireEvent.click(createBtn);

    // Check that a textarea appeared (editing mode)
    const textarea = screen.getByTestId('sticky-textarea');
    expect(textarea).toBeInTheDocument();
  });

  // TC-29: Click bin button → note removed, selection cleared
  it('TC-29 clicking delete button removes the note', () => {
    render(<App />);
    const createBtn = screen.getByLabelText('Sticky note');
    fireEvent.click(createBtn);

    // End editing by pressing Escape
    const textarea = screen.getByTestId('sticky-textarea');
    fireEvent.keyDown(textarea, { key: 'Escape' });

    // Note toolbar should appear
    const toolbar = screen.getByTestId('note-toolbar');
    expect(toolbar).toBeInTheDocument();

    // Click delete
    const deleteBtn = screen.getByLabelText('Delete note');
    fireEvent.click(deleteBtn);

    // Note toolbar should be gone (no selection)
    expect(screen.queryByTestId('note-toolbar')).not.toBeInTheDocument();
    // Textarea should be gone (no editing)
    expect(screen.queryByTestId('sticky-textarea')).not.toBeInTheDocument();
  });

  it('Toolbar button has correct tooltip text', () => {
    render(<App />);
    const btn = screen.getByLabelText('Sticky note');
    expect(btn).toHaveAttribute(
      'title',
      'Sticky note \u2013 or double-click the board',
    );
  });

  it('Note toolbar shows 6 colour swatches', () => {
    render(<App />);
    fireEvent.click(screen.getByLabelText('Sticky note'));
    // End editing
    fireEvent.keyDown(screen.getByTestId('sticky-textarea'), { key: 'Escape' });
    // Check swatches exist
    const colors = ['yellow', 'orange', 'green', 'blue', 'pink', 'violet'];
    for (const color of colors) {
      expect(screen.getByLabelText(`${color} colour`)).toBeInTheDocument();
    }
  });
});
