import { type FocusEvent, useRef, useSyncExternalStore } from 'react';
import type { UndoState } from './createUndo';

type Props = {
  message: string;
  /** Hover or focus inside the toast pauses the window; leaving both resumes it. */
  onAttention(attending: boolean): void;
  onUndo(): void;
  subscribe(listener: () => void): () => void;
  getState(): UndoState;
};

/**
 * 'Task completed · Undo'. A polite status region (announced without interrupting). The window pauses
 * while the pointer is over the toast or focus is inside it, so it never runs out under the user.
 */
export function UndoToast({ message, onAttention, onUndo, subscribe, getState }: Props) {
  const state = useSyncExternalStore(subscribe, getState);
  const attention = useRef({ hovered: false, focused: false });
  const update = (patch: Partial<typeof attention.current>) => {
    attention.current = { ...attention.current, ...patch };
    onAttention(attention.current.hovered || attention.current.focused);
  };
  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) update({ focused: false });
  };
  return (
    <div
      role="status"
      data-undo-toast
      onPointerEnter={() => update({ hovered: true })}
      onPointerLeave={() => update({ hovered: false })}
      onFocus={() => update({ focused: true })}
      onBlur={onBlur}
      className="flex w-[var(--width,356px)] max-w-[calc(100vw-2rem)] items-center gap-3 rounded-md border border-border bg-background py-1 pr-1 pl-4 text-sm text-foreground shadow-lg"
    >
      <span className="flex-1">{message}</span>
      <button
        type="button"
        onClick={onUndo}
        disabled={state === 'undoing'}
        aria-disabled={state === 'undoing' || undefined}
        className="min-h-11 min-w-11 rounded-md px-3 font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
      >
        Undo
      </button>
    </div>
  );
}
