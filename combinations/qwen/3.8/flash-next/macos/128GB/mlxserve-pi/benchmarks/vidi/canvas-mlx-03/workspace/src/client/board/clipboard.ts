// Clipboard write, isolated (design "Share panel", PRD share.copy_fallback).
//
// Clipboard behaviour differs between browsers — some reject the promise, some
// never settle it when the document has no focus — so this helper answers with a
// boolean instead of throwing, and never waits longer than
// CLIPBOARD_WRITE_TIMEOUT_MS. The caller's job is only to show the manual-copy
// path when the answer is false; nothing here knows about the UI.

import { CLIPBOARD_WRITE_TIMEOUT_MS } from '../../shared/config.ts';

type WriteOutcome = 'written' | 'refused' | 'timeout';

export async function copyTextToClipboard(text: string): Promise<boolean> {
  return (await writeWithTimeout(text)) === 'written';
}

/** Exposed for tests of the timeout branch; the panel only uses the boolean. */
export async function writeWithTimeout(text: string): Promise<WriteOutcome> {
  const clipboard: Clipboard | undefined = navigator.clipboard;
  if (!clipboard || typeof clipboard.writeText !== 'function') return 'refused';

  let timer: ReturnType<typeof setTimeout> | null = null;
  // Both competitors are already-failure-proof, so a late rejection from the
  // clipboard can never surface as an unhandled rejection.
  const write: Promise<WriteOutcome> = clipboard
    .writeText(text)
    .then(() => 'written' as const, () => 'refused' as const);
  const timeout: Promise<WriteOutcome> = new Promise((resolve) => {
    timer = setTimeout(() => resolve('timeout'), CLIPBOARD_WRITE_TIMEOUT_MS);
  });
  try {
    return await Promise.race([write, timeout]);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}
