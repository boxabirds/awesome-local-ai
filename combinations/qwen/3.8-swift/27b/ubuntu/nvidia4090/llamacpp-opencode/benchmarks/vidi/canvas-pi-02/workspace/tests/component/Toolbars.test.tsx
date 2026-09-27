// Component tests for the toolbars (sticky.toolbar):
// TC-27, TC-28, TC-29.

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../src/client/App';

function notes(): Array<{ id: string; x: number; y: number; color: string; text: string; z: number }> {
  return window.__vidi6?.getStickyNotes() ?? [];
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('sticky.toolbar', () => {
  it('TC-27: a colour swatch changes the model colour; selection is kept', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Sticky note' }));
    fireEvent.keyDown(screen.getByTestId('sticky-editor-input'), { key: 'Escape' });
    expect(notes()[0].color).toBe('yellow'); // default

    fireEvent.click(screen.getByRole('button', { name: 'Pink colour' }));

    expect(notes()[0].color).toBe('pink');
    const note = screen.getByTestId('sticky-note');
    expect(note).toHaveAttribute('data-selected', 'true'); // selection kept
    expect(screen.getByTestId('note-toolbar')).toBeTruthy();
  });

  it('TC-28: the Sticky note button creates one note centred on the viewport, in Editing', async () => {
    render(<App />);
    expect(notes()).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Sticky note' }));

    expect(notes()).toHaveLength(1);
    // jsdom reports a 0×0 viewport, so the viewport centre is world (0,0):
    // the note (200×200) is centred on it.
    expect(notes()[0].x + 100).toBe(0);
    expect(notes()[0].y + 100).toBe(0);
    expect(screen.getByTestId('sticky-note')).toHaveAttribute('data-editing', 'true');
    expect(screen.getByTestId('sticky-editor-input')).toBeTruthy();
  });

  it('TC-29: the bin button deletes the note and clears the selection', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Sticky note' }));
    fireEvent.keyDown(screen.getByTestId('sticky-editor-input'), { key: 'Escape' });
    expect(notes()).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Delete note' }));

    expect(notes()).toHaveLength(0);
    expect(screen.queryByTestId('sticky-note')).toBeNull();
    expect(screen.queryByTestId('note-toolbar')).toBeNull();
    act(() => {});
  });
});
