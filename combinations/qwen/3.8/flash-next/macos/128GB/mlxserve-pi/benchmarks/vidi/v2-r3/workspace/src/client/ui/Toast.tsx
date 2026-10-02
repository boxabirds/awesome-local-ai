/*! The board's toast (story 12).
 *
 * One line of words at the bottom of the screen, for the few seconds it is worth
 * showing them. It is not a dialog: it takes nothing away from what the person is
 * doing, it cannot be the thing a keyboard is stuck in, and it goes away by itself.
 * What it is for is the refusal that has no other voice — the file that was not a
 * picture, the file too big to keep, the twenty-first file, the board that is not
 * connected — where the board's whole answer is a sentence and then it is over.
 *
 * ## Why a store rather than a prop
 *
 * The thing that knows a file was refused is the insert flow, which is three
 * callbacks deep from where the words belong. Passing a `showToast` down through
 * every component in between would mean every one of them had an opinion about
 * something they do nothing with, so the message goes into a module store instead
 * and this component is the only reader of it. It is the same shape as a `Y.Map`:
 * anybody may write, one thing renders it.
 */
import { useEffect, useSyncExternalStore, type JSX } from 'react';

/** A message, and how long it stays. */
export interface ToastMessage {
  id: number;
  text: string;
}

/** How long a message is on screen: long enough to read once, short enough to
 *  never be in the way of what it was about. */
export const TOAST_VISIBLE_MS = 5000;

/** Most messages shown at once; a twenty-first refusal is the same refusal. */
const MAX_VISIBLE = 4;

let messages: readonly ToastMessage[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const timers = new Map<number, ReturnType<typeof setTimeout>>();

function notify(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): readonly ToastMessage[] {
  return messages;
}

function forget(id: number): void {
  const timer = timers.get(id);
  if (timer !== undefined) {
    clearTimeout(timer);
    timers.delete(id);
  }
  messages = messages.filter((message) => message.id !== id);
  notify();
}

/**
 * Say something at the bottom of the screen for {@link TOAST_VISIBLE_MS}.
 *
 * Identical words are shown once: dropping forty files which are all the wrong
 * kind is one refusal, not forty, and a person who is told the same thing four
 * times is not better informed.
 */
export function showToast(text: string): void {
  if (messages.some((message) => message.text === text)) return;
  const id = nextId++;
  messages = [...messages, { id, text }].slice(-MAX_VISIBLE);
  timers.set(id, setTimeout(() => forget(id), TOAST_VISIBLE_MS));
  notify();
}

/** Take a message away. Only a test needs it: the board's own messages leave by
 *  themselves. */
export function dismissToasts(): void {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  messages = [];
  notify();
}

/**
 * The toast host: one region with `role="status"`, which is the role that means
 * "words will appear here, and they are worth hearing but nothing is on fire" —
 * announced by a screen reader without taking the focus away from wherever it is.
 */
export function Toast(): JSX.Element {
  const current = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  // A message left behind by a board that was closed while it was showing must
  // not be the first thing a new board says.
  useEffect(
    () => () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      messages = [];
    },
    [],
  );

  // The host is always there, with or without messages: the live region a screen
  // reader is told to watch must not be a thing that appears and disappears.
  return (
    <div className="toast-host" role="status" aria-live="polite" data-testid="toast-host">
      {current.map((message) => (
        <p key={message.id} className="toast" data-testid="toast">
          {message.text}
        </p>
      ))}
    </div>
  );
}
