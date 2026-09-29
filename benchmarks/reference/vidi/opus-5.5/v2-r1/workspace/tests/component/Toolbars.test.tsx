import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STICKY_BUTTON_TOOLTIP } from '../../src/client/board/Toolbar';
import { STICKY_COLORS, STICKY_SIZE_WORLD } from '../../src/shared/config';
import { initialCamera, useFakeFrames } from './helpers';
import {
  docWithNote,
  editor,
  noteEl,
  noteElements,
  noteToolbar,
  notesOf,
  renderApp,
  selectNote,
} from './stickyHelpers';

beforeEach(() => useFakeFrames());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('sticky.toolbar', () => {
  it('TC-27 clicking the Pink swatch recolours the note and keeps the selection', () => {
    const { doc } = docWithNote('Retro: keep');
    renderApp(doc);
    selectNote();
    const before = notesOf(doc)[0];
    const swatches = ['Yellow', 'Orange', 'Green', 'Blue', 'Pink', 'Violet'].map((name) =>
      screen.getByRole('button', { name: `${name} colour` }),
    );
    expect(swatches[0].getAttribute('aria-pressed')).toBe('true');
    expect(swatches[4].title).toBe('Pink colour');
    fireEvent.pointerDown(swatches[4], { button: 0, pointerId: 1 });
    fireEvent.pointerUp(swatches[4], { button: 0, pointerId: 1 });
    fireEvent.click(swatches[4]);
    expect(notesOf(doc)[0]).toEqual({ ...before, color: 'pink' });
    expect(noteEl().dataset.selected).toBe('true');
    expect(noteToolbar()).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Pink colour' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(noteEl().style.backgroundColor).toBe('rgb(244, 143, 177)');
    expect(STICKY_COLORS.pink).toBe('#F48FB1');
  });

  it('TC-28 the Sticky note button creates one note centred in the view, in edit mode', () => {
    const { doc } = renderApp();
    const button = screen.getByRole('button', { name: 'Sticky note' });
    expect(button.title).toBe(STICKY_BUTTON_TOOLTIP);
    expect(STICKY_BUTTON_TOOLTIP).toBe('Sticky note – or double-click the board');
    fireEvent.click(button);
    const notes = notesOf(doc);
    expect(notes).toHaveLength(1);
    const cam = initialCamera();
    const centre = { x: cam.x + window.innerWidth / 2, y: cam.y + window.innerHeight / 2 };
    expect(notes[0].x + STICKY_SIZE_WORLD / 2).toBe(centre.x);
    expect(notes[0].y + STICKY_SIZE_WORLD / 2).toBe(centre.y);
    expect(notes[0].color).toBe('yellow');
    expect(document.activeElement).toBe(editor());
    expect(noteEl().dataset.selected).toBe('true');
  });

  it('new notes appear above existing ones', () => {
    const { doc } = docWithNote('first');
    renderApp(doc);
    fireEvent.click(screen.getByRole('button', { name: 'Sticky note' }));
    const [first, second] = noteElements();
    expect(Number(second.style.zIndex)).toBeGreaterThan(Number(first.style.zIndex));
    expect(notesOf(doc).map((n) => n.z)).toEqual([1, 2]);
  });

  it('TC-29 the delete button removes the note and clears the selection', () => {
    const { doc } = docWithNote('Duplicate');
    renderApp(doc);
    selectNote();
    fireEvent.click(screen.getByRole('button', { name: 'Delete note' }));
    expect(notesOf(doc)).toHaveLength(0);
    expect(noteElements()).toHaveLength(0);
    expect(noteToolbar()).toBeNull();
  });
});
