import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as Y from 'yjs';
import { createSticky, getStickyText, initDoc, objectSnapshot, snapshot } from '../../src/shared/board-model';
import { DEFAULT_TEXT_SIZE, STICKY_SIZE_WORLD } from '../../src/shared/config';
import { readText } from '../../src/shared/objects/text';
import { screenToWorld } from '../../src/client/canvas/camera';
import type { ConnectionState } from '../../src/client/sync/connectBoard';
import { CLOSE_BOARD_LOAD_FAILED } from '../../src/shared/protocol';
import { FakeProvider } from './fakeProvider';
import { key, noteEl, pointer, renderApp, setCamera } from './helpers';

function freshDoc() {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

const selectButton = () => screen.getByRole('button', { name: 'Select (V)' });
const textButton = () => screen.getByRole('button', { name: 'Text (T)' });

function viewport() {
  return screen.getByTestId('board-viewport');
}

/** Renders the whole App on `doc`, with its board connection driven by `provider` (as LoadFailed.test does). */
async function renderConnectedApp(provider: FakeProvider, doc: Y.Doc) {
  vi.doMock('../../src/client/sync/connectBoard', async (importOriginal) => {
    const real = await importOriginal<typeof import('../../src/client/sync/connectBoard')>();
    return {
      ...real,
      connectBoard: (_doc: Y.Doc, _id: string, onState: (s: ConnectionState) => void) => {
        const stop = real.trackConnectionState(provider, onState);
        return { destroy: stop };
      },
    };
  });
  const { App } = await import('../../src/client/App');
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
  return render(<App boardId="AbCdEfGhIjKlMnOpQr_-09" doc={doc} />);
}

afterEach(() => {
  vi.doUnmock('../../src/client/sync/connectBoard');
  vi.resetModules();
});

describe('tool mode and Text tool (text.tool_ui)', () => {
  it('TC-14 T makes Text active with its button pressed; Escape and V return to Select', () => {
    renderApp(freshDoc());
    expect(selectButton()).toHaveAttribute('aria-pressed', 'true');
    expect(textButton()).toHaveAttribute('aria-pressed', 'false');
    expect(key('t', document.body)).toBe(true);
    expect(textButton()).toHaveAttribute('aria-pressed', 'true');
    expect(selectButton()).toHaveAttribute('aria-pressed', 'false');
    expect(viewport()).toHaveClass('board-viewport--placing');
    key('Escape', document.body);
    expect(selectButton()).toHaveAttribute('aria-pressed', 'true');
    expect(viewport()).not.toHaveClass('board-viewport--placing');
    key('T', document.body);
    expect(textButton()).toHaveAttribute('aria-pressed', 'true');
    key('v', document.body);
    expect(selectButton()).toHaveAttribute('aria-pressed', 'true');
    expect(textButton()).toHaveAttribute('aria-pressed', 'false');
    // The buttons do the same.
    act(() => textButton().click());
    expect(textButton()).toHaveAttribute('aria-pressed', 'true');
    act(() => selectButton().click());
    expect(selectButton()).toHaveAttribute('aria-pressed', 'true');
  });

  it('Escape with the Text tool active returns to Select without clearing the selection or creating anything', () => {
    const doc = freshDoc();
    const id = createSticky(doc, { x: 100, y: 100 });
    renderApp(doc);
    act(() => noteEl(id).focus());
    expect(window.__vidi6!.selection!()).toEqual([id]);
    key('t', document.body);
    key('Escape', document.body);
    expect(selectButton()).toHaveAttribute('aria-pressed', 'true');
    expect(window.__vidi6!.selection!()).toEqual([id]);
    expect(objectSnapshot(doc)).toHaveLength(1);
  });

  it('TC-15 on a board that failed to load T is ignored and the Text button is disabled', async () => {
    const provider = new FakeProvider();
    await renderConnectedApp(provider, freshDoc());
    provider.connect();
    // Active Text reverts to Select when the board stops being editable.
    key('t', document.body);
    expect(textButton()).toHaveAttribute('aria-pressed', 'true');
    provider.closedByServer(CLOSE_BOARD_LOAD_FAILED);
    expect(textButton()).toBeDisabled();
    expect(selectButton()).toHaveAttribute('aria-pressed', 'true');
    expect(key('t', document.body)).toBe(false);
    expect(textButton()).toHaveAttribute('aria-pressed', 'false');
    act(() => textButton().click());
    expect(textButton()).toHaveAttribute('aria-pressed', 'false');
    expect(viewport()).not.toHaveClass('board-viewport--placing');
  });

  it('TC-16 T while editing a note types "t" and leaves the tool alone', async () => {
    const doc = freshDoc();
    const id = createSticky(doc, { x: 100, y: 100 });
    renderApp(doc);
    act(() => noteEl(id).focus());
    key('Enter', noteEl(id));
    const editor = screen.getByRole('textbox', { name: 'Note text' });
    expect(editor).toHaveFocus();
    const user = userEvent.setup({ advanceTimers: () => {} });
    await user.keyboard('tT');
    expect(getStickyText(doc, id)!.toString()).toBe('tT');
    expect(selectButton()).toHaveAttribute('aria-pressed', 'true');
    expect(textButton()).toHaveAttribute('aria-pressed', 'false');
  });

  it('TC-17 with Text active a click on the board creates text at the world point, returns to Select and edits it', () => {
    const doc = freshDoc();
    renderApp(doc);
    const cam = { x: 100, y: 50, zoom: 2 };
    setCamera(cam);
    key('t', document.body);
    pointer(viewport(), 'down', 300, 200);
    expect(objectSnapshot(doc)).toHaveLength(0); // created on release (a click)
    pointer(viewport(), 'up', 300, 200);
    const objects = objectSnapshot(doc);
    expect(objects).toHaveLength(1);
    const t = readText(doc, objects[0].id)!;
    const at = screenToWorld(cam, { x: 300, y: 200 });
    expect({ x: t.x, y: t.y }).toEqual(at);
    expect(t.size).toBe(DEFAULT_TEXT_SIZE);
    expect(selectButton()).toHaveAttribute('aria-pressed', 'true');
    const editor = screen.getByRole('textbox', { name: 'Text' });
    expect(editor).toHaveFocus();
    expect(document.querySelector(`[data-text-id="${t.id}"]`)).toContainElement(editor);
    expect(window.__vidi6!.selection!()).toEqual([t.id]);
  });

  it('a Text tool click on top of a note creates text on top at that point, without selecting or dragging the note', () => {
    const doc = freshDoc();
    const noteId = createSticky(doc, { x: STICKY_SIZE_WORLD / 2, y: STICKY_SIZE_WORLD / 2 });
    renderApp(doc);
    setCamera({ x: 0, y: 0, zoom: 1 });
    key('t', document.body);
    const el = noteEl(noteId);
    pointer(el, 'down', 50, 60);
    pointer(el, 'up', 50, 60);
    const text = objectSnapshot(doc).find((o) => o.type === 'text')!;
    expect(text).toMatchObject({ x: 50, y: 60 });
    expect(text.z).toBeGreaterThan(snapshot(doc)[0].z);
    expect(snapshot(doc)[0]).toMatchObject({ x: 0, y: 0 });
    expect(window.__vidi6!.selection!()).toEqual([text.id]);
  });

  it('TC-18 N still creates a sticky note in the centre of the view', () => {
    const doc = freshDoc();
    renderApp(doc);
    const cam = { x: -200, y: 300, zoom: 0.5 };
    setCamera(cam);
    expect(key('n', document.body)).toBe(true);
    const notes = snapshot(doc);
    expect(notes).toHaveLength(1);
    const centre = screenToWorld(cam, { x: window.innerWidth / 2, y: window.innerHeight / 2 });
    expect(notes[0].x + notes[0].width / 2).toBeCloseTo(centre.x);
    expect(notes[0].y + notes[0].height / 2).toBeCloseTo(centre.y);
    expect(screen.getByRole('textbox', { name: 'Note text' })).toHaveFocus();
    expect(selectButton()).toHaveAttribute('aria-pressed', 'true');
  });
});
