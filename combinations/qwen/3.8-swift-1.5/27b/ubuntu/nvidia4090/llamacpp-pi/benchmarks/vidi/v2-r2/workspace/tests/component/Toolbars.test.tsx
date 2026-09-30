import { describe, it, expect } from 'vitest';
import { act, screen } from '@testing-library/react';
import { createSticky, snapshot } from '../../src/shared/board-model';
import { STICKY_SIZE_WORLD } from '../../src/shared/config';
import { renderApp, getNote } from './sticky-helpers';
import { createPointerEvent } from './helpers';

function selectNote(id: string, at = { x: 100, y: 100 }) {
  const el = getNote(id)!;
  act(() => {
    el.dispatchEvent(createPointerEvent('pointerdown', { ...at, pointerId: 1, button: 0 }));
  });
  act(() => {
    el.dispatchEvent(createPointerEvent('pointerup', { ...at, pointerId: 1, button: 0 }));
  });
}

describe('sticky.toolbar (ui-component)', () => {
  it('TC-27: Pink swatch → model colour pink; selection kept', () => {
    const app = renderApp();
    const doc = app.getDoc();
    let id = '';
    act(() => {
      id = createSticky(doc, { x: 0, y: 0 }) as string;
    });
    selectNote(id);

    act(() => {
      screen.getByLabelText('Pink colour').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const note = snapshot(doc).find((n) => n.id === id)!;
    expect(note.color).toBe('pink');
    expect(getNote(id)!.hasAttribute('data-selected')).toBe(true);
    // The pressed state reflects the active colour.
    expect((screen.getByLabelText('Pink colour') as HTMLButtonElement).getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByLabelText('Yellow colour') as HTMLButtonElement).getAttribute('aria-pressed')).toBe('false');
  });

  it('TC-28: Sticky note button → 1 note centred on viewport centre; Editing', () => {
    const app = renderApp();
    const doc = app.getDoc();

    act(() => {
      screen.getByLabelText('Sticky note (N)').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const notes = snapshot(doc);
    expect(notes).toHaveLength(1);
    // Default camera centres the viewport on world (0,0) (1280×800 viewport):
    // the note is centred on the viewport centre → top-left at (−100, −100).
    expect(notes[0].x).toBeCloseTo(-STICKY_SIZE_WORLD / 2, 5);
    expect(notes[0].y).toBeCloseTo(-STICKY_SIZE_WORLD / 2, 5);
    expect(screen.getByTestId('sticky-editor')).not.toBeNull();
  });

  it('TC-29: bin button → note removed; selection cleared', () => {
    const app = renderApp();
    const doc = app.getDoc();
    let id = '';
    act(() => {
      id = createSticky(doc, { x: 0, y: 0 }) as string;
    });
    selectNote(id);
    expect(getNote(id)!.hasAttribute('data-selected')).toBe(true);

    act(() => {
      screen.getByLabelText('Delete note').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(snapshot(doc)).toHaveLength(0);
    expect(getNote(id)).toBeNull();
    expect(screen.queryByTestId('note-toolbar')).toBeNull();
  });
});
