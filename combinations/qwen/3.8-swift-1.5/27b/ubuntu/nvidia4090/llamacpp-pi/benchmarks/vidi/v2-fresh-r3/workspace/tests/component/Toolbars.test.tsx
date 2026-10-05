import { describe, it, expect, afterEach } from 'vitest';
import { screen, cleanup, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp, pointerEvent, type AppHarness } from './appHarness';

afterEach(() => {
  cleanup();
});

function selectNote(app: AppHarness, id: string) {
  const note = app.note(id);
  act(() => {
    pointerEvent(note, 'pointerdown', 100, 100);
  });
  act(() => {
    pointerEvent(note, 'pointerup', 100, 100);
  });
}

describe('sticky.toolbar (ui-component)', async () => {
  it('TC-27: Pink swatch → model colour pink; selection kept', async () => {
    const user = userEvent.setup();
    const app = await renderApp();
    const id = app.addNote({ x: 200, y: 200 });
    selectNote(app, id);

    expect(screen.getByTestId('note-toolbar')).toBeTruthy();
    const pink = screen.getByLabelText('Pink colour');
    expect(pink.getAttribute('aria-pressed')).toBe('false');
    const yellow = screen.getByLabelText('Yellow colour');
    expect(yellow.getAttribute('aria-pressed')).toBe('true');

    await user.click(pink);

    expect(app.notes().find((n) => n.id === id)!.color).toBe('pink');
    // Selection kept
    expect(app.note(id).getAttribute('data-selected')).toBe('true');
    expect(screen.getByLabelText('Pink colour').getAttribute('aria-pressed')).toBe('true');
    // Text and position unchanged
    expect(app.notes().find((n) => n.id === id)!.x).toBe(100);
    expect(app.notes().find((n) => n.id === id)!.y).toBe(100);
  });

  it('TC-28: Sticky note button → one note centred on viewport centre; Editing', async () => {
    const user = userEvent.setup();
    const app = await renderApp();

    expect(app.notes()).toHaveLength(0);

    const button = screen.getByLabelText('Sticky note (N)');
    expect(button.getAttribute('title')).toBe('Sticky note (N) – or double-click the board');
    await user.click(button);

    const notes = app.notes();
    expect(notes).toHaveLength(1);
    // Centred on the viewport centre (jsdom: 1024×768 → centre 512,384)
    expect(notes[0].x).toBe(window.innerWidth / 2 - 100);
    expect(notes[0].y).toBe(window.innerHeight / 2 - 100);
    // Editing started immediately
    expect(screen.getByTestId('sticky-text-editor')).toBeTruthy();
  });

  it('TC-29: bin button → note removed; selection cleared', async () => {
    const user = userEvent.setup();
    const app = await renderApp();
    const id = app.addNote({ x: 200, y: 200 });
    selectNote(app, id);

    expect(screen.getByTestId('note-toolbar')).toBeTruthy();
    await user.click(screen.getByLabelText('Delete note'));

    expect(app.noteOrNull(id)).toBeNull();
    expect(app.notes()).toHaveLength(0);
    expect(screen.queryByTestId('note-toolbar')).toBeNull(); // selection cleared
  });
});
