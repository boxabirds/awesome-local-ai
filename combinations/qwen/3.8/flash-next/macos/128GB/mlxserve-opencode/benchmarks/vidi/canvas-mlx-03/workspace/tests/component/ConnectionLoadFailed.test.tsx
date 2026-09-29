// Design story 4, contract `persist.client_status` — ui-component tests TC-22.
// The badge text/role/colour for a board whose storage could not be read, and the
// badge state machine's reaction to the two close codes the room sends.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import { useState } from 'react';
import {
  ConnectionStatus,
  connectionLabel,
  statusToRole,
  LOAD_FAILED_TEXT_COLOR,
  type ConnectionState,
} from '../../src/client/board/ConnectionStatus.tsx';
import {
  useConnectionBadge,
  type ProviderSignal,
  type Subscribe,
} from '../../src/client/board/useConnectionBadge.ts';
import { closeCodeToSignal } from '../../src/client/board/connectBoard.ts';
import { CLOSE_BOARD_LOAD_FAILED, CLOSE_STORAGE_FAILURE } from '../../src/shared/protocol.ts';

let emitSignal: ((s: ProviderSignal) => void) | null = null;

function Harness({ initial }: { initial?: ConnectionState }) {
  const [subscribe] = useState<Subscribe>(() => (emit: (s: ProviderSignal) => void) => {
    emitSignal = emit;
    return () => {
      if (emitSignal === emit) emitSignal = null;
    };
  });
  const status = useConnectionBadge(subscribe, true, initial);
  return <ConnectionStatus status={status} />;
}

function feed(signal: ProviderSignal) {
  act(() => {
    emitSignal?.(signal);
  });
}

/** The colour actually applied to the badge (inline; jsdom normalises hex to rgb). */
function appliedColor(el: HTMLElement): string {
  return el.style.color;
}

/** 'rgb(r, g, b)' → true when the red channel dominates (a red, not a grey/green). */
function isRed(cssColor: string): boolean {
  const m = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(cssColor);
  if (!m) throw new Error(`not an rgb colour: ${JSON.stringify(cssColor)}`);
  const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return r > g + 40 && r > b + 40;
}

function hexToRgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

beforeEach(() => {
  vi.useFakeTimers();
  emitSignal = null;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('story 4 persist.client_status badge (TC-22)', () => {
  it('TC-22 renders the load-failure sentence in red as a polite live region', () => {
    render(<ConnectionStatus status="load_failed" />);
    const el = screen.getByRole('status');
    expect(el).toHaveTextContent("This board couldn't be loaded. Retrying…");
    expect(el.getAttribute('aria-live')).toBe('polite');
    expect(el.getAttribute('data-status')).toBe('load_failed');
    expect(isRed(appliedColor(el))).toBe(true);
    // the applied colour is the exported constant, not a copy of it
    expect(appliedColor(el)).toBe(hexToRgb(LOAD_FAILED_TEXT_COLOR));
  });

  it('TC-22 the other statuses are not red, so the colour really distinguishes them', () => {
    for (const status of ['connecting', 'reconnecting', 'confirmed'] as const) {
      const { unmount } = render(<ConnectionStatus status={status} />);
      const el = screen.getByRole('status');
      expect(appliedColor(el)).toBe(''); // no red: styled by the stylesheet only
      expect(el).not.toHaveTextContent("This board couldn't be loaded. Retrying…");
      unmount();
      cleanup();
    }
    // A stably connected board still shows nothing.
    const { unmount } = render(<ConnectionStatus status="connected" />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    unmount();
  });

  it('TC-22 the load-failure label and role are defined for the state', () => {
    expect(connectionLabel('load_failed')).toBe("This board couldn't be loaded. Retrying…");
    expect(statusToRole('load_failed')).toEqual({ role: 'status', 'aria-live': 'polite' });
  });

  it('TC-22 machine: load-failed signal shows it, a further drop does not clear it, a sync hides it', () => {
    render(<Harness />);
    feed('connected'); // first successful load: hidden
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    feed('load-failed');
    const el = screen.getByRole('status');
    expect(el.getAttribute('data-status')).toBe('load_failed');
    expect(el).toHaveTextContent("This board couldn't be loaded. Retrying…");

    // The room closes the socket and y-websocket also reports a dropped status:
    // neither may pretend the board is merely reconnecting.
    feed('disconnected');
    expect(screen.getByRole('status').getAttribute('data-status')).toBe('load_failed');
    // …and the retry backoff keeps running without ever hiding the message.
    act(() => void vi.advanceTimersByTime(60_000));
    expect(screen.getByRole('status').getAttribute('data-status')).toBe('load_failed');

    // A later successful sync re-enables the board without a page reload.
    feed('connected');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('TC-22 machine: load_failed survives a reconnecting round-trip and returns to hidden on sync', () => {
    // A board that was already reconnecting, then learns the room cannot load it.
    render(<Harness initial="reconnecting" />);
    expect(screen.getByRole('status').getAttribute('data-status')).toBe('reconnecting');
    feed('load-failed');
    expect(screen.getByRole('status').getAttribute('data-status')).toBe('load_failed');
  });

  it('TC-22 close-code mapping: 4500 is a load failure, 1011 and drops are reconnecting', () => {
    expect(CLOSE_BOARD_LOAD_FAILED).toBe(4500);
    expect(CLOSE_STORAGE_FAILURE).toBe(1011);
    expect(closeCodeToSignal(CLOSE_BOARD_LOAD_FAILED)).toBe('load-failed');
    expect(closeCodeToSignal(CLOSE_STORAGE_FAILURE)).toBe('disconnected');
    expect(closeCodeToSignal(1006)).toBe('disconnected'); // network drop
    expect(closeCodeToSignal(1000)).toBe('disconnected');
    // An unknown code must never be read as "the board is unloadable".
    expect(closeCodeToSignal(4999)).toBe('disconnected');
    // …and the mapping feeds the machine as the design specifies.
    render(<Harness initial="connected" />);
    act(() => emitSignal?.(closeCodeToSignal(CLOSE_BOARD_LOAD_FAILED)));
    expect(screen.getByRole('status').getAttribute('data-status')).toBe('load_failed');
    cleanup();
    render(<Harness initial="connected" />);
    act(() => emitSignal?.(closeCodeToSignal(CLOSE_STORAGE_FAILURE)));
    expect(screen.getByRole('status').getAttribute('data-status')).toBe('reconnecting');
  });
});
