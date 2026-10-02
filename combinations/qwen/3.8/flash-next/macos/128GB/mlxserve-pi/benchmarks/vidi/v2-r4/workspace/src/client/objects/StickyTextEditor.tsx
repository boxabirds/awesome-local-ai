import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type CompositionEvent,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import type * as Y from 'yjs';

import { LOCAL_ORIGIN } from '../../shared/board-model';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import { applyTextDiff, clampToLimit, counterVisible, mapCaret } from './StickyText';

export interface StickyTextEditorProps {
  /** The note's shared text. Every keystroke is already written to it. */
  ytext: Y.Text;
  /** Fitted font size in world units, from the note's measurement. */
  fontPx: number;
  /** Called once when editing ends: Escape keeps the selection, a click away drops it. */
  onEnd(next: 'selected' | 'unselected'): void;
}

/**
 * The textarea that edits a sticky note.
 *
 * It is deliberately uncontrolled: the DOM holds the caret, this component only
 * copies the value into the `Y.Text` on every `input`. Because each change is
 * written as it happens, ending an edit performs no write at all — the text
 * typed so far is simply kept (`sticky.edit_end`).
 *
 * Typing that arrives from the room goes into the note while it is open here
 * (story 3), which an uncontrolled textarea does not do by itself: shared text
 * is copied in by hand, and the caret is carried over the change by
 * {@link mapCaret} so a person typing while somebody else types is not sent
 * back to the start of the note.
 *
 * IME composition is the one input the diff must not see half-finished, so
 * events during composition are skipped and the value is written on
 * `compositionend`.
 */
export function StickyTextEditor({ ytext, fontPx, onEnd }: StickyTextEditorProps) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const composingRef = useRef(false);
  const endedRef = useRef(false);
  /**
   * The shared text as this textarea is showing it. What arrives from the room is
   * worked out against this, and not against the value in the DOM, so a keystroke
   * that has been typed here but not written yet is never mistaken for somebody
   * else's edit.
   */
  const mirrorRef = useRef(ytext.toString());
  const [length, setLength] = useState(() => ytext.toString().length);

  /** Copies the shared text in, carrying the caret over the change. */
  const showSharedText = useCallback((): void => {
    const el = ref.current;
    if (el === null || endedRef.current || composingRef.current) return;
    const before = mirrorRef.current;
    const after = ytext.toString();
    mirrorRef.current = after;
    if (before === after) return;
    if (el.value !== before) {
      // Something is typed here that the shared text does not have yet. Writing it
      // is the input handler's job; copying over it now would drop it, and the
      // next change from the room will bring this text up to date.
      return;
    }
    const caret = mapCaret(el.selectionEnd, before, after);
    el.value = after;
    el.setSelectionRange(caret, caret);
    setLength(after.length);
  }, [ytext]);

  /** Copies the textarea into the shared text, dropping anything past the limit. */
  const write = useCallback((): void => {
    const el = ref.current;
    if (!el || endedRef.current) return;
    const typed = el.value;
    const kept = clampToLimit(typed);
    if (kept !== typed) {
      // Characters past the limit are not added; the caret goes to the end of
      // the kept text, so typing continues where the paste was cut off.
      const caret = Math.min(el.selectionEnd, kept.length);
      el.value = kept;
      el.setSelectionRange(caret, caret);
    }
    applyTextDiff(ytext, el.value, LOCAL_ORIGIN);
    // The shared text holds what is shown here, and now knows it.
    mirrorRef.current = ytext.toString();
    setLength(el.value.length);
  }, [ytext]);

  // Mount: the note's text, focus and the cursor at the end (`sticky.edit_start`).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const text = ytext.toString();
    if (el.value !== text) el.value = text;
    mirrorRef.current = text;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    setLength(el.value.length);
  }, [ytext]);

  // Somebody else typing in this note. Their words come in as a change to the
  // shared text that did not originate in this textarea.
  useLayoutEffect(() => {
    const onSharedText = (_event: Y.YTextEvent, origin: unknown): void => {
      if (origin === LOCAL_ORIGIN) return; // our own keystroke, already shown
      showSharedText();
    };
    ytext.observe(onSharedText);
    return () => ytext.unobserve(onSharedText);
  }, [ytext, showSharedText]);

  const finish = useCallback(
    (next: 'selected' | 'unselected') => {
      if (endedRef.current) return;
      endedRef.current = true;
      onEnd(next);
    },
    [onEnd],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Keys typed into a note belong to the note, never to the board shortcuts.
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      finish('selected');
    }
    // Enter keeps the textarea's own behaviour and inserts a new line.
  };

  const onCompositionEnd = (event: CompositionEvent<HTMLTextAreaElement>) => {
    void event;
    composingRef.current = false;
    write();
  };

  return (
    <>
      <textarea
        ref={ref}
        className="sticky-text sticky-textarea"
        data-testid="sticky-textarea"
        data-sticky-text-box="true"
        aria-label="Sticky note text"
        spellCheck={false}
        style={{ fontSize: `${fontPx}px` } as CSSProperties}
        onChange={() => {
          if (composingRef.current) return;
          write();
        }}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={onCompositionEnd}
        onKeyDown={onKeyDown}
        onBlur={() => {
          // Defensive flush: any value still only in the DOM is written first.
          if (!composingRef.current) write();
          finish('unselected');
        }}
      />
      {counterVisible(length) ? (
        <div className="sticky-counter" data-testid="sticky-counter">
          {length}
          /{STICKY_TEXT_MAX_CHARS}
        </div>
      ) : null}
    </>
  );
}
