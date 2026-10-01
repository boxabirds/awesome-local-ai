import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Y from 'yjs';
import type { ConnectionState } from '../../src/client/sync/connectBoard';

const hook: { doc?: Y.Doc; setState?: (s: ConnectionState) => void } = {};

vi.mock('../../src/client/sync/connectBoard', () => ({
  connectBoard: (doc: Y.Doc, _id: string, onState: (s: ConnectionState) => void) => {
    hook.doc = doc;
    hook.setState = onState;
    onState('connecting');
    return { destroy() {} };
  },
}));

const { App } = await import('../../src/client/App');
const { createSticky, getStickyText, snapshot } = await import('../../src/shared/board-model');
const { notes, press, moveTo, release, viewport } = await import('./helpers');

beforeEach(() => {
  hook.doc = undefined;
});
afterEach(cleanup);

function setState(s: ConnectionState) {
  act(() => hook.setState?.(s));
}

describe('load_failed edit lock', () => {
  it('TC-23: no mutation from dblclick, toolbar button, Delete, drag or typing', () => {
    render(<App boardId="b-1" />);
    const doc = hook.doc as Y.Doc;
    let id = '';
    act(() => {
      id = createSticky(doc, { x: 300, y: 300 }) as string;
      getStickyText(doc, id)?.insert(0, 'kept');
    });
    // Select the note while the board is still editable, then lose the board.
    const note = notes()[0];
    press(note, 10, 10);
    release(note, 10, 10);
    setState('load_failed');

    let updates = 0;
    doc.on('update', () => (updates += 1));
    const before = JSON.stringify(snapshot(doc));

    expect(screen.getByText("This board couldn't be loaded. Retrying…").getAttribute('role')).toBe('status');
    const button = screen.getByRole('button', { name: 'Sticky note (N)' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    fireEvent.doubleClick(viewport(), { clientX: 400, clientY: 400 });
    fireEvent.keyDown(window, { key: 'Delete' });
    fireEvent.keyDown(window, { key: 'Enter' });
    const target = notes()[0];
    press(target, 10, 10);
    moveTo(target, 80, 80);
    release(target, 80, 80);
    fireEvent.doubleClick(target);

    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('toolbar', { name: 'Note tools' })).toBeNull();
    expect(updates).toBe(0);
    expect(JSON.stringify(snapshot(doc))).toBe(before);
    expect(notes()).toHaveLength(1);
  });

  it('editing is available again once the board loads', () => {
    render(<App boardId="b-2" />);
    setState('load_failed');
    const button = screen.getByRole('button', { name: 'Sticky note (N)' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    setState('connected');
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    expect(notes()).toHaveLength(1);
  });
});
