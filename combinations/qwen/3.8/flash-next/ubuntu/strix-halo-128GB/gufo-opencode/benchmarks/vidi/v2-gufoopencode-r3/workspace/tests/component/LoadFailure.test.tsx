import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { ConnectionStatus } from '../../src/client/sync/ConnectionStatus';
import { createSyncStatusMachine } from '../../src/client/sync/connectBoard';
import { createSticky, initDoc } from '../../src/shared/board-model';
import { CLOSE_BOARD_LOAD_FAILED, CLOSE_STORAGE_FAILURE } from '../../src/shared/protocol';

// A mutable status holder drives the board's load-failed gate without a real
// provider; useConnectionStatus is stubbed to read it, everything else (the
// badge, the edit gate, the note components) stays real.
const holder = vi.hoisted(() => ({ status: 'connected' as string }));
vi.mock('../../src/client/sync/ConnectionStatus', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/client/sync/ConnectionStatus')>();
  return { ...actual, useConnectionStatus: () => holder.status as never };
});

const { BoardView, canEdit } = await import('../../src/client/pages/BoardPage');

function newBoardDoc(withNote = false): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  if (withNote) act(() => void createSticky(doc, { x: 10, y: 10 }));
  return doc;
}

function objectCount(doc: Y.Doc): number {
  return doc.getMap('objects').size;
}

beforeEach(() => {
  vi.useFakeTimers();
  holder.status = 'connected';
});

afterEach(() => {
  vi.useRealTimers();
});

describe('persist.client_status badge (TC-22)', () => {
  it('TC-22 load_failed renders a red role=status message', () => {
    render(<ConnectionStatus status="load_failed" />);
    const badge = screen.getByRole('status');
    expect(badge).toHaveTextContent("This board couldn't be loaded. Retrying…");
    expect(badge.className).toContain('load_failed');
  });

  it('TC-22 canEdit is false only for load_failed', () => {
    expect(canEdit('load_failed')).toBe(false);
    expect(canEdit('connecting')).toBe(true);
    expect(canEdit('connected')).toBe(true);
    expect(canEdit('reconnecting')).toBe(true);
    expect(canEdit('confirmed')).toBe(true);
  });
});

describe('persist.client_status close-code mapping (TC-28)', () => {
  it('TC-28 close 1011 then 1003 map to reconnecting, never load_failed', () => {
    const machine = createSyncStatusMachine();
    machine.synced(true);
    expect(machine.status()).toBe('connected');

    // Storage failure: the provider closes 1011 then reports disconnected.
    machine.close(CLOSE_STORAGE_FAILURE);
    machine.providerStatus('disconnected');
    expect(machine.status()).toBe('reconnecting');
    expect(canEdit(machine.status())).toBe(true);

    // Bad data on a later attempt: 1003 likewise stays reconnecting.
    machine.close(1003);
    machine.providerStatus('disconnected');
    expect(machine.status()).toBe('reconnecting');
    expect(canEdit(machine.status())).toBe(true);
  });

  it('close 4500 marks load_failed and a later successful sync recovers to connected', () => {
    const machine = createSyncStatusMachine();
    machine.synced(true);
    machine.close(CLOSE_BOARD_LOAD_FAILED);
    machine.providerStatus('disconnected');
    expect(machine.status()).toBe('load_failed');
    // Provider keeps retrying: the state stays load_failed through "connecting".
    machine.providerStatus('connecting');
    expect(machine.status()).toBe('load_failed');
    expect(canEdit(machine.status())).toBe(false);
    // First successful sync after a repair returns to a healthy state, no reload.
    machine.synced(true);
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(machine.status()).toBe('connected');
    expect(canEdit(machine.status())).toBe(true);
  });
});

describe('persist.client_status edit gate (TC-23)', () => {
  it('TC-23 double-click creates a note while connected', () => {
    const doc = newBoardDoc();
    render(<BoardView doc={doc} />);
    const before = objectCount(doc);
    fireEvent.doubleClick(screen.getByTestId('board-viewport'), { clientX: 300, clientY: 300 });
    expect(objectCount(doc)).toBe(before + 1);
  });

  it('TC-23 load_failed board: double-click, Sticky note button and Delete do not mutate', () => {
    const doc = newBoardDoc(true);
    holder.status = 'connected';
    const { rerender } = render(<BoardView doc={doc} />);

    // Select the existing note while still connected so Delete has a target.
    const note = screen.getAllByTestId('sticky-note')[0];
    fireEvent.pointerDown(note, { clientX: 100, clientY: 100, pointerId: 1, button: 0 });
    fireEvent.pointerUp(note, { clientX: 100, clientY: 100, pointerId: 1 });

    // Switch the board to load-failed.
    holder.status = 'load_failed';
    act(() => {
      rerender(<BoardView doc={doc} />);
    });
    const before = objectCount(doc);

    // Sticky note button is disabled and its click is a no-op.
    const button = screen.getByRole('button', { name: 'Sticky note (N)' });
    expect(button).toBeDisabled();
    fireEvent.click(button);

    // Double-click on empty board does not create.
    fireEvent.doubleClick(screen.getByTestId('board-viewport'), { clientX: 300, clientY: 300 });

    // Delete on the selected note does not remove it.
    fireEvent.keyDown(window, { key: 'Delete' });

    expect(objectCount(doc)).toBe(before);
  });
});
