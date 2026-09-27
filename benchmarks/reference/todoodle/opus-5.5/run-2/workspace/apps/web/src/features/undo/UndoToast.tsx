import { type FocusEvent, useRef, useSyncExternalStore } from 'react';
import type { UndoHandle } from './createUndo';

/**
 * The toast body: the message and an Undo button. While the pointer is over it or keyboard focus
 * is inside it, the undo window is paused (WCAG 2.2.1: the time limit can be extended); it resumes
 * with the remaining time when both have left. The button is disabled while the undo is running.
 */
export function UndoToast({ handle, message }: { handle: UndoHandle; message: string }) {
  const state = useSyncExternalStore(handle.subscribe, () => handle.state);
  const hovered = useRef(false);
  const focused = useRef(false);
  const sync = () => (hovered.current || focused.current ? handle.pause() : handle.resume());

  return (
    <div
      role="status"
      data-undo-toast=""
      onPointerEnter={() => {
        hovered.current = true;
        sync();
      }}
      onPointerLeave={() => {
        hovered.current = false;
        sync();
      }}
      onFocus={() => {
        focused.current = true;
        sync();
      }}
      onBlur={(event: FocusEvent<HTMLDivElement>) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        focused.current = false;
        sync();
      }}
      className="flex w-[var(--width,356px)] max-w-[calc(100vw-2rem)] items-center justify-between gap-4 rounded-md border border-border bg-background px-4 py-3 text-sm text-foreground shadow-lg"
    >
      <span>{message}</span>
      <button
        type="button"
        disabled={state === 'undoing'}
        onClick={() => void handle.undo()}
        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md px-3 font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-60"
      >
        Undo
      </button>
    </div>
  );
}
