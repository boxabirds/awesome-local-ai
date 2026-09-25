import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { snapshot } from '../../src/shared/board-model';
import { enableFakeFrameTimers } from './test-utils';
import { createNote, renderNotesHarness, seedNoteText } from './notes-harness';

const noteEl = () => screen.getByRole('group', { name: 'Sticky note' }) as HTMLElement;

const selectNote = (el: HTMLElement): void => {
  fireEvent.pointerDown(el, { button: 0, clientX: 640, clientY: 400, pointerId: 1 });
  fireEvent.pointerUp(el, { clientX: 640, clientY: 400, pointerId: 1 });
};

const attr = (el: Element | null, name: string): string | null => (el ? el.getAttribute(name) : null);

describe('sticky.toolbars (jsdom, real Y.Doc)', () => {
  beforeEach(() => {
    enableFakeFrameTimers();
  });

  it('TC-27 clicking a colour swatch changes the note colour and keeps it selected', () => {
    const { docRef } = renderNotesHarness();
    const id = createNote(docRef.current!, 0, 0);
    const note = noteEl();
    selectNote(note);

    fireEvent.click(screen.getByRole('button', { name: 'Pink colour' }));

    expect(snapshot(docRef.current!).find((n) => n.id === id)!.color).toBe('pink');
    expect(attr(note, 'data-selected')).toBe('true');
    // The pressed swatch is marked.
    expect(attr(screen.getByRole('button', { name: 'Pink colour' }), 'aria-pressed')).toBe('true');
  });

  it('TC-28 the Sticky note button creates a note centred in the viewport, in edit mode', () => {
    const { docRef } = renderNotesHarness();
    expect(snapshot(docRef.current!)).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Sticky note' }));

    const notes = snapshot(docRef.current!);
    expect(notes).toHaveLength(1);
    // Viewport 1280x800, camera centred at world (0,0): centre note => top-left (-100,-100).
    expect(notes[0]).toMatchObject({ x: -100, y: -100 });
    const ta = screen.queryByRole('textbox', { name: 'Sticky note text' }) as HTMLTextAreaElement | null;
    expect(ta).not.toBeNull();
    expect(document.activeElement).toBe(ta);
  });

  it('TC-29 the bin deletes the selected note (toolbar and selection disappear)', () => {
    const { docRef } = renderNotesHarness();
    const id = createNote(docRef.current!, 0, 0);
    seedNoteText(docRef.current!, id, 'bye');
    const note = noteEl();
    selectNote(note);
    expect(screen.queryByRole('toolbar', { name: 'Note options' })).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Delete note' }));

    expect(snapshot(docRef.current!)).toHaveLength(0);
    expect(screen.queryByRole('group', { name: 'Sticky note' })).toBeNull();
    expect(screen.queryByRole('toolbar', { name: 'Note options' })).toBeNull();
  });
});
