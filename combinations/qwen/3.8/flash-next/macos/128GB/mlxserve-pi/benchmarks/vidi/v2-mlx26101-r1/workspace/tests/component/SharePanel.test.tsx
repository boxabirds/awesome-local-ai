// share.share_panel (TC-22 to TC-25, plus the private-window check). The panel is real;
// only the clipboard is scripted, because jsdom has no clipboard at all — which is also
// how the "a browser without the clipboard API" case is got at honestly.
//
// The panel never writes session or local storage: that is asserted by counting what
// those storages hold after opening and copying, which is nothing. That is what makes a
// private window behave like a normal one, and it is a fact about this panel, not about
// the browser.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  MANUAL_COPY_MESSAGE,
  SharePanel,
  boardLink,
  copiedLabel,
  sharePanelOpen,
} from '../../src/client/share/SharePanel';
import { LINK_COPIED_MS } from '../../src/shared/config';
import { TEST_BOARD_ID } from './helpers';

const LINK = `http://localhost:3000/b/${TEST_BOARD_ID}`;

/** What a scripted clipboard was asked to do. */
interface ClipboardProbe {
  /** The text of every write, in order. */
  readonly texts: string[];
}

/**
 * Install a clipboard that either works, refuses, or is not there at all — the three
 * answers a real browser gives. `absent` leaves jsdom (which has no clipboard) as it
 * is, which is exactly what an old browser or an insecure context looks like from here.
 *
 * The text is recorded synchronously, so a test with fake timers sees the panel settle
 * on a microtask: TC-23 needs the "Link copied" window to be exact to the millisecond,
 * and a stub that waited on a real asynchronous read would simply sit still.
 */
function scriptClipboard(outcome: 'ok' | 'denied' | 'absent'): ClipboardProbe {
  const probe: ClipboardProbe = { texts: [] };
  if (outcome === 'ok' || outcome === 'denied') {
    const clipboard = {
      writeText: async (text: string) => {
        probe.texts.push(text);
        if (outcome === 'denied') {
          throw new DOMException('NotAllowedError: permission denied', 'NotAllowedError');
        }
      },
      readText: async () => probe.texts[probe.texts.length - 1] ?? '',
    };
    Object.defineProperty(navigator, 'clipboard', {
      value: clipboard,
      configurable: true,
    });
  }
  return probe;
}

/** The link input as an input element. */
function linkInput(): HTMLInputElement {
  return screen.getByTestId('share-link') as HTMLInputElement;
}

function openPanel(): void {
  fireEvent.click(screen.getByTestId('share-open'));
}

const active = () => document.activeElement;

beforeEach(() => {
  window.history.replaceState(null, '', `/b/${TEST_BOARD_ID}`);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  // jsdom keeps `navigator.clipboard` if a test defined it; take it back out.
  delete (navigator as unknown as { clipboard?: unknown }).clipboard;
});

describe('the Share panel (share.share_panel)', () => {
  it('the panel holds this board\'s full link, read-only, and says who can use it', () => {
    scriptClipboard('ok');
    render(<SharePanel boardId={TEST_BOARD_ID} />);

    expect(screen.getByTestId('share-open').textContent).toBe('Share');
    expect(screen.queryByTestId('share-panel')).toBeNull();
    expect(sharePanelOpen()).toBe(false);

    openPanel();

    expect(screen.getByTestId('share-panel')).toBeTruthy();
    expect(sharePanelOpen()).toBe(true);
    const input = linkInput();
    // The whole link, from this origin — a path would be no use to anybody.
    expect(input.value).toBe(LINK);
    expect(input.value).toContain(`/b/${TEST_BOARD_ID}`);
    expect(boardLink(TEST_BOARD_ID)).toBe(`${window.location.origin}/b/${TEST_BOARD_ID}`);
    // Read-only: a person can select it, not edit what they would be sharing.
    expect(input.readOnly).toBe(true);
    expect(screen.getByTestId('share-note').textContent).toMatch(
      /Anyone with this link can view and edit this board\./,
    );
    // Opening puts the focus on the link, selected, so Cmd/Ctrl+C works immediately.
    expect(active()).toBe(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(LINK.length);
  });

  it('TC-22: Copy link writes the full link, says "Link copied" for exactly 2s, then goes back', async () => {
    vi.useFakeTimers();
    const probe = scriptClipboard('ok');
    render(<SharePanel boardId={TEST_BOARD_ID} />);
    openPanel();

    fireEvent.click(screen.getByTestId('share-copy'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(probe.texts).toEqual([LINK]);
    const copy = screen.getByTestId('share-copy');
    expect(copy.textContent).toContain('Link copied');
    expect(copiedLabel('copied')).toBe('Link copied');
    expect(copiedLabel('idle')).toBe('Copy link');
    expect(screen.getByTestId('share-tick').textContent).toBe('\u2713');
    expect(screen.queryByTestId('share-manual')).toBeNull();

    // The confirmation is a moment, not a mode. The boundary is the setting itself: one
    // millisecond before it the words are still there, on the millisecond they are not.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LINK_COPIED_MS - 1);
    });
    expect(screen.getByTestId('share-copy').textContent).toContain('Link copied');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(screen.getByTestId('share-copy').textContent).toBe('Copy link');
    expect(screen.queryByTestId('share-tick')).toBeNull();
  });

  it('TC-23: a clipboard that says no leaves the link selected and says to press Ctrl+C', async () => {
    scriptClipboard('denied');
    render(<SharePanel boardId={TEST_BOARD_ID} />);
    openPanel();

    fireEvent.click(screen.getByTestId('share-copy'));
    await waitFor(() => expect(screen.getByTestId('share-manual')).toBeTruthy());

    expect(screen.getByTestId('share-manual').textContent).toContain(MANUAL_COPY_MESSAGE);
    expect(screen.getByTestId('share-manual').textContent).toContain('Cmd+C');
    expect(screen.getByTestId('share-copy').textContent).toBe('Copy link');
    // The link is still there, still the whole thing, and the caret is in it — so the
    // keyboard shortcut the message names is the very next thing they can press.
    const input = linkInput();
    expect(input.value).toBe(LINK);
    expect(active()).toBe(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(LINK.length);
  });

  it('TC-24: a browser with no clipboard API at all takes the same path as TC-23', async () => {
    scriptClipboard('absent');
    render(<SharePanel boardId={TEST_BOARD_ID} />);
    openPanel();

    fireEvent.click(screen.getByTestId('share-copy'));
    await waitFor(() => expect(screen.getByTestId('share-manual')).toBeTruthy());
    expect(screen.getByTestId('share-manual').textContent).toContain(MANUAL_COPY_MESSAGE);
    expect(active()).toBe(linkInput());
  });

  it('TC-25: closes on outside click and on Escape, and focus goes back to Share', () => {
    scriptClipboard('ok');
    render(<SharePanel boardId={TEST_BOARD_ID} />);

    openPanel();
    expect(screen.getByTestId('share-panel')).toBeTruthy();
    // A pointer down inside the panel is a person using it, not leaving it.
    fireEvent.pointerDown(linkInput());
    expect(screen.getByTestId('share-panel')).toBeTruthy();

    // Outside: the panel goes, and the caret goes back to the button that opened it.
    fireEvent.pointerDown(document.body);
    expect(screen.queryByTestId('share-panel')).toBeNull();
    expect(sharePanelOpen()).toBe(false);
    expect(active()).toBe(screen.getByTestId('share-open'));

    // Escape: same.
    openPanel();
    expect(screen.getByTestId('share-panel')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('share-panel')).toBeNull();
    expect(sharePanelOpen()).toBe(false);
    expect(active()).toBe(screen.getByTestId('share-open'));

    // And the button is a real toggle, for people who click it twice.
    openPanel();
    openPanel();
    expect(screen.queryByTestId('share-panel')).toBeNull();
    expect(sharePanelOpen()).toBe(false);
  });

  it('nothing is remembered: opening and copying writes no session or local storage', async () => {
    const probe = scriptClipboard('ok');
    render(<SharePanel boardId={TEST_BOARD_ID} />);
    openPanel();
    fireEvent.click(screen.getByTestId('share-copy'));
    await waitFor(() => expect(probe.texts).toEqual([LINK]));

    // Nothing is stashed away "in case": the link lives in the address bar and on the
    // clipboard only, which is why a private window works exactly the same.
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
    expect(linkInput().value).toBe(window.location.href);

    fireEvent.click(screen.getByTestId('share-close'));
    expect(sharePanelOpen()).toBe(false);
  });
});
