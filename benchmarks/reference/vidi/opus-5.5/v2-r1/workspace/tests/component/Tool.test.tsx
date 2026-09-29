// text.tool_ui (TC-14 to TC-18): tool mode, the Select/Text buttons and click-to-create.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { App } from '../../src/client/App';
import { screenToWorld } from '../../src/client/canvas/camera';
import { newBoardId } from '../../src/shared/board-id';
import { initDoc, objectsSnapshot, snapshot } from '../../src/shared/board-model';
import { STICKY_SIZE_WORLD } from '../../src/shared/config';
import { CLOSE_BOARD_LOAD_FAILED } from '../../src/shared/protocol';
import { FakeWebSocket } from './fakeWebSocket';
import { dispatchKey, initialCamera, useFakeFrames } from './helpers';
import { docWithNote, editor, noteEl, renderApp } from './stickyHelpers';
import { textEditor, textsOf } from './textHelpers';

beforeEach(() => useFakeFrames());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const selectButton = () => screen.getByRole<HTMLButtonElement>('button', { name: 'Select (V)' });
const textButton = () => screen.getByRole<HTMLButtonElement>('button', { name: 'Text (T)' });
const pressed = (b: HTMLElement) => b.getAttribute('aria-pressed');
const viewportEl = () => screen.getByTestId('board-viewport');

describe('text.tool_ui tool mode', () => {
  it('TC-14 T activates Text; Escape and V return to Select', () => {
    renderApp();
    expect(pressed(selectButton())).toBe('true');
    expect(pressed(textButton())).toBe('false');

    dispatchKey({ key: 't' });
    expect(pressed(textButton())).toBe('true');
    expect(pressed(selectButton())).toBe('false');
    expect(viewportEl().classList.contains('is-placing-text')).toBe(true);

    dispatchKey({ key: 'Escape' });
    expect(pressed(selectButton())).toBe('true');
    expect(viewportEl().classList.contains('is-placing-text')).toBe(false);

    dispatchKey({ key: 'T' });
    expect(pressed(textButton())).toBe('true');
    dispatchKey({ key: 'v' });
    expect(pressed(selectButton())).toBe('true');

    // The buttons do the same.
    fireEvent.click(textButton());
    expect(pressed(textButton())).toBe('true');
    fireEvent.click(selectButton());
    expect(pressed(selectButton())).toBe('true');
  });

  it('Escape or V with Text active creates nothing', () => {
    const { doc } = renderApp();
    dispatchKey({ key: 't' });
    dispatchKey({ key: 'Escape' });
    dispatchKey({ key: 't' });
    dispatchKey({ key: 'v' });
    expect(objectsSnapshot(doc)).toHaveLength(0);
  });

  it('TC-15 on a board that failed to load, T is ignored and the Text button is disabled', () => {
    FakeWebSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
    const doc = new Y.Doc();
    initDoc(doc);
    render(<App boardId={newBoardId()} doc={doc} />);
    const ws = FakeWebSocket.latest();
    act(() => {
      ws.readyState = 1;
      ws.onopen?.();
    });
    // Text was active when the board became locked: it returns to Select.
    dispatchKey({ key: 't' });
    expect(pressed(textButton())).toBe('true');
    ws.serverClose(CLOSE_BOARD_LOAD_FAILED);
    expect(textButton().disabled).toBe(true);
    expect(pressed(selectButton())).toBe('true');

    dispatchKey({ key: 't' });
    expect(pressed(textButton())).toBe('false');
    fireEvent.click(textButton());
    expect(pressed(textButton())).toBe('false');
    fireEvent.pointerDown(viewportEl(), { clientX: 300, clientY: 200, button: 0, pointerId: 1 });
    fireEvent.pointerUp(viewportEl(), { clientX: 300, clientY: 200, button: 0, pointerId: 1 });
    expect(objectsSnapshot(doc)).toHaveLength(0);
    expect(textEditor()).toBeNull();
  });

  it('TC-16 T while editing a note types into the note and leaves the tool alone', async () => {
    // user-event stalls when setTimeout is faked.
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
    const { doc } = docWithNote('Le');
    const { user } = renderApp(doc);
    fireEvent.doubleClick(noteEl());
    const textarea = editor()!;
    expect(document.activeElement).toBe(textarea);
    await user.keyboard('t');
    expect(snapshot(doc)[0].text).toBe('Let');
    expect(pressed(selectButton())).toBe('true');
    await user.keyboard('v');
    expect(snapshot(doc)[0].text).toBe('Letv');
    expect(pressed(selectButton())).toBe('true');
  });
});

describe('text.tool_ui Text tool', () => {
  it('TC-17 a board click with Text active creates text at the world point and edits it', () => {
    const { doc } = renderApp();
    dispatchKey({ key: 't' });
    fireEvent.pointerDown(viewportEl(), { clientX: 300, clientY: 200, button: 0, pointerId: 1 });
    fireEvent.pointerUp(viewportEl(), { clientX: 300, clientY: 200, button: 0, pointerId: 1 });
    const texts = textsOf(doc);
    expect(texts).toHaveLength(1);
    const world = screenToWorld(initialCamera(), { x: 300, y: 200 });
    expect(texts[0]).toMatchObject({ x: world.x, y: world.y, size: 'M', widthMode: 'auto', text: '' });
    expect(pressed(selectButton())).toBe('true');
    expect(textEditor()).not.toBeNull();
    expect(document.activeElement).toBe(textEditor());
  });

  it('a click on top of an existing object creates text on top at that point', () => {
    const { doc, id } = docWithNote('Idea');
    renderApp(doc);
    fireEvent.click(textButton());
    const note = noteEl();
    fireEvent.pointerDown(note, { clientX: 50, clientY: 60, button: 0, pointerId: 1 });
    fireEvent.pointerUp(note, { clientX: 50, clientY: 60, button: 0, pointerId: 1 });
    const texts = textsOf(doc);
    expect(texts).toHaveLength(1);
    expect(texts[0].z).toBeGreaterThan(snapshot(doc).find((n) => n.id === id)!.z);
    const world = screenToWorld(initialCamera(), { x: 50, y: 60 });
    expect(texts[0]).toMatchObject({ x: world.x, y: world.y });
    // The note was neither selected nor moved.
    expect(noteEl().dataset.selected).toBe('false');
  });

  it('TC-18 N creates a sticky note in the centre of the view, being edited', () => {
    const { doc } = renderApp();
    dispatchKey({ key: 'n' });
    const notes = snapshot(doc);
    expect(notes).toHaveLength(1);
    const cam = initialCamera();
    expect(notes[0].x + STICKY_SIZE_WORLD / 2).toBe(cam.x + window.innerWidth / 2);
    expect(notes[0].y + STICKY_SIZE_WORLD / 2).toBe(cam.y + window.innerHeight / 2);
    expect(document.activeElement).toBe(editor());
    // The Sticky note button (story 2) shows the shortcut.
    expect(screen.getByRole('button', { name: 'Sticky note (N)' })).toBeTruthy();
  });
});
