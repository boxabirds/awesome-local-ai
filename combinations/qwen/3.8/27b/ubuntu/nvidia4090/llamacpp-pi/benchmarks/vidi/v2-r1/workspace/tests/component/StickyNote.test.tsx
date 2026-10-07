// Story 2 component tests: sticky note selection, drag and deletion
// mid-interaction (TC-18 to TC-22, TC-37).

import { describe, it, expect } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import {
  renderApp,
  hooks,
  addNote,
  note,
  removeNote,
  click,
  dragTo,
  pointerUp,
  flushRaf,
} from './helpers';

function viewport(): HTMLElement {
  return screen.getByTestId('board-viewport');
}

function theNote(): HTMLElement {
  const el = screen.queryByTestId('sticky-note');
  if (!el) throw new Error('no sticky note rendered');
  return el;
}

const noteToolbar = () => screen.queryByRole('toolbar', { name: 'Sticky note options' });

// addNote(cx, cy) centres the note on world (cx, cy); the stored x,y are the
// top-left (centre − STICKY_SIZE_WORLD/2). Tests therefore assert position
// *deltas* rather than absolute values.

describe('sticky note interaction (component)', () => {
  it('TC-18: a press without movement selects the note and shows the note toolbar', () => {
    renderApp();
    const id = addNote(0, 0);
    const el = theNote();
    const before = note(id)!;

    expect(el).not.toHaveAttribute('data-selected');
    click(el);

    const after = note(id)!;
    expect(after.x).toBe(before.x); // position untouched by a mere press
    expect(after.y).toBe(before.y);
    expect(el).toHaveAttribute('data-selected');
    expect(el).toHaveClass('sticky-note--selected');
    expect(noteToolbar()).toBeInTheDocument();
    expect(el).toHaveAccessibleName('Sticky note');
  });

  it('TC-19: a press + 2 px move + release is below the drag threshold: selected, no move', () => {
    renderApp();
    const id = addNote(0, 0);
    const el = theNote();
    const before = note(id)!;

    // 2 px < DRAG_THRESHOLD_PX (3): no drag, ends in Selected.
    dragTo(el, 2, 0, 1);
    pointerUp(el, 2, 0);

    expect(el).toHaveAttribute('data-selected');
    expect(note(id)!.x).toBe(before.x);
    expect(note(id)!.y).toBe(before.y);
  });

  it('TC-19: exactly 3 px starts a drag (boundary)', async () => {
    renderApp();
    const id = addNote(0, 0);
    const el = theNote();
    const before = note(id)!;

    dragTo(el, 3, 0, 1); // exactly DRAG_THRESHOLD_PX
    pointerUp(el, 3, 0);
    await flushRaf();

    expect(note(id)!.x).toBe(before.x + 3); // moved by 3 world units (zoom 1)
    expect(note(id)!.y).toBe(before.y);
    expect(el).toHaveAttribute('data-selected');
  });

  it('TC-20: a drag starting on a note never pans the board camera', async () => {
    renderApp();
    addNote(0, 0);
    const el = theNote();
    const before = hooks().getCamera();

    dragTo(el, 60, 40, 4);
    pointerUp(el, 60, 40);
    await flushRaf();

    const after = hooks().getCamera();
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.zoom).toBe(before.zoom);
  });

  it('TC-21: pointercancel during a drag ends in Selected at the last applied position', async () => {
    renderApp();
    const id = addNote(0, 0);
    const el = theNote();
    const before = note(id)!;

    dragTo(el, 10, 0, 2);
    await flushRaf(); // apply the pending position (x = before + 10)
    expect(note(id)!.x).toBe(before.x + 10);

    fireEvent.pointerCancel(el, { pointerId: 1, clientX: 10, clientY: 0, bubbles: true });
    await flushRaf();

    expect(note(id)!.x).toBe(before.x + 10); // last applied position kept, nothing new
    expect(el).toHaveAttribute('data-selected');
  });

  it('TC-22: a click on the empty board clears the selection and hides the toolbar', () => {
    renderApp();
    addNote(0, 0);
    const el = theNote();
    click(el);
    expect(noteToolbar()).toBeInTheDocument();

    click(viewport(), 400, 400);

    expect(el).not.toHaveAttribute('data-selected');
    expect(noteToolbar()).not.toBeInTheDocument();
  });

  it('TC-37: a note deleted via the model while Dragging ends the interaction silently', async () => {
    renderApp();
    const id = addNote(0, 0);
    const el = theNote();

    dragTo(el, 20, 0, 3);
    // The note disappears mid-drag (as another client's delete would in story 3).
    removeNote(id);

    expect(screen.queryByTestId('sticky-note')).not.toBeInTheDocument();
    expect(screen.queryByRole('toolbar', { name: 'Sticky note options' })).not.toBeInTheDocument();

    // Continuing the interaction must not throw or resurrect the note.
    fireEvent.pointerMove(viewport(), { pointerId: 1, clientX: 30, clientY: 0, bubbles: true });
    fireEvent.pointerUp(viewport(), { pointerId: 1, clientX: 30, clientY: 0, bubbles: true });
    await flushRaf();

    expect(hooks().getNotes()).toHaveLength(0);
  });

  it('TC-37: a note deleted via the model while Editing unmounts the editor without error', () => {
    renderApp();
    const id = addNote(0, 0);
    const el = theNote();
    click(el);
    fireEvent.dblClick(el);
    expect(screen.getByTestId('sticky-editor')).toBeInTheDocument();

    removeNote(id);

    expect(screen.queryByTestId('sticky-editor')).not.toBeInTheDocument();
    expect(screen.queryByTestId('sticky-note')).not.toBeInTheDocument();
    expect(hooks().getNotes()).toHaveLength(0);
  });
});
