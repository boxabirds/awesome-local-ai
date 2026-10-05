/**
 * Test-only view of the connection state.
 *
 * `window.__vidi6.connectionState` (test builds only) lets the e2e tests watch
 * the state the badge is mapping from, not just the text the badge happens to
 * be showing at the moment they look. Idle-connection stability (TC-29) is
 * about states that never appear, and a badge that hid itself before the test
 * looked would prove nothing.
 */

import { useEffect } from "react";
import { isTestMode, type Vidi6TestApi } from "../canvas/testHooks";
import type { ConnectionState } from "./connection-state";

export function useConnectionTestHook(state: ConnectionState): void {
  // No dependency list on purpose: this re-asserts the field after every render,
  // so it survives whichever other hook owns the `window.__vidi6` object.
  useEffect(() => {
    if (!isTestMode()) return;
    const api = (window.__vidi6 ?? {}) as Vidi6TestApi;
    api.connectionState = state;
    window.__vidi6 = api;
  });
}
