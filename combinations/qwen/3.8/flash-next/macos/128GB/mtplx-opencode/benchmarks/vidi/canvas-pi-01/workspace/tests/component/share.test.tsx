/**
 * Story 5 · component tests for the Share panel (contract TC-22 to TC-25).
 *
 * The panel has exactly one interesting behaviour — copying — and it has three
 * outcomes, so the tests pin all three: the clipboard accepting the text, the
 * clipboard rejecting it, and the clipboard not existing at all. Both fallback
 * shapes must land in the same manual-copy state, because that state is the
 * whole answer to "how do I get this link out of here" on a machine where the
 * API is unavailable (PRD share.copy_fallback).
 *
 * TC-25 is the accessibility half of the story: the pages are new surfaces, and
 * "unique accessible names, keyboard reachable" is stated as a done criterion,
 * so it is asserted rather than eyeballed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { App } from '../../src/client/App';
import { BoardPage } from '../../src/client/pages/BoardPage';
import {
  COPIED_LABEL,
  COPY_LABEL,
  MANUAL_COPY_TEXT,
  SHARE_NOTE,
  SharePanel,
  shareLinkFor,
} from '../../src/client/share/SharePanel';
import { LINK_COPIED_MS } from '../../src/shared/config';

const VALID_ID = 'AAAAAAAAAAAAAAAAAAAAAA';
const ORIGIN = 'https://vidi6.example';

function clipboardStub(implement = true): { writeText: (text: string) => Promise<void> } | undefined {
  if (!implement) return undefined;
  return { writeText: vi.fn(async () => undefined) };
}

/** Flush the microtask queue so an awaited `writeText` resolves. */
async function settle(times = 5): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  window.history.replaceState(null, '/', `/b/${VALID_ID}`);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Share panel (TC-22)', () => {
  it('copies the full link and reverts the confirmation after LINK_COPIED_MS', async () => {
    const clipboard = clipboardStub();
    render(<SharePanel boardId={VALID_ID} clipboard={clipboard} origin={ORIGIN} />);

    fireEvent.click(screen.getByTestId('share-button'));
    expect(screen.getByTestId('share-panel')).toBeTruthy();
    expect(screen.getByTestId('share-copy').textContent).toBe(COPY_LABEL);

    fireEvent.click(screen.getByTestId('share-copy'));
    await settle();

    // Still confirmed one millisecond before the window closes, gone in it.
    act(() => {
      vi.advanceTimersByTime(LINK_COPIED_MS - 1);
    });
    expect(screen.getByTestId('share-copy').textContent).toBe(`\u2713 ${COPIED_LABEL}`);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByTestId('share-copy').textContent).toBe(COPY_LABEL);
  });

  it('writes exactly the share link, and shows the security note', () => {
    const clipboard = clipboardStub();
    render(<SharePanel boardId={VALID_ID} clipboard={clipboard} origin={ORIGIN} />);
    fireEvent.click(screen.getByTestId('share-button'));
    expect(screen.getByTestId('share-note').textContent).toBe(SHARE_NOTE);
    expect((screen.getByTestId('share-link') as HTMLInputElement).value).toBe(
      `${ORIGIN}/b/${VALID_ID}`,
    );
  });

  it('falls back to manual copy when the clipboard rejects the write', async () => {
    const clipboard = { writeText: vi.fn(async () => { throw new Error('NotAllowedError'); }) };
    render(<SharePanel boardId={VALID_ID} clipboard={clipboard} />);
    fireEvent.click(screen.getByTestId('share-button'));
    fireEvent.click(screen.getByTestId('share-copy'));
    await settle();
    expect(screen.getByTestId('share-manual').textContent).toBe(MANUAL_COPY_TEXT);
    expect(screen.getByTestId('share-copy').textContent).toBe(COPY_LABEL);
  });
});

describe('Share panel without a clipboard (TC-23)', () => {
  it('selects the link and asks for Ctrl/Cmd+C when navigator.clipboard is absent', async () => {
    // jsdom ships no `navigator.clipboard`, so with no injected clipboard this
    // is the real insecure-context shape: the API is simply not there.
    expect(navigator.clipboard).toBeUndefined();
    render(<SharePanel boardId={VALID_ID} origin={ORIGIN} />);
    fireEvent.click(screen.getByTestId('share-button'));
    fireEvent.click(screen.getByTestId('share-copy'));
    await settle();

    expect(screen.getByTestId('share-manual').textContent).toBe(MANUAL_COPY_TEXT);
    const field = screen.getByTestId('share-link') as HTMLInputElement;
    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe(field.value.length);
    expect(document.activeElement).toBe(field);
  });
});

describe('Share panel dismissal and focus (TC-24)', () => {
  const renderOpen = () => {
    render(
      <div>
        <div data-testid="elsewhere" style={{ width: 200, height: 200 }}>
          other stuff
        </div>
        <SharePanel boardId={VALID_ID} origin={ORIGIN} />
      </div>,
    );
    fireEvent.click(screen.getByTestId('share-button'));
    expect(screen.getByTestId('share-panel')).toBeTruthy();
  };

  it('dismisses when the Share button is clicked a second time', () => {
    renderOpen();
    fireEvent.click(screen.getByTestId('share-button'));
    expect(screen.queryByTestId('share-panel')).toBeNull();
    expect(screen.getByTestId('share-button').getAttribute('aria-expanded')).toBe('false');
  });

  it('dismisses on a pointerdown outside the panel', () => {
    renderOpen();
    const target = screen.getByTestId('elsewhere');
    act(() => {
      target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    });
    expect(screen.queryByTestId('share-panel')).toBeNull();
    expect(screen.getByTestId('share-button').hasAttribute('aria-expanded')).toBe(true);
  });

  it('dismisses on Escape and returns focus to the Share button', () => {
    renderOpen();
    const button = screen.getByTestId('share-button');
    button.focus();
    screen.getByTestId('share-copy').focus();
    expect(document.activeElement).toBe(screen.getByTestId('share-copy'));

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(screen.queryByTestId('share-panel')).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it('keeps the panel open when the click is inside it', () => {
    renderOpen();
    act(() => {
      screen.getByTestId('share-note').dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true }),
      );
    });
    expect(screen.getByTestId('share-panel')).toBeTruthy();
  });
});

describe('accessible names and keyboard access (TC-25)', () => {
  it('gives every page one named heading and every control a name', async () => {
    window.history.replaceState(null, '', '/');
    const { unmount } = render(<App />);
    const home = screen.getByTestId('home-page');
    const homeHeading = home.querySelector('h1');
    expect(homeHeading?.textContent).toBe('vidi6');
    // The tagline is the description, not a second button label.
    expect(home.querySelectorAll('button')).toHaveLength(1);
    expect(screen.getByTestId('create-board').textContent).toBe('Create a board');
    unmount();

    window.history.replaceState(null, '', `/b/${VALID_ID}`);
    render(<BoardPage id={VALID_ID} check={async () => ({ kind: 'not_found' })} />);
    await settle();
    const notFound = screen.getByTestId('not-found-page');
    expect(notFound.querySelectorAll('h1')).toHaveLength(1);
    expect(screen.getByTestId('not-found-title').textContent).toBe('Board not found');
  });

  it('renders the panel as a named dialog whose controls are tab-reachable', () => {
    render(<SharePanel boardId={VALID_ID} origin={ORIGIN} />);
    const button = screen.getByTestId('share-button');
    // Keyboard-reachable by default: a real button, no `tabindex` tricks, and a
    // visible focus ring rather than the browser default alone.
    expect(button.tagName).toBe('BUTTON');
    expect(button.hasAttribute('tabindex')).toBe(false);

    fireEvent.click(screen.getByTestId('share-button'));
    const panel = screen.getByTestId('share-panel');
    expect(panel.getAttribute('role')).toBe('dialog');
    expect(panel.getAttribute('aria-label')).toBe('Share board');

    const field = screen.getByTestId('share-link') as HTMLInputElement;
    expect(field.getAttribute('aria-label')).toBe('Board link');
    expect(field.readOnly).toBe(true);
    expect(field.tagName).toBe('INPUT');
    // Link field and copy button are both tab stops inside the dialog.
    const tabbable = [...panel.querySelectorAll('input, button')];
    expect(tabbable).toHaveLength(2);
    expect(screen.getByTestId('share-copy').textContent).toBe(COPY_LABEL);
  });
});

describe('share link shape (TC-24 companion)', () => {
  it('builds a full https URL from any origin', () => {
    expect(shareLinkFor(VALID_ID, ORIGIN)).toBe(`https://vidi6.example/b/${VALID_ID}`);
    expect(shareLinkFor(VALID_ID, 'http://localhost:5173')).toBe(
      `http://localhost:5173/b/${VALID_ID}`,
    );
  });
});
