import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as Y from 'yjs';
import { App } from 'src/client/App';
import { boardReady } from './ready';
import { snapshot } from 'src/shared/board-model';

function getDoc(): Y.Doc {
  const w = window as unknown as { __vidi6: { doc: Y.Doc } };
  return w.__vidi6.doc;
}

async function createNoteByDblClick() {
  const viewport = screen.getByTestId('board-viewport');
  fireEvent.doubleClick(viewport, { clientX: 0, clientY: 0 });
  return screen.getAllByTestId('sticky-note');
}

describe('sticky.toolbar (component)', () => {
  beforeEach(async () => {
    render(<App />);
    await boardReady();
  });

  it('TC-27: clicking the Pink swatch changes the model colour and keeps the selection', async () => {
    const user = userEvent.setup();
    const [note] = await createNoteByDblClick();
    await user.type(screen.getByTestId('sticky-note-textarea'), 'idea');
    await user.keyboard('{Escape}'); // selected
    const before = snapshot(getDoc())[0];

    await user.click(screen.getByRole('button', { name: 'Pink colour' }));

    const after = snapshot(getDoc())[0];
    expect(after.color).toBe('pink');
    expect(after.text).toBe('idea');
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(note.hasAttribute('data-selected')).toBe(true);
    // the active swatch reflects the current colour
    expect(screen.getByTestId('swatch-pink').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('swatch-yellow').getAttribute('aria-pressed')).toBe('false');
  });

  it('TC-28: the Sticky note button creates one note centred on the viewport centre, in edit mode', async () => {
    const user = userEvent.setup();
    expect(snapshot(getDoc())).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'Sticky note' }));

    const notes = snapshot(getDoc());
    expect(notes).toHaveLength(1);
    // jsdom viewport is 1024×768; the reset camera puts world (0,0) at the
    // screen centre, so a note centred on the viewport centre sits at (-100,-100).
    expect(notes[0].x).toBe(-100);
    expect(notes[0].y).toBe(-100);
    expect(notes[0].color).toBe('yellow');
    // text editing is active immediately
    expect(screen.getByTestId('sticky-text-editor')).toBeTruthy();
    const textarea = screen.getByTestId('sticky-note-textarea') as HTMLTextAreaElement;
    expect(document.activeElement).toBe(textarea);
  });

  it('TC-29: the bin button deletes the note and clears the selection', async () => {
    const user = userEvent.setup();
    await createNoteByDblClick();
    await user.keyboard('{Escape}'); // selected
    expect(snapshot(getDoc())).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Delete note' }));

    expect(snapshot(getDoc())).toHaveLength(0);
    expect(screen.queryAllByTestId('sticky-note')).toHaveLength(0);
    expect(screen.queryByTestId('note-toolbar')).toBeNull();
  });

  it('the toolbar button has the PRD tooltip and accessible name; swatches are named', async () => {
    const user = userEvent.setup();
    const button = screen.getByRole('button', { name: 'Sticky note' });
    expect(button.getAttribute('title')).toBe('Sticky note – or double-click the board');

    // select a note so its toolbar (and the six named swatches) is visible
    await createNoteByDblClick();
    await user.keyboard('{Escape}');
    for (const name of ['Yellow', 'Orange', 'Green', 'Blue', 'Pink', 'Violet']) {
      expect(screen.getByRole('button', { name: `${name} colour` })).toBeTruthy();
    }
  });
});
