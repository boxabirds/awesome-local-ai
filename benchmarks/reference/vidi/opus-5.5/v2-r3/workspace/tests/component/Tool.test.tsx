import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { objectsSnapshot, snapshot } from '../../src/shared/board-model';
import { STICKY_SIZE_WORLD } from '../../src/shared/config';
import { isText, type TextSnapshot } from '../../src/shared/objects/text';
import type { ConnectionState } from '../../src/client/sync/connectBoard';
import { keyDown, model, noteEl, readCamera, renderApp } from './helpers';
import { createSticky } from '../../src/shared/board-model';

const connections: { onState(s: ConnectionState): void }[] = [];
vi.mock('../../src/client/sync/connectBoard', () => ({
  connectBoard: (_doc: unknown, _boardId: string, onState: (s: ConnectionState) => void) => {
    connections.push({ onState });
    onState('connecting');
    return { destroy() {} };
  },
}));

function setState(state: ConnectionState) {
  act(() => connections[connections.length - 1].onState(state));
}

const selectButton = () => screen.getByRole('button', { name: 'Select (V)' });
const textButton = () => screen.getByRole('button', { name: 'Text (T)' });
const texts = () => objectsSnapshot(window.__vidi6!.doc).filter(isText) as TextSnapshot[];

describe('Tool mode (text.tool_ui)', () => {
  beforeEach(() => {
    connections.length = 0;
  });

  it('the left toolbar has Select (V), Text (T) and Sticky note (N) with pressed state', () => {
    renderApp();
    const tools = screen.getByRole('toolbar', { name: 'Tools' });
    const names = [...tools.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'));
    expect(names.slice(0, 3)).toEqual(['Select (V)', 'Text (T)', 'Sticky note (N)']);
    expect(selectButton()).toHaveAttribute('aria-pressed', 'true');
    expect(textButton()).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Sticky note (N)' })).not.toHaveAttribute('aria-pressed');
  });

  it('TC-14 T activates Text (pressed, text cursor); Escape returns to Select; T then V returns to Select', () => {
    const { viewport } = renderApp();
    keyDown(document.body, 't');
    expect(textButton()).toHaveAttribute('aria-pressed', 'true');
    expect(selectButton()).toHaveAttribute('aria-pressed', 'false');
    expect(viewport.dataset.tool).toBe('text');
    expect(viewport).toHaveClass('is-text-tool');
    keyDown(document.body, 'Escape');
    expect(textButton()).toHaveAttribute('aria-pressed', 'false');
    expect(selectButton()).toHaveAttribute('aria-pressed', 'true');
    keyDown(document.body, 'T');
    expect(textButton()).toHaveAttribute('aria-pressed', 'true');
    keyDown(document.body, 'v');
    expect(selectButton()).toHaveAttribute('aria-pressed', 'true');
    expect(viewport.dataset.tool).toBe('select');
    // Buttons do the same; nothing was created on the way.
    fireEvent.click(textButton());
    expect(textButton()).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(selectButton());
    expect(selectButton()).toHaveAttribute('aria-pressed', 'true');
    expect(objectsSnapshot(window.__vidi6!.doc)).toHaveLength(0);
  });

  it('TC-15 when the board failed to load, T is ignored and the Text button is disabled', () => {
    const { viewport } = renderApp();
    keyDown(document.body, 't');
    expect(textButton()).toHaveAttribute('aria-pressed', 'true');
    setState('load_failed');
    // An active Text tool reverts to Select.
    expect(textButton()).toHaveAttribute('aria-pressed', 'false');
    expect(textButton()).toBeDisabled();
    keyDown(document.body, 't');
    expect(textButton()).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(textButton());
    expect(viewport.dataset.tool).toBe('select');
    fireEvent.pointerDown(viewport, { pointerId: 1, button: 0, clientX: 300, clientY: 200 });
    fireEvent.pointerUp(viewport, { pointerId: 1, clientX: 300, clientY: 200 });
    expect(texts()).toHaveLength(0);
    // N does not create a sticky either.
    keyDown(document.body, 'n');
    expect(snapshot(window.__vidi6!.doc)).toHaveLength(0);
  });

  it('TC-16 T while editing a note is typing, not a tool change', () => {
    renderApp();
    const id = model((doc) => createSticky(doc, { x: 100, y: 100 }));
    fireEvent.doubleClick(noteEl(id));
    const textarea = screen.getByRole('textbox', { name: 'Note text' });
    const ev = keyDown(textarea, 't');
    expect(ev.defaultPrevented).toBe(false); // the character goes into the note
    const vEv = keyDown(textarea, 'v');
    expect(vEv.defaultPrevented).toBe(false);
    keyDown(textarea, 'n');
    expect(textButton()).toHaveAttribute('aria-pressed', 'false');
    expect(snapshot(window.__vidi6!.doc)).toHaveLength(1);
    expect(noteEl(id).dataset.editing).toBe('true');
  });

  it('TC-17 with Text active a board click creates text at the clicked world point, edits it and returns to Select', () => {
    const { viewport } = renderApp();
    const cam = readCamera(viewport);
    fireEvent.click(textButton());
    fireEvent.pointerDown(viewport, { pointerId: 1, button: 0, clientX: 300, clientY: 200 });
    fireEvent.pointerUp(viewport, { pointerId: 1, clientX: 300, clientY: 200 });
    const all = texts();
    expect(all).toHaveLength(1);
    expect(all[0].x).toBeCloseTo(300 / cam.zoom + cam.x, 9);
    expect(all[0].y).toBeCloseTo(200 / cam.zoom + cam.y, 9);
    expect(all[0]).toMatchObject({ size: 'M', widthMode: 'auto', text: '' });
    expect(viewport.dataset.state).toBe('idle'); // no pan started
    expect(selectButton()).toHaveAttribute('aria-pressed', 'true');
    const editor = screen.getByRole('textbox', { name: 'Text' });
    expect(editor).toHaveFocus();
    expect(editor.closest('[data-object-id]')).toHaveAttribute('data-object-id', all[0].id);
  });

  it('TC-17 clicking on top of an existing note with Text active creates text on top at that point', () => {
    const { viewport } = renderApp();
    const cam = readCamera(viewport);
    const noteId = model((doc) => createSticky(doc, { x: 300 / cam.zoom + cam.x, y: 200 / cam.zoom + cam.y }));
    keyDown(document.body, 't');
    fireEvent.pointerDown(noteEl(noteId), { pointerId: 1, button: 0, clientX: 300, clientY: 200 });
    fireEvent.pointerUp(noteEl(noteId), { pointerId: 1, clientX: 300, clientY: 200 });
    const [text] = texts();
    expect(text).toBeDefined();
    expect(text.z).toBeGreaterThan(snapshot(window.__vidi6!.doc)[0].z);
    expect(noteEl(noteId).dataset.selected).toBe('false'); // the note was not selected or dragged
    expect(snapshot(window.__vidi6!.doc)[0]).toMatchObject({ x: 300 / cam.zoom + cam.x - STICKY_SIZE_WORLD / 2 });
  });

  it('TC-18 N still creates a sticky note at the view centre, in edit mode', () => {
    const { viewport } = renderApp();
    const cam = readCamera(viewport);
    keyDown(document.body, 'n');
    const notes = snapshot(window.__vidi6!.doc);
    expect(notes).toHaveLength(1);
    expect(notes[0].x + STICKY_SIZE_WORLD / 2).toBeCloseTo(window.innerWidth / 2 / cam.zoom + cam.x, 9);
    expect(notes[0].y + STICKY_SIZE_WORLD / 2).toBeCloseTo(window.innerHeight / 2 / cam.zoom + cam.y, 9);
    expect(noteEl(notes[0].id).dataset.editing).toBe('true');
  });
});
