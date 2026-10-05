/**
 * The board's toast: one short sentence at the bottom of the screen (story 12).
 *
 * A toast exists because of a particular kind of bad news: the kind that arrives while a person is doing
 * something else, that does not need an answer, and that must not stop what they are doing. A file that was
 * refused is exactly that — the drop still adds the four screenshots that came with the PDF, and the person
 * has to be told about the PDF without a dialog standing between them and the board. So there is nothing here
 * to click, nothing to dismiss before work can continue, and no overlay stealing the focus from the note that
 * is being typed into.
 *
 * Two things about the shape of it are load-bearing and both come from the PRD:
 *
 *  - **`role="status"`**, not `role="alert"`. A status is read out by a screen reader in its own time and does
 *    not interrupt what is being said; an alert interrupts, and six refused files would mean six interruptions
 *    on top of a person who is in the middle of a sentence.
 *  - **It goes away by itself.** A toast that stays is a second board, and a board already has one.
 *
 * The messages live in a module store rather than in React state because the thing that has news is not a
 * component: `useImageInsert` validates files in a callback and needs to say something from there, and a
 * piece of news with nowhere to go is the bug this whole file exists to avoid. The board renders `<Toasts />`
 * once, near the root, and everything else just speaks.
 */
import { useSyncExternalStore } from 'react';
import type { JSX } from 'react';

/**
 * How long a message stays up.
 *
 * Long enough to be read once without being hunted for, short enough that a board is not still holding onto
 * news about a drop that happened two minutes ago. It is not in the shared settings because nothing outside
 * this file has an opinion about it — the messages are the contract, their timing is furniture.
 */
export const TOAST_VISIBLE_MS = 6000;

/** One message on screen. */
export interface ToastMessage {
  readonly id: number;
  readonly text: string;
}

/**
 * The messages, and the listeners.
 *
 * `messages` is replaced rather than mutated so that `getSnapshot` can hand React the same array twice in a row
 * when nothing happened — a store that returns a new array on every read sends React into an infinite loop, and
 * it is the one way this file can be wrong in a way that looks like nothing at all.
 */
let messages: readonly ToastMessage[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const timers = new Map<number, ReturnType<typeof setTimeout>>();

function notify(): void {
  for (const listener of listeners) listener();
}

function remove(id: number): void {
  const timer = timers.get(id);
  if (timer !== undefined) clearTimeout(timer);
  timers.delete(id);
  if (!messages.some((message) => message.id === id)) return;
  messages = messages.filter((message) => message.id !== id);
  notify();
}

/**
 * Say something at the bottom of the screen.
 *
 * Saying the same sentence twice is one message, not two: a person who dropped forty files and got four copies
 * of "Only PNG, JPEG, GIF and WebP images can be added." is not being told anything four more times, and the
 * stack of identical lines pushes the one that is different off the bottom. A *different* sentence is added
 * beside it, which is what a mixed batch needs — the type and the size both have to be said, and a person who
 * is told only one of them has an unexplained missing file.
 */
export function pushToast(text: string): void {
  if (text === '') return;
  if (messages.some((message) => message.text === text)) return;

  const id = nextId++;
  messages = [...messages, { id, text }];
  timers.set(
    id,
    setTimeout(() => {
      remove(id);
    }, TOAST_VISIBLE_MS),
  );
  notify();
}

/** Take everything back. For the board's own teardown, and for a test that wants a clean screen. */
export function clearToasts(): void {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  if (messages.length === 0) return;
  messages = [];
  notify();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The messages on screen right now. */
export function useToasts(): readonly ToastMessage[] {
  return useSyncExternalStore(subscribe, () => messages, () => messages);
}

/** The messages on screen right now, without a hook. For anything that is not rendering: a test, or a
 * component that has to know whether the board has already said something about what just happened. */
export function getToasts(): readonly ToastMessage[] {
  return messages;
}

/**
 * The messages, at the bottom and in the middle.
 *
 * Newest at the bottom, because a person reads the bottom line last and the newest news is the one that
 * explains what just happened. Each one is a `role="status"` region, so several refusals are read out as
 * several sentences rather than being collapsed into whichever one a single live region happened to catch.
 */
export function Toasts(): JSX.Element | null {
  const shown = useToasts();
  if (shown.length === 0) return null;

  return (
    <div className="toasts" data-testid="toasts">
      {shown.map((message) => (
        <p
          // The id, and not the text: two messages that happen to say the same thing are still two messages,
          // and a key that repeats is React mixing them up.
          key={message.id}
          className="toast"
          data-testid="toast"
          role="status"
        >
          {message.text}
        </p>
      ))}
    </div>
  );
}
