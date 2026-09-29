import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useEffect, useState } from 'react';
import * as Y from 'yjs';
import { ConnectionStatus } from '../../src/client/sync/ConnectionStatus';
import { trackConnectionState, type ConnectionState } from '../../src/client/sync/connectBoard';
import { canEdit } from '../../src/client/App';
import { createSticky, getStickyText, initDoc, snapshot } from '../../src/shared/board-model';
import { CLOSE_BOARD_LOAD_FAILED, CLOSE_STORAGE_FAILURE } from '../../src/shared/protocol';
import { FakeProvider } from './fakeProvider';
import { FRAME_MS, countUpdates, key, noteEl, noteElements, pointer, press } from './helpers';

const LOAD_FAILED_TEXT = "This board couldn't be loaded. Retrying…";

function badge() {
  return screen.queryByRole('status', { name: 'Connection status' });
}

function Harness(props: { provider: FakeProvider; onState?: (s: ConnectionState) => void }) {
  const [state, setState] = useState<ConnectionState>('connecting');
  useEffect(
    () =>
      trackConnectionState(props.provider, (s) => {
        setState(s);
        props.onState?.(s);
      }),
    [props.provider, props],
  );
  return <ConnectionStatus state={state} />;
}

/** Renders the whole App on `doc`, with its board connection driven by `provider`. */
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
  const utils = render(<App boardId="AbCdEfGhIjKlMnOpQr_-09" doc={doc} />);
  return { ...utils, viewport: screen.getByTestId('board-viewport') };
}

function stickyButton() {
  return screen.getByRole('button', { name: 'Sticky note' });
}

afterEach(() => {
  vi.useRealTimers();
  vi.doUnmock('../../src/client/sync/connectBoard');
  vi.resetModules();
});

describe('persist.client_status: badge', () => {
  it('TC-22 load_failed shows the red "couldn\'t be loaded" message as a status region', () => {
    render(<ConnectionStatus state="load_failed" />);
    const el = screen.getByRole('status', { name: 'Connection status' });
    expect(el).toHaveTextContent(LOAD_FAILED_TEXT);
    expect(el.textContent).toBe(LOAD_FAILED_TEXT);
    expect(el).toHaveAttribute('data-state', 'load_failed');
    expect(el).toHaveClass('connection-status--load_failed'); // the red variant in styles.css
  });

  it('canEdit is false only for load_failed', () => {
    const states: ConnectionState[] = ['connecting', 'connected', 'reconnecting', 'confirmed', 'load_failed'];
    expect(states.filter((s) => !canEdit(s))).toEqual(['load_failed']);
  });
});

describe('persist.client_status: close-code mapping', () => {
  it('4500 before the first sync → load_failed; a later sync → connected', () => {
    const provider = new FakeProvider();
    render(<Harness provider={provider} />);
    provider.status('connecting');
    provider.closedByServer(CLOSE_BOARD_LOAD_FAILED);
    expect(badge()).toHaveTextContent(LOAD_FAILED_TEXT);
    // Retries keep failing: the message stays (not "Connecting…" or "Reconnecting…").
    provider.closedByServer(CLOSE_BOARD_LOAD_FAILED);
    expect(badge()).toHaveTextContent(LOAD_FAILED_TEXT);
    provider.connect();
    expect(badge()).toBeNull();
  });

  it('4500 after having been connected → load_failed (not Reconnecting…); recovery → connected', () => {
    const provider = new FakeProvider();
    const states: ConnectionState[] = [];
    render(<Harness provider={provider} onState={(s) => states.push(s)} />);
    provider.connect();
    provider.closedByServer(CLOSE_BOARD_LOAD_FAILED);
    expect(badge()).toHaveTextContent(LOAD_FAILED_TEXT);
    provider.connect();
    expect(badge()).toBeNull();
    expect(states).toEqual(['connecting', 'connected', 'load_failed', 'connected']);
  });

  it('1011 (storage failure) → reconnecting, not load_failed', () => {
    const provider = new FakeProvider();
    render(<Harness provider={provider} />);
    provider.connect();
    provider.closedByServer(CLOSE_STORAGE_FAILURE);
    expect(badge()).toHaveTextContent('Reconnecting…');
  });

  it('a different close after load_failed leaves the load-failed state', () => {
    const provider = new FakeProvider();
    render(<Harness provider={provider} />);
    provider.connect();
    provider.closedByServer(CLOSE_BOARD_LOAD_FAILED);
    provider.closedByServer(CLOSE_STORAGE_FAILURE);
    expect(badge()).toHaveTextContent('Reconnecting…');
  });
});

describe('persist.client_status: edit lock', () => {
  function docWithNote() {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createSticky(doc, { x: 0, y: 0 });
    return { doc, id };
  }

  it('TC-23 while load_failed no gesture changes the board', async () => {
    const provider = new FakeProvider();
    const { doc, id } = docWithNote();
    const before = JSON.stringify(snapshot(doc));
    const { viewport } = await renderConnectedApp(provider, doc);
    provider.connect();
    provider.closedByServer(CLOSE_BOARD_LOAD_FAILED);
    expect(badge()).toHaveTextContent(LOAD_FAILED_TEXT);
    expect(stickyButton()).toBeDisabled();

    const updates = countUpdates(doc, () => {
      // Double-click on empty board.
      act(() => {
        fireEvent.doubleClick(viewport, { clientX: 400, clientY: 300 });
      });
      // The (disabled) Sticky note button.
      act(() => stickyButton().click());
      fireEvent.click(stickyButton());
      // Select the note, then Delete and Backspace.
      press(noteEl(id));
      key('Delete', noteEl(id));
      key('Backspace', noteEl(id));
      // Drag the note well past the threshold.
      pointer(noteEl(id), 'down', 10, 10);
      pointer(noteEl(id), 'move', 60, 80);
      act(() => {
        vi.advanceTimersByTime(FRAME_MS);
      });
      pointer(noteEl(id), 'move', 120, 140);
      pointer(noteEl(id), 'up', 120, 140);
      // Try to open the editor (double-click, Enter) and type.
      act(() => {
        fireEvent.doubleClick(noteEl(id));
      });
      key('Enter', noteEl(id));
    });
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('toolbar', { name: 'Note' })).toBeNull(); // no colour or delete buttons
    expect(updates).toBe(0);
    expect(JSON.stringify(snapshot(doc))).toBe(before);
    expect(noteElements()).toHaveLength(1);
  });

  it('an editor open when the load fails is closed and cannot write', async () => {
    const provider = new FakeProvider();
    const { doc, id } = docWithNote();
    await renderConnectedApp(provider, doc);
    provider.connect();
    act(() => {
      fireEvent.doubleClick(noteEl(id));
    });
    expect(screen.getByRole('textbox')).toBeInTheDocument();
    provider.closedByServer(CLOSE_BOARD_LOAD_FAILED);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(getStickyText(doc, id)!.toString()).toBe('');
  });

  it('editing comes back after a successful sync, without a reload', async () => {
    const provider = new FakeProvider();
    const { doc } = docWithNote();
    await renderConnectedApp(provider, doc);
    provider.closedByServer(CLOSE_BOARD_LOAD_FAILED);
    act(() => stickyButton().click());
    expect(snapshot(doc)).toHaveLength(1);

    provider.connect();
    expect(badge()).toBeNull();
    expect(stickyButton()).toBeEnabled();
    act(() => stickyButton().click());
    expect(snapshot(doc)).toHaveLength(2);
  });

  it('a storage failure (1011) does not lock the board', async () => {
    const provider = new FakeProvider();
    const { doc } = docWithNote();
    await renderConnectedApp(provider, doc);
    provider.connect();
    provider.closedByServer(CLOSE_STORAGE_FAILURE);
    expect(badge()).toHaveTextContent('Reconnecting…');
    act(() => stickyButton().click());
    expect(snapshot(doc)).toHaveLength(2);
  });
});
