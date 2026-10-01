import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { snapshot, stickies } from '../../src/shared/board-model';
import type { TextSnapshot } from '../../src/shared/objects/text';
import { noteEl, setupBoard, viewport } from './helpers';

afterEach(cleanup);

const textBtn = () => screen.getByRole('button', { name: 'Text (T)' }) as HTMLButtonElement;
const selectBtn = () => screen.getByRole('button', { name: 'Select (V)' });
const pressed = (el: HTMLElement) => el.getAttribute('aria-pressed');

function key(k: string, init: KeyboardEventInit = {}) {
  act(() => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));
  });
}

describe('text.tool_ui', () => {
  it('TC-14 T activates Text, Escape and V return to Select', () => {
    setupBoard();
    expect(pressed(selectBtn())).toBe('true');
    expect(pressed(textBtn())).toBe('false');
    key('t');
    expect(pressed(textBtn())).toBe('true');
    expect(pressed(selectBtn())).toBe('false');
    expect(viewport().style.cursor).toBe('text');
    key('Escape');
    expect(pressed(selectBtn())).toBe('true');
    key('T');
    key('v');
    expect(pressed(selectBtn())).toBe('true');
    expect(viewport().style.cursor).not.toBe('text');
    fireEvent.click(textBtn());
    expect(pressed(textBtn())).toBe('true');
    fireEvent.click(selectBtn());
    expect(pressed(textBtn())).toBe('false');
  });

  it('TC-16 T typed while editing a sticky note types a letter and leaves the tool alone', async () => {
    const { doc } = setupBoard([{ x: 0, y: 0 }]);
    fireEvent.doubleClick(noteEl());
    await userEvent.keyboard('tvn');
    expect(stickies(doc)[0].text).toBe('tvn');
    expect(pressed(textBtn())).toBe('false');
    expect(stickies(doc)).toHaveLength(1);
  });

  it('TC-17 with Text active a board click creates text there, returns to Select and starts editing', () => {
    const { doc } = setupBoard();
    key('t');
    fireEvent.pointerDown(viewport(), { clientX: 300, clientY: 200, pointerId: 1, button: 0 });
    fireEvent.pointerUp(viewport(), { clientX: 300, clientY: 200, pointerId: 1 });
    fireEvent.click(viewport(), { clientX: 300, clientY: 200, button: 0 });
    const all = snapshot(doc);
    expect(all).toHaveLength(1);
    const t = all[0] as TextSnapshot;
    // jsdom window is 1024x768 and the starting camera centres the origin on screen.
    expect(t).toMatchObject({ type: 'text', x: 300 - 512, y: 200 - 384, size: 'M' });
    expect(pressed(selectBtn())).toBe('true');
    expect(screen.getByRole('textbox', { name: 'Text' })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('textbox'));
  });

  it('TC-17b a click on top of an existing note still places text and does not select or pan', () => {
    const { doc } = setupBoard([{ x: 0, y: 0 }]);
    key('t');
    const note = noteEl();
    fireEvent.pointerDown(note, { clientX: 520, clientY: 390, pointerId: 1, button: 0 });
    expect(note.getAttribute('data-selected')).toBe('false');
    fireEvent.pointerUp(note, { clientX: 520, clientY: 390, pointerId: 1 });
    fireEvent.click(note, { clientX: 520, clientY: 390, button: 0 });
    expect(snapshot(doc).filter((o) => o.type === 'text')).toHaveLength(1);
    expect(stickies(doc)).toHaveLength(1);
  });

  it('Escape with Text active creates nothing', () => {
    const { doc } = setupBoard();
    key('t');
    key('Escape');
    fireEvent.click(viewport(), { clientX: 300, clientY: 200, button: 0 });
    expect(snapshot(doc)).toHaveLength(0);
  });

  it('TC-18 N creates a sticky note at the view centre', () => {
    const { doc } = setupBoard();
    key('n');
    const notes = stickies(doc);
    expect(notes).toHaveLength(1);
    expect(notes[0].x + 100).toBe(0);
    expect(notes[0].y + 100).toBe(0);
    expect(screen.getByRole('textbox')).toBeTruthy();
  });
});
