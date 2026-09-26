import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type FormEvent } from 'react';
import * as Y from 'yjs';
import { clampToLimit, applyTextDiff, counterVisible } from './StickyText';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import { LOCAL_ORIGIN } from '../../shared/board-model';

export interface StickyTextEditorProps {
  ytext: Y.Text;
  fontPx: number;
  /** Text padding on each side of the note (world units). */
  padding: number;
  /** Ends editing. 'selected' keeps the note selected, 'unselected' clears it. */
  onEnd(next: 'selected' | 'unselected'): void;
}

/**
 * The textarea shown while a note is being edited. On mount it seeds itself
 * from the note's Y.Text and puts the caret at the end. Each `input` event is
 * clamped to the character limit and written to the Y.Text with a minimal diff,
 * so ending editing later performs no additional write (the text is already in
 * the document). Escape ends editing and keeps the note selected.
 */
export function StickyTextEditor({ ytext, fontPx, padding, onEnd }: StickyTextEditorProps) {
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
    const clamped = clampToLimit(next);
    valueRef.current = clamped;
    setValue(clamped);
    applyTextDiff(ytext, clamped, LOCAL_ORIGIN);
    // If we truncated, drop the caret at the end of the kept text (the extra
    // characters never enter the note).
    const el = ref.current;
    if (el && caret !== undefined) {
      const pos = Math.min(caret, clamped.length);
      el.setSelectionRange(pos, pos);
    }
  };

  const onInput = (e: FormEvent<HTMLTextAreaElement>) => {
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
    // Backspace fall through to the textarea (edit_text); App ignores them while
    // a note is being edited.
  };

  return (
    <textarea
      ref={ref}
      data-testid="sticky-textarea"
      className="sticky-textarea"
      value={value}
      onChange={() => {
        /* React requires onChange; the real work happens in onInput. */
      }}
      onInput={onInput as unknown as (e: FormEvent<HTMLTextAreaElement>) => void}
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
          const clamped = clampToLimit(el.value);
          applyTextDiff(ytext, clamped, LOCAL_ORIGIN);
        }
      }}
      onKeyDown={onKeyDown}
      aria-label="Sticky note text"
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
        lineHeight: 1.25,
        whiteSpace: 'pre-wrap',
        overflow: 'hidden',
        caretColor: '#111',
      }}
    />
  );
}

/** A small bottom-right counter, shown only near the character limit. */
export function CharCounter({ length }: { length: number }) {
  if (!counterVisible(length)) return null;
  return (
    <div
      data-testid="char-counter"
      style={{
        position: 'absolute',
        right: 6,
        bottom: 4,
        fontSize: 11,
        color: 'rgba(17,17,17,0.7)',
        background: 'rgba(255,255,255,0.7)',
        borderRadius: 4,
        padding: '0 4px',
        pointerEvents: 'none',
      }}
    >
      {length}/{STICKY_TEXT_MAX_CHARS}
    </div>
  );
}
