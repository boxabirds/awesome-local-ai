import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useEffect, useState } from "react";
import { ConnectionStatus } from "../../src/client/sync/ConnectionStatus";
import {
  createConnectionStateMachine,
  type ConnectionState,
  type ConnectionStateMachine,
  type ProviderSignal,
} from "../../src/client/sync/connection-state";
import { Toolbar } from "../../src/client/board/Toolbar";
import { CONNECTED_CONFIRMATION_MS } from "../../src/shared/config";

/**
 * Story 3, task 7 - the connection badge (TC-19 to TC-21).
 *
 * The badge and the state mapping are tested together, driven by a fake
 * provider: the test decides exactly when the transport goes down and comes
 * back, and fake timers decide exactly how long "Connected" is shown. No
 * network, no wall clock.
 */

const CONNECTING_LABEL = "Connecting…";
const RECONNECTING_LABEL = "Reconnecting…";
const CONNECTED_LABEL = "Connected";

/** Stands in for the provider events `connectBoard` listens to. */
class FakeProvider {
  #machine: ConnectionStateMachine | null = null;

  attach(machine: ConnectionStateMachine): void {
    this.#machine = machine;
  }

  emit(signal: ProviderSignal): void {
    if (this.#machine === null) throw new Error("fake provider is not attached to a badge");
    act(() => {
      this.#machine!.handle(signal);
    });
  }

  /** The transport came back and the documents exchanged state again. */
  reconnected(): void {
    this.emit("connected");
    this.emit("synced");
  }
}

interface HarnessProps {
  provider: FakeProvider;
}

/** The badge as `App` wires it: a state machine, and the badge above it. */
function Harness({ provider }: HarnessProps) {
  const [state, setState] = useState<ConnectionState>("connecting");

  useEffect(() => {
    const machine = createConnectionStateMachine(setState);
    provider.attach(machine);
    return () => machine.destroy();
  }, [provider]);

  return <ConnectionStatus state={state} />;
}

function badge(): HTMLElement | null {
  return screen.queryByRole("status");
}

function badgeText(): string | null {
  return badge()?.textContent ?? null;
}

function advance(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe("connection status badge", () => {
  let provider: FakeProvider;

  beforeEach(() => {
    vi.useFakeTimers();
    provider = new FakeProvider();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("TC-19 shows 'Connecting…' on the first load and hides once connected", () => {
    render(<Harness provider={provider} />);

    expect(badgeText()).toBe(CONNECTING_LABEL);

    provider.emit("connecting");
    expect(badgeText()).toBe(CONNECTING_LABEL);

    provider.emit("connected"); // socket open, not synced yet
    expect(badgeText()).toBe(CONNECTING_LABEL);

    provider.emit("synced");
    // In sync with the room: nothing to report.
    expect(badge()).toBeNull();
  });

  it("TC-20 shows 'Reconnecting…' while the connection is down and 'Connected' when it returns", () => {
    render(<Harness provider={provider} />);
    provider.emit("connecting");
    provider.emit("synced");
    expect(badge()).toBeNull();

    provider.emit("disconnected");
    expect(badgeText()).toBe(RECONNECTING_LABEL);

    provider.reconnected();
    expect(badgeText()).toBe(CONNECTED_LABEL);

    // Boundary: CONNECTED_CONFIRMATION_MS - 1 the confirmation is still shown,
    // at exactly CONNECTED_CONFIRMATION_MS it is gone.
    advance(CONNECTED_CONFIRMATION_MS - 1);
    expect(badgeText()).toBe(CONNECTED_LABEL);

    advance(1);
    expect(badge()).toBeNull();
  });

  it("TC-21 a connection lost during the confirmation goes back to 'Reconnecting…' at once", () => {
    render(<Harness provider={provider} />);
    provider.emit("synced");
    provider.emit("disconnected");
    provider.reconnected();

    expect(badgeText()).toBe(CONNECTED_LABEL);
    advance(CONNECTED_CONFIRMATION_MS - 1);

    provider.emit("disconnected");
    expect(badgeText()).toBe(RECONNECTING_LABEL);

    // The confirmation timer that was still running must not fire later and
    // claim the board is connected.
    advance(CONNECTED_CONFIRMATION_MS * 2);
    expect(badgeText()).toBe(RECONNECTING_LABEL);
  });

  it("TC-21 the badge is a report, not a lock: in every state the board still works", () => {
    const states: ConnectionState[] = ["connecting", "connected", "reconnecting", "confirmed"];

    for (const state of states) {
      let created = 0;
      const view = render(
        <>
          <ConnectionStatus state={state} />
          <Toolbar
            onCreateSticky={() => {
              created += 1;
            }}
          />
        </>,
      );

      const create = screen.getByTestId("create-sticky");
      expect(create.hasAttribute("disabled")).toBe(false);
      fireEvent.click(create);
      expect(created).toBe(1);

      // Whatever the badge says, the tools are reachable and the badge itself
      // never swallows a click meant for the board.
      expect(screen.getByRole("toolbar")).toBeTruthy();
      if (state !== "connected") expect(badge()?.getAttribute("role")).toBe("status");
      else expect(badge()).toBeNull();

      view.unmount();
    }
  });
});
