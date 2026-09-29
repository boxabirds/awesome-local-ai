import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type FormEvent,
} from 'react';
import * as Y from 'yjs';
import { clampToLimit, applyTextDiff } from '../../shared/text-edit';
import { LOCAL_ORIGIN } from '../../shared/board-model';

export interface TextEditorProps {
  /** The shared text this editor writes into. */
  ytext: Y.Text;
  /** Character ceiling; longer input is truncated, never split mid-pair. */
  maxChars: number;
  fontPx: number;
  lineHeight: number;
  /** CSS padding of the textarea, kept identical to the object's display
   * padding so the caret does not jump when editing starts. */
  padding: string | number;
  /** Stable test id for the textarea. */
  testId: string;
  ariaLabel: string;
  /** Called after every committed input, before React re-renders: the owner
   * uses it to re-measure the box the text now needs. */
  onInput?(next: string): void;
  /** Ends editing. 'selected' keeps the object selected, 'unselected' clears. */
  onEnd(next: 'selected' | 'unselected'): void;
  /** True → losing focus also ends editing (a text block does this; a sticky
   * note keeps its own click-outside rule from story 2). */
  endOnBlur?: boolean;
}

/**
 * The in-place text editor, shared by sticky notes (story 2) and free-text
 * blocks (story 9).
 *
 * Three rules make it safe to share, and they are the reason it is not simply
 * written twice:
 *
 * 1. Input is written as a *minimal diff* of the Y.Text, clamped to `maxChars`,
 *    so a concurrent peer's characters survive (contract `text.concurrent`).
 * 2. A change that arrived from another origin is adopted into the textarea
 *    while it is open. Without that, the next local keystroke would diff a
 *    stale local copy against the merged document and delete the peer's text.
 * 3. IME composition is never interrupted: composing input commits on
 *    `compositionend`, and a remote update never clobbers a composition.
 *
 * Escape ends editing with the object still selected; Enter is deliberately not
 * intercepted, so it inserts a newline (both object kinds are multiline).
 */
export function TextEditor({
  ytext,
  maxChars,
  fontPx,
  lineHeight,
  padding,
  testId,
  ariaLabel,
  onInput,
  onEnd,
  endOnBlur = false,
}: TextEditorProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const [value, setValue] = useState<string>(() => ytext.toString());
  // Mirror of `value` readable from event handlers without re-subscribing.
  const valueRef = useRef(value);

  // Adopt remote edits while editing: when the shared Y.Text changes from
  // another origin (a synced peer edit), reseed the textarea from the merged
  // text. Without this, the next local input would diff the stale local value
  // against the merged document and delete the peer's characters.
  useEffect(() => {
    const observer = (_event: Y.YTextEvent, origin: unknown) => {
      if (origin === LOCAL_ORIGIN || origin === ytext.doc) return;
      if (composing.current) return; // never clobber an in-flight IME composition
      const merged = ytext.toString();
      if (merged !== valueRef.current) {
        valueRef.current = merged;
        setValue(merged);
        const el = ref.current;
        if (el) {
          const pos = Math.min(el.selectionStart ?? merged.length, merged.length);
          try {
            el.setSelectionRange(pos, pos);
          } catch {
            /* jsdom + detached element: nothing else to do */
          }
        }
      }
    };
    ytext.observe(observer);
    return () => ytext.unobserve(observer);
  }, [ytext]);

  // Focus and put the caret at the end when the editor mounts (edit_start).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const end = el.value.length;
    el.setSelectionRange(end, end);
  }, []);

  const commit = (next: string, caret?: number) => {
    const clamped = clampToLimit(next, maxChars);
    valueRef.current = clamped;
    setValue(clamped);
    applyTextDiff(ytext, clamped, LOCAL_ORIGIN);
    // If we truncated, drop the caret at the end of the kept text (the extra
    // characters never enter the object).
    const el = ref.current;
    if (el && caret !== undefined) {
      const pos = Math.min(caret, clamped.length);
      el.setSelectionRange(pos, pos);
    }
    onInput?.(clamped);
  };

  const onInputEvent = (e: FormEvent<HTMLTextAreaElement>) => {
    if (composing.current) return; // handled on compositionend for IME safety
    const el = e.currentTarget;
    commit(el.value, el.selectionStart ?? undefined);
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onEnd('selected');
    }
    // Enter is intentionally NOT intercepted: it inserts a newline. Delete and
    // Backspace fall through to the textarea; the board ignores them while a
    // text object is being edited.
  };

  return (
    <textarea
      ref={ref}
      data-testid={testId}
      value={value}
      onChange={() => {
        /* React requires onChange; the real work happens in onInput. */
      }}
      onInput={onInputEvent as unknown as (e: FormEvent<HTMLTextAreaElement>) => void}
      onCompositionStart={() => {
        composing.current = true;
      }}
      onCompositionEnd={(e) => {
        composing.current = false;
        const el = e.currentTarget;
        commit(el.value, el.selectionStart ?? undefined);
      }}
      onBlur={() => {
        // Defensive flush: any pending value is already committed by onInput, so
        // this only covers the case where a blur races an uncommitted input.
        const el = ref.current;
        if (el && el.value !== ytext.toString() && !composing.current) {
          const clamped = clampToLimit(el.value, maxChars);
          applyTextDiff(ytext, clamped, LOCAL_ORIGIN);
          onInput?.(clamped);
        }
        if (endOnBlur) onEnd('selected');
      }}
      onKeyDown={onKeyDown}
      aria-label={ariaLabel}
      spellCheck={false}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        border: 'none',
        outline: 'none',
        resize: 'none',
        background: 'transparent',
        color: '#111',
        padding: `${padding}px`,
        fontFamily: 'inherit',
        fontSize: fontPx,
        lineHeight,
        whiteSpace: 'pre-wrap',
        overflow: 'hidden',
        caretColor: '#111',
      }}
    />
  );
}
