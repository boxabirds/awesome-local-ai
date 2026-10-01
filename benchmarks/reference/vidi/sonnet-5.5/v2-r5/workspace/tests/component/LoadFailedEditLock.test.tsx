import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Y from 'yjs';
import type { ConnectionState } from '../../src/client/sync/connectBoard';
import { newDoc } from './helpers';

const hoisted = vi.hoisted(() => ({ doc: null as unknown as Y.Doc, connection: 'load_failed' as string }));

vi.mock('../../src/client/board/useBoardDoc', async () => {
  const model = await import('../../src/shared/board-model');
  return {
    useBoardDoc: () => ({ doc: hoisted.doc, objects: model.snapshotObjects(hoisted.doc), connection: hoisted.connection }),
  };
});

vi.mock('../../src/shared/board-model', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/shared/board-model')>();
  return {
    ...actual,
    createSticky: vi.fn(actual.createSticky),
    moveObject: vi.fn(actual.moveObject),
    bringToFront: vi.fn(actual.bringToFront),
    setStickyColor: vi.fn(actual.setStickyColor),
    deleteObject: vi.fn(actual.deleteObject),
    moveObjects: vi.fn(actual.moveObjects),
    resizeObjects: vi.fn(actual.resizeObjects),
    bringObjectsToFront: vi.fn(actual.bringObjectsToFront),
    deleteObjects: vi.fn(actual.deleteObjects),
    getStickyText: vi.fn(actual.getStickyText),
  };
});

import * as model from '../../src/shared/board-model';
import { App } from './TestApp';

const MUTATIONS = [model.createSticky, model.moveObject, model.bringToFront, model.setStickyColor, model.deleteObject,
  model.moveObjects, model.resizeObjects, model.bringObjectsToFront, model.deleteObjects];

function setup(connection: ConnectionState) {
  hoisted.connection = connection;
  hoisted.doc = newDoc();
  // Seed through the real implementation, then clear the call history.
  model.createSticky(hoisted.doc, { x: 300, y: 300 });
  vi.clearAllMocks();
  return render(<App />);
}

describe('App in load_failed (persist.client_status)', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => cleanup());

  it('TC-23 no gesture reaches the board model', async () => {
    setup('load_failed');
    const user = userEvent.setup();
    const board = screen.getByTestId('board-viewport');
    const button = screen.getByRole('button', { name: 'Sticky note (N)' });
    expect((button as HTMLButtonElement).disabled).toBe(true);

    fireEvent.doubleClick(board);
    await user.click(button);
    const note = screen.getByRole('group', { name: 'Sticky note' });
    fireEvent.pointerDown(note, { clientX: 10, clientY: 10, pointerId: 1, button: 0 });
    fireEvent.pointerMove(note, { clientX: 80, clientY: 80, pointerId: 1 });
    fireEvent.pointerUp(note, { clientX: 80, clientY: 80, pointerId: 1 });
    fireEvent.doubleClick(note);
    await user.keyboard('typed');
    fireEvent.keyDown(note, { key: 'Enter' });
    note.focus();
    await user.keyboard('{Delete}');
    fireEvent.keyDown(window, { key: 'Backspace' });

    expect(note.getAttribute('data-editing')).toBe('false');
    expect(note.querySelector('textarea')).toBeNull();
    expect(screen.queryByRole('toolbar', { name: 'Note tools' })).toBeNull();
    for (const fn of MUTATIONS) expect(fn).not.toHaveBeenCalled();
    expect(model.snapshot(hoisted.doc)).toHaveLength(1);
    expect(model.snapshot(hoisted.doc)[0]).toMatchObject({ x: 200, y: 200, text: '' });
  });

  it('control: when connected the same double-click does create a note', () => {
    setup('connected');
    fireEvent.doubleClick(screen.getByTestId('board-viewport'));
    expect(model.createSticky).toHaveBeenCalledTimes(1);
  });

  it('control: when reconnecting the Sticky note button is enabled', () => {
    setup('reconnecting');
    expect((screen.getByRole('button', { name: 'Sticky note (N)' }) as HTMLButtonElement).disabled).toBe(false);
  });
});
