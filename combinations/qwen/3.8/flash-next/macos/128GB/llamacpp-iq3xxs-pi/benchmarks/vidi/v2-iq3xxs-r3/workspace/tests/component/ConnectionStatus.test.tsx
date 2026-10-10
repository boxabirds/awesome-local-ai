/**
 * TC-19 to TC-21 (story 3, live.status) and TC-22 (story 4, persist.client_status)
 * — the connection badge.
 *
 * The badge is a pure function of one state, and the state comes from
 * `createConnectionTracker`, so these tests feed the provider events the real
 * provider emits (`status`, `sync`) into the real state machine and re-render the
 * real component with whatever it says. Only the confirmation timer is faked —
 * the design's boundary is `CONNECTED_CONFIRMATION_MS - 1` and exactly that.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CLOSE_BOARD_LOAD_FAILED } from '../../src/shared/protocol';
import { CONNECTED_CONFIRMATION_MS } from '../../src/shared/config';
import { createConnectionTracker } from '../../src/client/sync/connectBoard';
import { ConnectionStatus } from '../../src/client/sync/ConnectionStatus';

import type { ConnectionTracker, ConnectionState } from '../../src/client/sync/connectBoard';

/** The badge as the board renders it, plus the events the board would report. */
function renderBadge(): {
  readonly tracker: ConnectionTracker;
  /** The badge's text, or `null` when there is no badge on screen. */
  badge(): string | null;
  /** `data-state`, so a test can tell the green "Connected" from a hidden one. */
  state(): string | null;
} {
  const view = render(<ConnectionStatus state="connecting" />);
  const tracker = createConnectionTracker((state) =>
    act(() => {
      view.rerender(<ConnectionStatus state={state} />);
    }),
  );
  return {
    tracker,
    badge: () => screen.queryByTestId('connection-status')?.textContent ?? null,
    state: () => screen.queryByTestId('connection-status')?.getAttribute('data-state') ?? null,
  };
}

/** Feed one provider event, as the provider does it: inside React's act(). */
function status(tracker: ConnectionTracker, next: 'connecting' | 'connected' | 'disconnected'): void {
  act(() => tracker.status(next));
}
function sync(tracker: ConnectionTracker, synced: boolean): void {
  act(() => tracker.sync(synced));
}
function advance(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

/** A badge whose board has synced once, i.e. `connected` and hidden. */
function syncedOnce(): ReturnType<typeof renderBadge> {
  const view = renderBadge();
  status(view.tracker, 'connecting');
  sync(view.tracker, true);
  return view;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe('the badge of a board that is coming and going (TC-19 to TC-21)', () => {
  // TC-19
  it('TC-19 says "Connecting…" while the first connection is up, and says nothing once it is synced', () => {
    const view = renderBadge();
    status(view.tracker, 'connecting');
    expect(view.badge()).toBe('Connecting…');
    expect(view.state()).toBe('connecting');

    // The socket is open but nothing has been exchanged: still not connected.
    status(view.tracker, 'connected');
    expect(view.badge()).toBe('Connecting…');

    sync(view.tracker, true);
    expect(view.badge()).toBeNull();
    expect(view.state()).toBeNull();
    expect(view.tracker.state).toBe('connected');
  });

  // TC-19, the other edge of the diagram: a board whose server is not there.
  it('TC-19 keeps saying "Connecting…" when a first connection never came up', () => {
    const view = renderBadge();
    status(view.tracker, 'connecting');
    status(view.tracker, 'disconnected'); // never synced: not an outage, still trying
    expect(view.badge()).toBe('Connecting…');
    expect(view.tracker.state).toBe('connecting');
    // And it is not the amber "Reconnecting…" of a board that lost a connection.
    expect(screen.getByTestId('connection-status').className).toContain('connection-status--connecting');
    advance(CONNECTED_CONFIRMATION_MS * 10);
    expect(view.badge()).toBe('Connecting…');
  });

  // TC-20
  it('TC-20 shows "Reconnecting…", then "Connected", and hides at exactly the confirmation deadline', () => {
    const view = syncedOnce();
    expect(view.badge()).toBeNull();

    status(view.tracker, 'disconnected');
    expect(view.badge()).toBe('Reconnecting…');
    expect(view.state()).toBe('reconnecting');

    // The socket came back and the documents exchanged again.
    status(view.tracker, 'connecting');
    sync(view.tracker, true);
    expect(view.badge()).toBe('Connected');
    expect(view.state()).toBe('confirmed');

    // Boundary: one millisecond before the deadline it is still there.
    advance(CONNECTED_CONFIRMATION_MS - 1);
    expect(view.badge()).toBe('Connected');
    // …and gone at exactly CONNECTED_CONFIRMATION_MS.
    advance(1);
    expect(view.badge()).toBeNull();
    expect(view.tracker.state).toBe('connected');
  });

  // TC-21
  it('TC-21 goes back to "Reconnecting…" the moment the connection drops again during the confirmation', () => {
    const view = syncedOnce();
    status(view.tracker, 'disconnected');
    sync(view.tracker, true);
    expect(view.badge()).toBe('Connected');

    advance(CONNECTED_CONFIRMATION_MS - 1);
    status(view.tracker, 'disconnected');
    // Immediately, not after a timer: the outage outranks the celebration.
    expect(view.badge()).toBe('Reconnecting…');
    expect(view.state()).toBe('reconnecting');
    // The confirmation timer of the connection that just died must not hide the
    // badge of the outage that replaced it.
    advance(CONNECTED_CONFIRMATION_MS * 2);
    expect(view.badge()).toBe('Reconnecting…');
    expect(view.tracker.state).toBe('reconnecting');
  });

  // The badge announces itself, which is what `role="status"` is for. (It is not
  // the only `status` on the board — the zoom percent is an `<output>` — so the
  // badge is also reachable by its own test id, as the browser tests do.)
  it('announces the badge as a live status region', () => {
    const view = renderBadge();
    status(view.tracker, 'disconnected');
    sync(view.tracker, true); // first sync -> hidden
    expect(screen.queryByRole('status')).toBeNull();
    status(view.tracker, 'disconnected');
    expect(screen.getByRole('status').textContent).toBe('Reconnecting…');
  });
});

/**
 * TC-22: the badge of a board the room could not read.
 *
 * "Red" is a stylesheet fact, and in jsdom no stylesheet is loaded, so this
 * checks the colour where it is actually written (`src/client/styles.css`)
 * instead of pretending the DOM says it. What the DOM does say — the text, the
 * `role="status"`, the state class — is checked in the DOM.
 */
describe('the badge of a board that could not be loaded (TC-22)', () => {
  const LOAD_FAILED_TEXT = "This board couldn't be loaded. Retrying…";

  it('TC-22 says it in red, as a status region, in the design\'s words', () => {
    render(<ConnectionStatus state="load_failed" />);
    const badge = screen.getByTestId('connection-status');
    expect(badge.textContent).toBe(LOAD_FAILED_TEXT);
    expect(badge.getAttribute('data-state')).toBe('load_failed');
    expect(badge.className).toContain('connection-status--load_failed');
    // Announced: it is the only thing on the screen that explains the board.
    expect(screen.getByRole('status')).toBe(badge);
  });

  it('TC-22 paints that badge red in the stylesheet, and only that badge', () => {
    // jsdom gives `import.meta.url` a served URL, not a file path, so the
    // stylesheet is read from where the test is run.
    const css = readFileSync(join(process.cwd(), 'src/client/styles.css'), 'utf8');
    const red = declaredColour(css, '.connection-status--load_failed');
    // "Red" here means red-dominant by a factor of two, which is the difference
    // between red and amber: measured on the stylesheet as it stands, the amber
    // "Reconnecting…" colour (#8a4b00) has a red channel too — it just does not
    // lead its green half as much.
    expect(red).not.toBeNull();
    expect(isRed(red!)).toBe(true);
    // And it is the only badge that is red: a storage failure is said in amber,
    // which is what keeps TC-28's two failures apart for the person looking.
    const reconnecting = declaredColour(css, '.connection-status--reconnecting');
    expect(reconnecting).not.toBeNull();
    expect(isRed(reconnecting!)).toBe(false);
    expect(`${red!.r},${red!.g},${red!.b}`).not.toBe(`${reconnecting!.r},${reconnecting!.g},${reconnecting!.b}`);
  });

  it('TC-22 arrives through the real state machine when the room closes with 4500', () => {
    const view = syncedOnce();
    expect(view.badge()).toBeNull();
    act(() => view.tracker.close(CLOSE_BOARD_LOAD_FAILED));
    expect(view.badge()).toBe(LOAD_FAILED_TEXT);
    expect(view.state()).toBe('load_failed');
    expect(screen.getByRole('status').getAttribute('class')).toContain(
      'connection-status--load_failed',
    );
  });
});

/** Reads as red: the red channel leads both others by at least a factor of two. */
function isRed({ r, g, b }: { r: number; g: number; b: number }): boolean {
  return r >= 100 && r > g * 2 && r > b * 2;
}

/** The `color` a selector in the stylesheet sets, as channels; `null` if absent. */
function declaredColour(css: string, selector: string): { r: number; g: number; b: number } | null {
  const rule = css.match(new RegExp(`${escapeRegExp(selector)}\\s*{[^}]*}`, 's'));
  if (!rule) return null;
  const declared = /(?:^|[;\s])color:\s*([^;]+)/.exec(rule[0])?.[1]?.trim();
  if (!declared) return null;
  const hex = /^#([0-9a-f]{3})$/i.exec(declared)?.[1];
  if (hex) {
    const [r, g, b] = [...hex].map((digit) => Number.parseInt(digit, 16) * 17);
    return { r, g, b };
  }
  const rgb = /^#([0-9a-f]{6})$/i.exec(declared)?.[1];
  if (rgb) {
    return {
      r: Number.parseInt(rgb.slice(0, 2), 16),
      g: Number.parseInt(rgb.slice(2, 4), 16),
      b: Number.parseInt(rgb.slice(4, 6), 16),
    };
  }
  const named = NAMED_COLOURS[declared.toLowerCase()];
  return named ?? null;
}

const NAMED_COLOURS: Record<string, { r: number; g: number; b: number }> = {
  black: { r: 0, g: 0, b: 0 },
  red: { r: 255, g: 0, b: 0 },
  white: { r: 255, g: 255, b: 255 },
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A state the tracker never reports by itself, to pin the badge's own table. */
describe('one badge per state', () => {
  const shown: readonly (readonly [ConnectionState, string])[] = [
    ['connecting', 'Connecting…'],
    ['reconnecting', 'Reconnecting…'],
    ['confirmed', 'Connected'],
  ] as const;

  for (const [state, text] of shown) {
    it(`renders ${state} as "${text}"`, () => {
      render(<ConnectionStatus state={state} />);
      expect(screen.getByTestId('connection-status').textContent).toBe(text);
      expect(screen.getByTestId('connection-status').getAttribute('data-state')).toBe(state);
    });
  }

  // Silence is a requirement, not an accident: no element at all, so nothing
  // shifts on a board that is working.
  it('renders nothing at all while everything is normal', () => {
    const view = render(<ConnectionStatus state="connected" />);
    expect(screen.queryByTestId('connection-status')).toBeNull();
    expect(view.container.innerHTML).toBe('');
  });
});
