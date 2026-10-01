// Story 4, `persist.client_status` (TC-23): a board the room could not load is
// shown but not written. A double-click on the board, a click of the Sticky note
// button and the Delete key are the three ways a note is added or removed; none
// of them may touch the model while the connection is `load_failed`, because a
// person must never edit a board that is not really the board on disk.
//
// The state is reached the honest way — through the live provider, with the same
// close code the room sends (CLOSE_BOARD_LOAD_FAILED) — not by forcing a prop, so
// what is under test is the app's own reaction to that close, from the close code
// to the gates.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Doc } from 'yjs';
import type { WebsocketProvider } from 'y-websocket';
import { App } from '../../src/client/App';
import { CLOSE_BOARD_LOAD_FAILED } from '../../src/shared/protocol';
import {
  createNote,
  noteCount,
  noteEl,
  pressOn,
  releaseOn,
  surfaceOf,
} from './helpers';

afterEach(() => {
  cleanup();
});

/** The ids of the notes the board renders, in DOM order. */
function renderedIds(): string[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-note-id]')).map(
    (el) => el.dataset.noteId!,
  );
}

/** The app, its board document, and the provider it connected with. */
function openApp(): { doc: Doc; provider: WebsocketProvider } {
  let doc: Doc | null = null;
  let provider: WebsocketProvider | null = null;
  act(() => {
    render(
      <App
        onDocReady={(d: Doc) => {
          doc = d;
        }}
        onProviderReady={(p: WebsocketProvider) => {
          provider = p;
        }}
      />,
    );
  });
  if (doc === null) throw new Error('the app did not expose its board');
  if (provider === null) throw new Error('the app did not expose its provider');
  return { doc, provider };
}

/** Push the app into `load_failed` the way the room does: a 4500 close. */
function failTheLoad(provider: WebsocketProvider): void {
  act(() => {
    provider.emit('connection-close', [{ code: CLOSE_BOARD_LOAD_FAILED }, provider] as never);
  });
}

describe('TC-23: a board that could not be loaded is not edited', () => {
  it('shows the load-failure message once the room closes it with 4500', () => {
    const { provider } = openApp();
    expect(screen.queryByText(/couldn't be loaded/)).toBeNull();
    failTheLoad(provider);
    expect(screen.getByText("This board couldn't be loaded. Retrying…")).toBeTruthy();
  });

  it('creates nothing from a double-click on the empty board', () => {
    const { doc, provider } = openApp();
    // a board that is editable creates a note on a double-click, to prove the
    // gesture reaches the app at all
    const surface = surfaceOf(document.body);
    act(() => {
      fireEvent.doubleClick(surface, { clientX: 200, clientY: 200 });
    });
    expect(noteCount()).toBe(1);
    void doc;

    failTheLoad(provider);
    act(() => {
      fireEvent.doubleClick(surface, { clientX: 400, clientY: 400 });
    });
    expect(noteCount()).toBe(1); // the second double-click made no note
  });

  it('disables the Sticky note button and creates nothing when it is clicked', () => {
    const { provider } = openApp();
    const button = screen.getByTestId('sticky-note-button');
    expect(button.hasAttribute('disabled')).toBe(false);

    failTheLoad(provider);

    expect(button.hasAttribute('disabled')).toBe(true);
    expect(button).toHaveAttribute('aria-disabled', 'true');
    // clicking a disabled button makes nothing; the app also refuses the create
    act(() => {
      fireEvent.click(button);
    });
    expect(noteCount()).toBe(0);
  });

  it('deletes nothing when Delete is pressed on a selected note', () => {
    const { doc, provider } = openApp();
    const id = createNote(doc, 10, 10);
    expect(noteCount()).toBe(1);

    // a note is still selectable while the board cannot be loaded — selecting is
    // not editing — so the Delete key has something selected to act on
    failTheLoad(provider);
    act(() => {
      pressOn(noteEl(id));
      releaseOn(noteEl(id));
    });

    act(() => {
      fireEvent.keyDown(window, { key: 'Delete' });
    });
    expect(renderedIds()).toContain(id);
    expect(noteCount()).toBe(1);
  });
});
