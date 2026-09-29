// TC-23: when the connection state is 'load_failed' the board is fully viewable
// but not editable. Every mutation path is asserted to leave the model
// untouched - measured as "no update was ever handed to the provider", which is
// exactly what a model mutation would produce (the provider listens for doc
// updates the same way the real one does), plus the resulting DOM state.
import { describe, it, expect } from 'vitest';
import { act, fireEvent as rtlFireEvent, screen } from '@testing-library/react';
import type * as Y from 'yjs';
import {
  renderBoard,
  createViaToolbar,
  typeInto,
  escape,
  clickEmpty,
  fireEvent,
  notePos,
} from './stickyTestUtils.tsx';
import type { BoardProvider, ProviderFactory } from '../../src/client/collab/connectBoard.ts';
import { CLOSE_BOARD_LOAD_FAILED } from '../../src/shared/protocol.ts';

/**
 * A provider that behaves like the real one for the purposes of this test: it
 * records every doc update it would have sent to the server, and can emit the
 * close event the room sends when it cannot load the board.
 */
class TrackingProvider implements BoardProvider {
  /** Every update the provider would have put on the wire (== model mutations). */
  readonly sent: Uint8Array[] = [];
  destroyed = false;
  private handlers = new Map<string, Set<(p: never) => void>>();

  constructor(private readonly doc: Y.Doc) {
    // The real WebsocketProvider sends every update whose origin is not itself.
    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin !== this) this.sent.push(update);
    });
  }

  on(event: string, cb: (p: never) => void): void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(cb);
  }

  off(event: string, cb: (p: never) => void): void {
    this.handlers.get(event)?.delete(cb);
  }

  destroy(): void {
    this.destroyed = true;
  }

  emit(event: string, payload: unknown): void {
    this.handlers.get(event)?.forEach((cb) => cb(payload as never));
  }

  /** What the room does when it cannot read the board. */
  loadFailed(): void {
    this.emit('connection-close', { code: CLOSE_BOARD_LOAD_FAILED });
    this.emit('status', { status: 'disconnected' });
  }

  /** Count of model mutations so far, to assert a delta. */
  mark(): number {
    return this.sent.length;
  }
}

// The connection badge is the only [role=status] element with a data-state
// (the zoom hint shares role=status), so select it the way the e2e helpers do.
function badge(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[role="status"][data-state]');
}

function renderReadOnly(): {
  h: ReturnType<typeof renderBoard>;
  provider(): TrackingProvider;
} {
  let provider: TrackingProvider | null = null;
  const factory: ProviderFactory = (_url, _room, doc) => {
    provider = new TrackingProvider(doc);
    return provider;
  };
  const h = renderBoard(factory);
  return {
    h,
    provider() {
      if (!provider) throw new Error('provider was never created');
      return provider;
    },
  };
}

describe('TC-23 load_failed disables editing', () => {
  it('the create button is disabled and the red message is shown', () => {
    const { h, provider } = renderReadOnly();
    act(() => provider().loadFailed());

    expect(badge()).not.toBeNull();
    expect(badge()).toHaveAttribute('data-state', 'load_failed');
    expect(badge()).toHaveTextContent("This board couldn't be loaded");

    const button = screen.getByTestId('sticky-create') as HTMLButtonElement;
    expect(button).toBeDisabled();

    const before = provider().mark();
    fireEvent.click(button);
    expect(h.notes()).toHaveLength(0);
    expect(provider().sent.length).toBe(before);
  });

  it('creation, dragging, typing, recolouring and deleting all leave the model untouched', () => {
    const { h, provider } = renderReadOnly();

    // A note created while the board is still editable.
    createViaToolbar(h);
    typeInto(h, 'keep me');
    escape(h);
    expect(h.notes()).toHaveLength(1);

    act(() => provider().loadFailed());
    const before = provider().mark();
    const position = notePos(h.note(0));

    // Double-clicking empty board creates nothing.
    fireEvent.doubleClick(h.viewport());
    expect(h.notes()).toHaveLength(1);

    // The existing note cannot be dragged, and a press on it does not even
    // select it (nothing at all happens to it).
    clickEmpty(h);
    expect(h.note(0)).toHaveAttribute('data-selected', 'false');
    const note = h.note(0);
    fireEvent.pointerDown(note, { clientX: 400, clientY: 400, button: 0, pointerId: 11 });
    fireEvent.pointerMove(note, { clientX: 520, clientY: 480, pointerId: 11 });
    fireEvent.pointerUp(note, { clientX: 520, clientY: 480, pointerId: 11 });
    expect(notePos(h.note(0))).toEqual(position);
    expect(h.note(0)).toHaveAttribute('data-selected', 'false');
    expect(h.note(0)).toHaveAttribute('data-editable', 'false');

    // Typing is impossible: the note never opens an editor.
    fireEvent.doubleClick(h.note(0));
    expect(h.editor()).toBeNull();
    expect(h.note(0)).toHaveTextContent('keep me');

    // No colour or delete affordance is offered, and the keyboard shortcuts
    // cannot reach the model either.
    expect(screen.queryAllByTestId('note-toolbar')).toHaveLength(0);
    expect(screen.queryAllByTestId(/^swatch-/)).toHaveLength(0);
    expect(screen.queryAllByTestId('note-delete')).toHaveLength(0);
    fireEvent.keyDown(window, { key: 'Delete' });
    fireEvent.keyDown(window, { key: 'Backspace' });
    fireEvent.keyDown(window, { key: 'Enter' });

    expect(h.notes()).toHaveLength(1);
    expect(provider().sent.length).toBe(before);
  });

  it('a read-only note does not swallow presses - only editing is gated', () => {
    // The board itself cannot be panned in this jsdom harness (it has no measured
    // size), so navigation is asserted at its cause: an editable note swallows
    // the press so the board never pans under it (story 2's rule), and a
    // read-only note passes it through, leaving the board pannable.
    const { h, provider } = renderReadOnly();
    createViaToolbar(h);
    escape(h);

    const bodyHits = (): number => {
      let hits = 0;
      const listener = () => hits++;
      document.body.addEventListener('pointerdown', listener);
      rtlFireEvent.pointerDown(h.note(0), { clientX: 100, clientY: 100, button: 0, pointerId: 41 });
      document.body.removeEventListener('pointerdown', listener);
      return hits;
    };

    expect(bodyHits()).toBe(0); // editable: the press is swallowed

    act(() => provider().loadFailed());
    const before = provider().mark();
    expect(h.note(0)).toHaveAttribute('data-editable', 'false');
    expect(bodyHits()).toBe(1); // read-only: the board still gets the press

    expect(h.notes()).toHaveLength(1);
    expect(provider().sent.length).toBe(before);
  });

  it('editing works again once the board syncs after recovery', () => {
    const { h, provider } = renderReadOnly();
    act(() => provider().loadFailed());
    expect(screen.getByTestId('sticky-create')).toBeDisabled();

    // The room recovered: the first successful sync returns to 'connected'.
    act(() => provider().emit('sync', true));
    expect(badge()).toBeNull();
    expect(screen.getByTestId('sticky-create')).not.toBeDisabled();

    fireEvent.click(screen.getByTestId('sticky-create'));
    expect(h.notes()).toHaveLength(1);
    expect(provider().mark()).toBeGreaterThan(0);
  });
});
