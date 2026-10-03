import { describe, it, expect } from 'vitest';
import { screen, act } from '@testing-library/react';
import {
  renderApp,
  pressNote,
  shiftPressNote,
  windowKeyDown,
  getViewport,
  marqueeDrag,
  pointerEvent,
  type AppHarness,
} from './appHarness';

function selectedIds(app: AppHarness): string[] {
  return [...app.notes()]
    .filter((n) => app.noteOrNull(n.id)?.getAttribute('data-selected') === 'true')
    .map((n) => n.id);
}

/** Clicks empty board space (pointerdown+up without movement) → clears the selection. */
function clickEmptySpace() {
  act(() => {
    pointerEvent(getViewport(), 'pointerdown', 900, 600);
  });
  act(() => {
    pointerEvent(getViewport(), 'pointerup', 900, 600);
  });
}

describe('multi-selection (story 7, ui-component)', () => {
  it('TC-16: click selects; shift-click adds/removes; empty click clears; remote delete prunes', async () => {
    const app = await renderApp();
    const a = app.addNote({ x: 100, y: 100 });
    const b = app.addNote({ x: 500, y: 100 });
    const c = app.addNote({ x: 900, y: 100 });

    // plain click: only that note
    pressNote(app, a);
    expect(selectedIds(app)).toEqual([a]);

    // shift-click: adds
    shiftPressNote(app, b);
    expect(selectedIds(app).sort()).toEqual([a, b].sort());

    // shift-click again: removes
    shiftPressNote(app, a);
    expect(selectedIds(app)).toEqual([b]);

    // shift-click c, then plain click a: replaces
    shiftPressNote(app, c);
    expect(selectedIds(app).sort()).toEqual([b, c].sort());
    pressNote(app, a);
    expect(selectedIds(app)).toEqual([a]);

    // click on empty board space clears
    clickEmptySpace();
    expect(selectedIds(app)).toEqual([]);

    // select a and b; delete b via the model → a stays selected
    pressNote(app, a);
    shiftPressNote(app, b);
    expect(selectedIds(app).sort()).toEqual([a, b].sort());
    act(() => {
      app.doc.transact(() => {
        app.doc.getMap('objects').delete(b);
      });
    });
    expect(selectedIds(app)).toEqual([a]);
    expect(app.noteOrNull(b)).toBeNull();
  });

  it('TC-17: Ctrl+A selects all (preventDefault); Escape clears; 8 labelled handles in the overlay', async () => {
    const app = await renderApp();
    const ids = [
      app.addNote({ x: 100, y: 100 }),
      app.addNote({ x: 500, y: 100 }),
    ];

    let event: KeyboardEvent = new KeyboardEvent('keydown');
    act(() => {
      event = windowKeyDown('a', { ctrlKey: true });
    });
    expect(event.defaultPrevented).toBe(true);
    expect(selectedIds(app).sort()).toEqual([...ids].sort());

    // all 8 handles exist with accessible names
    for (const h of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']) {
      const handle = screen.getByTestId(`resize-handle-${h}`);
      expect(handle.getAttribute('aria-label')).toMatch(/^Resize /);
    }

    act(() => {
      windowKeyDown('Escape');
    });
    expect(selectedIds(app)).toEqual([]);
    expect(screen.queryByTestId('selection-overlay')).toBeNull();
  });

  it('TC-17: Meta+A (mac) also selects all', async () => {
    const app = await renderApp();
    const ids = [app.addNote({ x: 100, y: 100 }), app.addNote({ x: 500, y: 100 })];
    act(() => {
      windowKeyDown('a', { metaKey: true });
    });
    expect(selectedIds(app).sort()).toEqual([...ids].sort());
  });

  it('TC-25: two selected → bar with "2 selected" and Delete; delete removes both and clears', async () => {
    const app = await renderApp();
    const a = app.addNote({ x: 100, y: 100 });
    const b = app.addNote({ x: 500, y: 100 });

    pressNote(app, a);
    shiftPressNote(app, b);

    expect(screen.getByTestId('selection-bar')).toBeTruthy();
    expect(screen.getByTestId('selection-count').textContent).toBe('2 selected');
    expect(screen.getByTestId('delete-selection-button').getAttribute('aria-label')).toBe('Delete selection');

    act(() => {
      screen.getByTestId('delete-selection-button').click();
    });
    expect(app.noteOrNull(a)).toBeNull();
    expect(app.noteOrNull(b)).toBeNull();
    expect(selectedIds(app)).toEqual([]);
    expect(screen.queryByTestId('selection-bar')).toBeNull();
  });

  it('TC-26: exactly one sticky note selected → story 2 NoteToolbar, not the bar', async () => {
    const app = await renderApp();
    const a = app.addNote({ x: 100, y: 100 });

    pressNote(app, a);
    expect(screen.getByTestId('note-toolbar')).toBeTruthy();
    expect(screen.queryByTestId('selection-bar')).toBeNull();

    // the toolbar's delete button still works
    act(() => {
      screen.getByLabelText('Delete note').click();
    });
    expect(app.noteOrNull(a)).toBeNull();
  });

  it('TC-29: marquee shift+drag selects the fully-inside notes; empty marquee keeps the selection', async () => {
    const app = await renderApp();
    const a = app.addNote({ x: 150, y: 150 }); // centred → left 50..250
    const b = app.addNote({ x: 550, y: 150 }); // left 450..650

    marqueeDrag(0, 0, 300, 300);
    expect(selectedIds(app)).toEqual([a]);

    // shift marquee is additive
    marqueeDrag(400, 0, 700, 300);
    expect(selectedIds(app).sort()).toEqual([a, b].sort());

    // an empty marquee (no fully-inside notes) leaves the selection unchanged
    marqueeDrag(800, 500, 900, 600);
    expect(selectedIds(app).sort()).toEqual([a, b].sort());
  });

  it('TC-30: Enter starts editing a single selected note; Delete while editing is ignored', async () => {
    const app = await renderApp();
    const a = app.addNote({ x: 100, y: 100 });

    pressNote(app, a);
    act(() => {
      windowKeyDown('Enter');
    });
    expect(screen.getByTestId('sticky-text-editor')).toBeTruthy();

    // typing Delete in the editor must not delete the note
    const textarea = screen.getByTestId('sticky-textarea');
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }));
    expect(app.noteOrNull(a)).not.toBeNull();

    // Escape (in the editor) ends editing, keeping the note selected
    act(() => {
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    expect(screen.queryByTestId('sticky-text-editor')).toBeNull();
    expect(selectedIds(app)).toEqual([a]);
  });

  it('TC-30: Enter with two selected notes does not start editing', async () => {
    const app = await renderApp();
    const a = app.addNote({ x: 100, y: 100 });
    const b = app.addNote({ x: 500, y: 100 });
    pressNote(app, a);
    shiftPressNote(app, b);
    act(() => {
      windowKeyDown('Enter');
    });
    expect(screen.queryByTestId('sticky-text-editor')).toBeNull();
  });
});
