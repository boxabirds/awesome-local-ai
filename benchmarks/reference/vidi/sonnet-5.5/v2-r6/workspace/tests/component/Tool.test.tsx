import { act, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { BoardApp } from '../../src/client/App';
import { renderBoard, addNote, noteEl, notes } from './board';
import { readCamera } from './helpers';
import { render } from '@testing-library/react';
import { initDoc, snapshot } from '../../src/shared/board-model';

const key = (k: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(window, { key: k, ...init });
const textButton = () => screen.getByRole('button', { name: 'Text (T)' });
const selectButton = () => screen.getByRole('button', { name: 'Select (V)' });
const pressed = (el: HTMLElement) => el.getAttribute('aria-pressed');
const texts = (doc: Y.Doc) => snapshot(doc).filter((o) => o.type === 'text');

describe('tool mode', () => {
  it('TC-14 T activates the Text tool, Escape and V return to Select', () => {
    renderBoard();
    expect(pressed(selectButton())).toBe('true');
    key('t');
    expect(pressed(textButton())).toBe('true');
    expect(pressed(selectButton())).toBe('false');
    key('Escape');
    expect(pressed(selectButton())).toBe('true');
    key('T');
    key('v');
    expect(pressed(selectButton())).toBe('true');
    expect(pressed(textButton())).toBe('false');
  });

  it('the buttons switch tools and the board shows a text cursor', () => {
    const { viewport } = renderBoard();
    fireEvent.click(textButton());
    expect(pressed(textButton())).toBe('true');
    expect(viewport.style.cursor).toBe('text');
    fireEvent.click(selectButton());
    expect(viewport.style.cursor).not.toBe('text');
  });

  it('TC-15 on a board that cannot be edited T is ignored and the Text button is disabled', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    render(<BoardApp board={{ doc, notes: snapshot(doc), connection: 'load_failed' }} />);
    expect((textButton() as HTMLButtonElement).disabled).toBe(true);
    key('t');
    expect(pressed(textButton())).toBe('false');
    expect(pressed(selectButton())).toBe('true');
  });

  it('TC-16 T typed while editing a note is a character, not a tool change', async () => {
    const { doc } = renderBoard();
    const id = addNote(doc, 0, 0);
    fireEvent.doubleClick(noteEl(id));
    await userEvent.type(screen.getByRole('textbox', { name: 'Note text' }), 'tt');
    expect(notes(doc)[0].text).toBe('tt');
    expect(pressed(textButton())).toBe('false');
  });

  it('TC-17 with the Text tool a board click creates text there, switches to Select and starts editing', () => {
    const { doc, viewport, world } = renderBoard();
    key('t');
    fireEvent.pointerDown(viewport, { clientX: 300, clientY: 200, button: 0, pointerId: 1 });
    fireEvent.click(viewport, { clientX: 300, clientY: 200, button: 0 });
    const cam = readCamera(world);
    const [t] = texts(doc);
    expect(t.x).toBeCloseTo(cam.x + 300 / cam.zoom);
    expect(t.y).toBeCloseTo(cam.y + 200 / cam.zoom);
    expect(pressed(selectButton())).toBe('true');
    const editor = screen.getByRole('textbox', { name: 'Text' });
    expect(document.activeElement).toBe(editor);
  });

  it('a click on top of a note still creates text and does not select or drag the note', () => {
    const { doc, viewport } = renderBoard();
    const id = addNote(doc, 300, 300);
    key('t');
    fireEvent.pointerDown(noteEl(id), { clientX: 310, clientY: 310, button: 0, pointerId: 1 });
    expect(noteEl(id).dataset.selected).toBe('false');
    fireEvent.click(viewport, { clientX: 310, clientY: 310, button: 0 });
    expect(texts(doc)).toHaveLength(1);
  });

  it('Escape or V in Text mode creates nothing', () => {
    const { doc } = renderBoard();
    key('t');
    key('Escape');
    key('t');
    key('v');
    expect(snapshot(doc)).toHaveLength(0);
  });

  it('TC-18 N creates a sticky note at the view centre', () => {
    const { doc, world } = renderBoard();
    act(() => { key('n'); });
    const [note] = snapshot(doc);
    expect(note.type).toBe('sticky');
    const cam = readCamera(world);
    expect(note.x + note.width / 2).toBeCloseTo(cam.x + window.innerWidth / 2 / cam.zoom);
    expect(note.y + note.height / 2).toBeCloseTo(cam.y + window.innerHeight / 2 / cam.zoom);
    expect(screen.getByRole('textbox', { name: 'Note text' })).toBeTruthy();
  });
});
