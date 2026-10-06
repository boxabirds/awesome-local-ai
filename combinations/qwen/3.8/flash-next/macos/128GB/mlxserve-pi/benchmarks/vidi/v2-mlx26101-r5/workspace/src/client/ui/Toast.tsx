/**
 * A sentence at the bottom of the screen that goes away by itself.
 *
 * A toast is what the board says when a person did something that the board will not do: the file was a
 * PDF, the drop was twenty-one files, the connection is not up. None of those is an error in the board's
 * own working, and none of them is worth a dialog that has to be clicked — the person needs to know in
 * about a second and then needs to be left alone. So the interface is a function, not a piece of state
 * the caller has to thread through four components and clear itself: something refuses a file, it says
 * why, and the saying is nobody else's business.
 *
 * Two halves, deliberately kept apart. {@link showToast} is a call from anywhere — a hook with no
 * position in the tree, a callback three layers down — and {@link Toast} is the one component that
 * listens, mounted once by the board. Between them is a module-level set rather than a context, because
 * the thing that needs to speak is often not under the thing that renders (a paste handler is bound to
 * `window`), and a message that could not be sent from where the refusal happened would be a toast that
 * goes unsent.
 *
 * `role="status"` is the whole of the accessibility requirement in the PRD's last line: a *polite* live
 * region, so a screen reader finishes what it is saying, then reads this — which is the correct order
 * for a message that is news rather than an alarm. An `assertive` region here would interrupt somebody
 * who was mid-sentence about a sticky note to tell them a PDF was refused.
 */

import { useEffect, useState, type ReactElement } from 'react';

/** One message, with the moment it was asked for — which is what makes an identical one re-appear. */
export interface ToastMessage {
  id: number;
  text: string;
  /** Only a test reads this: how long this one is on screen. */
  durationMs: number;
}

/** How long a message stays up. */
const SHOWN_MS = 5_000;

let nextId = 1;
let current: ToastMessage | null = null;
const listeners = new Set<(message: ToastMessage | null) => void>();

/**
 * Says `text` at the bottom of the screen for a few seconds.
 *
 * One message at a time, on purpose: a toast is a remark, and four remarks about four files that all
 * arrived in one drag are four messages arriving on top of each other and unreadable. A drop of a PDF
 * and a 40 MB file says one of them, and the person can find out the other by trying again — which is
 * cheaper than a toast stack that pushes the board off the bottom of the window.
 *
 * A message already on screen is *replaced* rather than left to expire, so the same sentence twice in a
 * row visibly starts again: a person who dropped the same file twice should see the same clock, not a
 * message that has clearly been there a while.
 */
export function showToast(text: string, durationMs = SHOWN_MS): void {
  current = { id: nextId, text, durationMs };
  nextId += 1;
  for (const listener of listeners) listener(current);
}

/**
 * Takes the message down.
 *
 * A toast is left to expire on its own — that is what a few seconds is for — so this is not part of the flow
 * a person uses. It exists for the two moments when a message on screen has stopped being true and something
 * else is about to be said: a board being torn down, and a test that wants to start from silence rather from
 * whatever the last thing that ran happened to have refused.
 */
export function clearToast(): void {
  if (current === null) return;
  current = null;
  for (const listener of listeners) listener(current);
}

/** The message on screen, if there is one. Only a test asks. */
export function currentToast(): ToastMessage | null {
  return current;
}

/** The one message box the board has. Mounted once, by the board itself. */
export function Toast(): ReactElement | null {
  const [message, setMessage] = useState<ToastMessage | null>(current);

  useEffect(() => {
    listeners.add(setMessage);
    return () => {
      listeners.delete(setMessage);
    };
  }, []);

  useEffect(() => {
    if (message === null) return;
    const hide = window.setTimeout(() => setMessage(null), message.durationMs);
    return () => window.clearTimeout(hide);
  }, [message]);

  if (message === null) return null;
  return (
    <div className="toast" role="status" aria-live="polite" data-testid="toast">
      {message.text}
    </div>
  );
}
