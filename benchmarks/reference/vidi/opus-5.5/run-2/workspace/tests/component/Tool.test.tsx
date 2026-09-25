/** Story 9 tool mode and Text tool (TC-14 to TC-18): useTool, toolbar buttons, click-to-create. */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { App } from '../../src/client/App';
import { createSticky, snapshot, snapshotObjects } from '../../src/shared/board-model';
import { isTextSnapshot } from '../../src/shared/objects/text';
import { newBoardId } from '../../src/shared/board-id';
import { DEFAULT_TEXT_SIZE, STICKY_SIZE_WORLD } from '../../src/shared/config';
import { CLOSE_BOARD_LOAD_FAILED } from '../../src/shared/protocol';
import { screenToWorld } from '../../src/client/canvas/camera';
import { countUpdates, editor, noteEl, viewportEl } from './boardHelpers';
import { fakeProviders } from './fakeProvider';
import { dispatch, readCamera } from './helpers';

const fakes = fakeProviders();

function selectButton(): HTMLElement {
  return screen.getByRole('button', { name: 'Select (V)' });
}
function textButton(): HTMLElement {
  return screen.getByRole('button', { name: 'Text (T)' });
}
function key(k: string, target: EventTarget = window): KeyboardEvent {
  return dispatch(target, new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
}
function textObjects() {
  return snapshotObjects(doc).filter(isTextSnapshot);
}

let doc: Y.Doc;

beforeEach(() => {
  fakes.reset();
  doc = new Y.Doc();
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('text.tool_ui', () => {
  it('TC-14 T activates Text (pressed); Escape and V return to Select', () => {
    render(<App doc={doc} />);
    expect(selectButton()).toHaveAttribute('aria-pressed', 'true');
    expect(textButton()).toHaveAttribute('aria-pressed', 'false');

    key('t');
    expect(textButton()).toHaveAttribute('aria-pressed', 'true');
    expect(selectButton()).toHaveAttribute('aria-pressed', 'false');
    expect(viewportEl().style.cursor).toBe('text');

    key('Escape');
    expect(selectButton()).toHaveAttribute('aria-pressed', 'true');
    expect(viewportEl().style.cursor).not.toBe('text');

    key('T');
    expect(textButton()).toHaveAttribute('aria-pressed', 'true');
    key('v');
    expect(selectButton()).toHaveAttribute('aria-pressed', 'true');

    // The buttons do the same, and nothing is created by switching tools.
    fireEvent.click(textButton());
    expect(textButton()).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(selectButton());
    expect(selectButton()).toHaveAttribute('aria-pressed', 'true');
    expect(snapshotObjects(doc)).toHaveLength(0);
  });

  it('TC-15 load-failed board: Text button disabled, T ignored, active Text reverts to Select', () => {
    render(<App boardId={newBoardId()} doc={doc} createProvider={fakes.createProvider} />);
    fakes.provider().open();
    key('t');
    expect(textButton()).toHaveAttribute('aria-pressed', 'true');

    fakes.provider().drop(CLOSE_BOARD_LOAD_FAILED);
    expect(textButton()).toBeDisabled();
    expect(selectButton()).toHaveAttribute('aria-pressed', 'true');
    const updates = countUpdates(doc);
    key('t');
    expect(textButton()).toHaveAttribute('aria-pressed', 'false');
    fireEvent.pointerDown(viewportEl(), { clientX: 300, clientY: 200, button: 0, pointerId: 1 });
    expect(updates.count).toBe(0);
    expect(textObjects()).toHaveLength(0);
  });

  it('TC-16 T typed while editing a sticky note is a character, the tool is unchanged', () => {
    render(<App doc={doc} />);
    act(() => {
      createSticky(doc, { x: 0, y: 0 });
    });
    const id = snapshot(doc)[0]!.id;
    fireEvent.doubleClick(noteEl(id));
    const ed = editor()!;
    const event = key('t', ed);
    // The editor keeps the key (the browser then types it); no board shortcut ran.
    expect(event.defaultPrevented).toBe(false);
    ed.value = 't';
    fireEvent.input(ed);
    expect(snapshot(doc)[0]!.text).toBe('t');
    expect(selectButton()).toHaveAttribute('aria-pressed', 'true');
    expect(textButton()).toHaveAttribute('aria-pressed', 'false');
  });

  it('TC-17 Text active, click the board → text at the world point, Select again, editing it', () => {
    render(<App doc={doc} />);
    key('t');
    const camera = readCamera();
    const point = { x: 300, y: 200 };
    fireEvent.pointerDown(viewportEl(), { clientX: point.x, clientY: point.y, button: 0, pointerId: 1 });
    fireEvent.pointerUp(viewportEl(), { clientX: point.x, clientY: point.y, button: 0, pointerId: 1 });

    const texts = textObjects();
    expect(texts).toHaveLength(1);
    const world = screenToWorld(camera, point);
    expect(texts[0]!.x).toBeCloseTo(world.x);
    expect(texts[0]!.y).toBeCloseTo(world.y);
    expect(texts[0]!.size).toBe(DEFAULT_TEXT_SIZE);
    expect(selectButton()).toHaveAttribute('aria-pressed', 'true');
    const ed = screen.getByRole('textbox', { name: 'Text' });
    expect(ed).toHaveFocus();
    expect(ed.closest('[data-id]')).toHaveAttribute('data-id', texts[0]!.id);
  });

  it('TC-17 a Text tool click on top of a sticky note creates text on top there', () => {
    render(<App doc={doc} />);
    act(() => {
      createSticky(doc, { x: 0, y: 0 });
    });
    const note = snapshot(doc)[0]!;
    key('t');
    fireEvent.pointerDown(noteEl(note.id), { clientX: 10, clientY: 10, button: 0, pointerId: 1 });
    const texts = textObjects();
    expect(texts).toHaveLength(1);
    expect(texts[0]!.z).toBeGreaterThan(note.z);
    // The note did not move or get selected for dragging.
    expect(snapshot(doc)[0]).toEqual(note);
  });

  it('TC-18 N still creates a sticky note in the centre of the view', () => {
    render(<App doc={doc} />);
    key('n');
    const notes = snapshot(doc);
    expect(notes).toHaveLength(1);
    const camera = readCamera();
    const centre = screenToWorld(camera, { x: window.innerWidth / 2, y: window.innerHeight / 2 });
    expect(notes[0]!.x + STICKY_SIZE_WORLD / 2).toBeCloseTo(centre.x);
    expect(notes[0]!.y + STICKY_SIZE_WORLD / 2).toBeCloseTo(centre.y);
    expect(editor()).not.toBeNull();
    expect(selectButton()).toHaveAttribute('aria-pressed', 'true');
  });
});
