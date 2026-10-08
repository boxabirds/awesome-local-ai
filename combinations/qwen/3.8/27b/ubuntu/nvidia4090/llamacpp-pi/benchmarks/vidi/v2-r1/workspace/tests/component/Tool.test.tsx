// Story 9 component tests: the Text tool state and activation (TC-14 to TC-18).
//
// The Text tool is a client-only toggle: pressing T (or the toolbar button)
// arms the "next click creates a text" mode; clicking the viewport creates
// the text and returns to Select; Escape cancels; V re-arms Select. While
// editing, letter shortcuts go to the caret, not the tool; while the board
// cannot be edited, the tool is disabled entirely.
//
// The y-websocket provider is mocked for the whole file so TC-15 can drive
// the load-failure state deterministically; in the other tests the fake
// simply stays idle (the mocked board API reports the board as existing).

import { describe, it, expect, vi } from 'vitest';
import { render, act, screen, fireEvent } from '@testing-library/react';
import { App, canEdit } from '../../src/client/App';
import { screenToWorld } from '../../src/client/canvas/camera';
import { click, flushRaf, hooks, noteText, renderApp, typeIntoEditor } from './helpers';

function theNote(): HTMLElement {
  const el = screen.queryByTestId('sticky-note');
  if (!el) throw new Error('no sticky note rendered');
  return el as HTMLElement;
}

function editor(): HTMLTextAreaElement {
  const el = screen.queryByTestId('sticky-editor');
  if (!el) throw new Error('no sticky editor rendered');
  return el as HTMLTextAreaElement;
}

function dblclick(el: Element): void {
  fireEvent.dblClick(el);
}

/** Toolbar buttons by accessible name (stable: labels have no digits). */
const selectButton = () => screen.getByRole('button', { name: 'Select (V)' });
const textButton = () => screen.getByRole('button', { name: 'Text (T)' });

/**
 * A stand-in for WebsocketProvider: records `on()` handlers so tests can
 * emit 'connection-close' and 'sync' events on demand.
 */
const hoisted = vi.hoisted(() => {
  const instances: Array<{
    emitClose(code: number | null): void;
    emitSync(synced: boolean): void;
  }> = [];
  class FakeProvider {
    handlers: Record<string, Array<(...args: unknown[]) => void>> = {};
    wsconnected = false;
    constructor(_url: string, _room: string, _doc: unknown, _opts: unknown) {
      instances.push(this);
    }
    on(event: string, cb: (...args: unknown[]) => void) {
      (this.handlers[event] ??= []).push(cb);
      return this;
    }
    destroy() {}
    emitClose(code: number | null) {
      (this.handlers['connection-close'] ?? []).forEach((cb) =>
        cb(code === null ? null : { code, reason: '' }, this),
      );
    }
    emitSync(synced: boolean) {
      this.wsconnected = true;
      (this.handlers['sync'] ?? []).forEach((cb) => cb(synced, this));
    }
  }
  return { instances, FakeProvider };
});

vi.mock('y-websocket', () => ({ WebsocketProvider: hoisted.FakeProvider }));

describe('text tool (component)', () => {
  it('TC-14: T activates, Escape reverts, V re-activates Select (aria-pressed)', async () => {
    await renderApp();
    expect(textButton()).toHaveAttribute('aria-pressed', 'false');
    expect(selectButton()).toHaveAttribute('aria-pressed', 'true');

    fireEvent.keyDown(window, { key: 't' });
    expect(textButton()).toHaveAttribute('aria-pressed', 'true');
    expect(selectButton()).toHaveAttribute('aria-pressed', 'false');

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(selectButton()).toHaveAttribute('aria-pressed', 'true');
    expect(textButton()).toHaveAttribute('aria-pressed', 'false');

    // V also returns to Select.
    fireEvent.keyDown(window, { key: 't' });
    expect(textButton()).toHaveAttribute('aria-pressed', 'true');
    fireEvent.keyDown(window, { key: 'v' });
    expect(selectButton()).toHaveAttribute('aria-pressed', 'true');
    expect(textButton()).toHaveAttribute('aria-pressed', 'false');
  });

  it('TC-15: with canEdit false the Text tool is disabled and T does nothing', async () => {
    render(<App />);
    await screen.findByTestId('board-root');
    const provider = hoisted.instances[hoisted.instances.length - 1]!;

    // Simulate the load failure: the board cannot be loaded → editing locked.
    act(() => provider.emitClose(4500));
    expect(canEdit('load_failed')).toBe(false);

    expect(textButton()).toBeDisabled();
    fireEvent.keyDown(window, { key: 't' });
    expect(textButton()).toHaveAttribute('aria-pressed', 'false');
  });

  it('TC-16: while editing a note the T shortcut goes to the caret, not the tool', async () => {
    await renderApp();
    let id = '';
    act(() => {
      id = hooks().createNoteAt(0, 0, 'yellow', '') ?? '';
    });
    const el = theNote();
    click(el);
    dblclick(el);
    const ta = editor();
    expect(ta).toHaveFocus();

    // The shortcut is ignored while the note editor is focused.
    fireEvent.keyDown(ta, { key: 't' });
    expect(textButton()).toHaveAttribute('aria-pressed', 'false');

    // Typing works as usual.
    typeIntoEditor(ta, 't');
    expect(noteText(id!)).toBe('t');
    expect(theNote()).toBeInTheDocument();
  });

  it('TC-17: a click with the Text tool creates the text at that exact world point, then returns to Select', async () => {
    await renderApp();
    const cam = hooks().getCamera();

    fireEvent.keyDown(window, { key: 't' });
    expect(textButton()).toHaveAttribute('aria-pressed', 'true');

    const vp = screen.getByTestId('board-viewport');
    fireEvent.pointerDown(vp, { pointerId: 1, clientX: 300, clientY: 200, bubbles: true });
    fireEvent.pointerUp(vp, { pointerId: 1, clientX: 300, clientY: 200, bubbles: true });
    await flushRaf();

    const world = screenToWorld(cam, { x: 300, y: 200 });
    const objs = hooks().getObjects();
    expect(objs).toHaveLength(1);
    expect(objs[0]!.type).toBe('text');
    expect(objs[0]!.x).toBeCloseTo(world.x, 5);
    expect(objs[0]!.y).toBeCloseTo(world.y, 5);

    // Back to Select, and the new text is immediately editable.
    expect(selectButton()).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('text-editor')).toBeInTheDocument();
  });

  it('TC-18: the N shortcut still creates a sticky note, editable, and returns to Select', async () => {
    await renderApp();
    const cam = hooks().getCamera();

    fireEvent.keyDown(window, { key: 'n' });
    const notes = hooks().getNotes();
    expect(notes).toHaveLength(1);
    // The note is centred on the viewport centre.
    expect(notes[0]!.x).toBeCloseTo(window.innerWidth / 2 + cam.x - 100, 5);
    expect(notes[0]!.y).toBeCloseTo(window.innerHeight / 2 + cam.y - 100, 5);
    expect(screen.getByTestId('sticky-editor')).toBeInTheDocument();
    expect(selectButton()).toHaveAttribute('aria-pressed', 'true');
  });
});
