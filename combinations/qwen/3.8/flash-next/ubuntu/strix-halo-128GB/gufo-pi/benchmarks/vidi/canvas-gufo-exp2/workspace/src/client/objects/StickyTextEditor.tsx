import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import type * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import {
  applyTextDiff,
  clampToLimit,
  counterVisible,
} from './StickyText';

/** Padding between the note edge and its text, in world units. */
const STICKY_PADDING_WORLD = 12;

export interface StickyTextEditorProps {
  ytext: Y.Text;
  fontPx: number;
  onEnd(next: 'selected' | 'unselected'): void;
}

/**
 * The textarea that replaces a note's text while it is being edited.
 *
 * Every `input` event is written to the shared `Y.Text` immediately with a
 * minimal diff, so ending an edit writes nothing: whatever was typed is
 * already in the document and cannot be lost by unmounting the textarea.
 *
 * The caret starts at the end of the existing text (sticky.edit_start), Escape
 * ends the edit keeping the selection, a pointerdown outside the note ends it
 * without the selection, and characters beyond the limit are dropped with the
 * caret restored to the end of the kept text.
 */
export function StickyTextEditor({ ytext, fontPx, onEnd }: StickyTextEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const composingRef = useRef(false);
  const endedRef = useRef(false);
  const [length, setLength] = useState(() => ytext.toString().length);

  // edit_start: value from the document, focus, caret at the end.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    const value = clampToLimit(ytext.toString());
    if (el.value !== value) el.value = value;
    setLength(value.length);
    el.focus();
    el.setSelectionRange(value.length, value.length);
  }, [ytext]);

  const commit = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    const clamped = clampToLimit(el.value);
    if (clamped !== el.value) {
      // Characters beyond the limit are dropped; the caret goes back to the
      // end of the text that was kept.
      const caret = Math.min(clamped.length, Math.max(0, el.selectionStart - (el.value.length - clamped.length)));
      el.value = clamped;
      try {
        el.setSelectionRange(caret, caret);
      } catch {
        // A detached element cannot hold a selection; the value is still right.
      }
    }
    applyTextDiff(ytext, el.value, LOCAL_ORIGIN);
    setLength(el.value.length);
  }, [ytext]);

  // Any pointerdown outside the note ends the edit without keeping the
  // selection (sticky.edit_end). Capture phase: it runs before the viewport
  // clears the selection, so the text is flushed while the textarea exists.
  useEffect(() => {
    const el = textareaRef.current;
    const note = el?.closest('[data-sticky-note="true"]') ?? null;
    const onPointerDown = (event: PointerEvent) => {
      if (endedRef.current) return;
      const target = event.target as Node | null;
      if (target && note && note.contains(target)) return;
      endedRef.current = true;
      commit();
      onEnd('unselected');
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [commit, onEnd]);

  const handleInput = () => {
    // While an IME composition is open the textarea value is provisional; it
    // is committed on compositionend instead, which is what stops CJK input
    // from doubling characters.
    if (composingRef.current) return;
    commit();
  };

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (!endedRef.current) {
        endedRef.current = true;
        commit();
        onEnd('selected');
      }
      return;
    }
    // Enter inserts a newline: never intercepted (sticky.edit_start).
  };

  const handleBlur = () => {
    // Defensive flush: every input is already written, so this is a no-op
    // unless a composition ended without an input event.
    if (!endedRef.current) commit();
  };

  return (
    <>
      <textarea
        ref={textareaRef}
        data-testid="sticky-textarea"
        className="sticky-note-input"
        style={{
          fontSize: `${fontPx}px`,
          padding: `${STICKY_PADDING_WORLD}px`,
        }}
        aria-label="Sticky note text"
        spellCheck={false}
        onInput={handleInput}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={() => {
          composingRef.current = false;
          commit();
        }}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
      />
      {counterVisible(length) ? (
        <div className="sticky-note-counter" data-testid="sticky-counter">
          {length}/{STICKY_TEXT_MAX_CHARS}
        </div>
      ) : null}
    </>
  );
}
