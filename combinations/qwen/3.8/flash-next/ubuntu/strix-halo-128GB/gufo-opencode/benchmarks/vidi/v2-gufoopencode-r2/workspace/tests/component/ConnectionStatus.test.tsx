// Task 7: connection status badge (TC-19 to TC-21). The badge component is
// driven through the same createConnectionStateMapper the real provider uses,
// so these tests cover the mapping rules and the boundary timer, not just
// the markup.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, act } from '@testing-library/react';
import { CONNECTED_CONFIRMATION_MS } from '../../src/shared/config';
import {
  createConnectionStateMapper,
  type ConnectionState,
} from '../../src/client/sync/connectBoard';
import { ConnectionStatus } from '../../src/client/sync/ConnectionStatus';

interface Controller {
  mapper: ReturnType<typeof createConnectionStateMapper> | null;
}

function Harness({ controller }: { controller: Controller }) {
  const [state, setState] = useState<ConnectionState>('connecting');
  if (controller.mapper === null) {
    controller.mapper = createConnectionStateMapper(setState);
  }
  return <ConnectionStatus state={state} />;
}

function badgeText(): string | null {
  return screen.queryByRole('status')?.textContent ?? null;
}

describe('ConnectionStatus badge', () => {
  let controller: Controller;

  beforeEach(() => {
    vi.useFakeTimers();
    controller = { mapper: null };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function mount(): void {
    render(<Harness controller={controller} />);
  }

  it('TC-19: connecting -> connected: shows "Connecting…" then hides', () => {
    mount();
    expect(badgeText()).toBe('Connecting…');
    act(() => controller.mapper!.onSync(true));
    expect(badgeText()).toBeNull();
  });

  it('TC-20: disconnect after sync -> "Reconnecting…"; resync -> "Connected", hidden exactly at CONNECTED_CONFIRMATION_MS', () => {
    mount();
    act(() => controller.mapper!.onSync(true)); // initial connect
    expect(badgeText()).toBeNull();

    act(() => controller.mapper!.onStatus('disconnected'));
    expect(badgeText()).toBe('Reconnecting…');

    act(() => controller.mapper!.onSync(true));
    expect(badgeText()).toBe('Connected');

    act(() => {
      vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS - 1);
    });
    expect(badgeText()).toBe('Connected'); // boundary: still visible one ms early

    act(() => {
      vi.advanceTimersByTime(1); // exactly CONNECTED_CONFIRMATION_MS
    });
    expect(badgeText()).toBeNull();
  });

  it('TC-21: disconnect during the confirmation window returns to "Reconnecting…" immediately', () => {
    mount();
    act(() => controller.mapper!.onSync(true));
    act(() => controller.mapper!.onStatus('disconnected'));
    act(() => controller.mapper!.onSync(true));
    expect(badgeText()).toBe('Connected');

    act(() => {
      vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS - 500);
    });
    act(() => controller.mapper!.onStatus('disconnected'));
    expect(badgeText()).toBe('Reconnecting…');

    // The stale confirmation timer must not fire later.
    act(() => {
      vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS);
    });
    expect(badgeText()).toBe('Reconnecting…');
  });
});
