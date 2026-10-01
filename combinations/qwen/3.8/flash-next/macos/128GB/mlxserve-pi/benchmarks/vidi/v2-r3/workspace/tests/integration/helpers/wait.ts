// Waiting inside the Workers runtime.
//
// workerd runs one event loop per isolate and a test is just another task in
// it, so "wait for something the room will send" has to be a poll that yields,
// not a blocking read. `until` is that poll; `sleep` is the yield it needs.

/** Yield to the event loop for about `ms`. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Yield until `predicate` holds. Throws with the thing waited for, so a stuck
 * test says what it was waiting on rather than just timing out.
 */
export async function until(
  predicate: () => boolean,
  what: string,
  timeoutMs = 4000,
  everyMs = 5,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(everyMs);
  }
}

/** `until` for a question that has to be asked across the runtime boundary. */
export async function untilAsync(
  predicate: () => Promise<boolean>,
  what: string,
  timeoutMs = 4000,
  everyMs = 5,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(everyMs);
  }
}
