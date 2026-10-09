import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import {
  App,
  createNote,
  flush,
  noteEl,
  notes,
  pressAndRelease,
  readCamera,
} from './stickyHelpers';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('sticky.toolbar', () => {
  it('TC-27: pink swatch recolours the note in the model and keeps selection', () => {
    render(<App />);
    flush();
    const id = createNote(100, 100);
    pressAndRelease(noteEl(id));

    fireEvent.click(screen.getByTestId('swatch-pink'));
    flush();

    expect(notes()[0].color).toBe('pink');
    expect(noteEl(id).getAttribute('data-selected')).toBe('true');
    expect(screen.getByTestId('swatch-pink')).toHaveAttribute('aria-pressed', 'true');
  });

  it('TC-28: Sticky note button creates one note centred on the viewport in edit mode', () => {
    render(<App />);
    flush();

    fireEvent.click(screen.getByTestId('create-sticky'));
    flush();

    expect(notes()).toHaveLength(1);
    const cam = readCamera();
    // viewport is 1280x800 (ResizeObserver mock); world centre of the screen
    const expectedLeft = cam.x + 1280 / cam.zoom / 2 - 100;
    const expectedTop = cam.y + 800 / cam.zoom / 2 - 100;
    expect(notes()[0].x).toBeCloseTo(expectedLeft, 6);
    expect(notes()[0].y).toBeCloseTo(expectedTop, 6);
    expect(screen.queryByTestId('sticky-textarea')).not.toBeNull();
  });

  it('TC-29: bin button deletes the note and clears selection', () => {
    render(<App />);
    flush();
    const id = createNote(100, 100);
    pressAndRelease(noteEl(id));

    fireEvent.click(screen.getByTestId('delete-note'));
    flush();

    expect(notes()).toHaveLength(0);
    expect(screen.queryByTestId('note-toolbar')).toBeNull();
  });
});
