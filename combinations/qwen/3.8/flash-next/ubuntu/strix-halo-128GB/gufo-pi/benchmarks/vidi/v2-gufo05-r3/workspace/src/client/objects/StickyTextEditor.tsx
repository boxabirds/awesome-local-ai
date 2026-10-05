import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import type * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import { applyTextDiff, clampToLimit, counterVisible, mapCaret } from './StickyText';
import { useBoardUndo } from '../board/useUndo';
import type { EndEditTarget } from '../board/useSelection';

export interface StickyTextEditorProps {
  /** The shared text of the note; every committed keystroke is written to it. */
  ytext: Y.Text;
  /** Auto-fitted font size in board units (matches the note's display text). */
  fontPx: number;
  /** Escape ends editing keeping the selection; an outside click drops it. */
  onEnd(next: EndEditTarget): void;
}

/**
 * Text editing inside a sticky note.
 *
 * The textarea is uncontrolled: each `input` event is clamped to the character
 * limit and written into the shared `Y.Text` with the *minimal* diff, so nothing
 * has to be written when editing ends and other people's typing is preserved
 * (story 3). During IME composition the raw buffer is left alone and committed
 * on `compositionend`, so composed input is never duplicated.
 */
export function StickyTextEditor(props: StickyTextEditorProps) {
  const { ytext, fontPx, onEnd } = props;
  const ref = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  const mountedRef = useRef(true);
  const undo = useBoardUndo();
  const [length, setLength] = useState(() => ytext.toString().length);

  // Edit start and edit end close the capture window, so typing in a note is a
  // step of its own: what came before (a drag, a delete) is not undone by a
  // Ctrl+Z pressed here, and typing does not merge into it either.
  useEffect(() => {
    undo?.boundary();
    return () => {
      undo?.boundary();
    };
  }, [undo, ytext]);

  // Edit start: seed the value from the shared text, focus it, caret at the end.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const value = ytext.toString();
    el.value = value;
    setLength(value.length);
    el.focus();
    el.setSelectionRange(value.length, value.length);
  }, [ytext]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Remote typing: keep the open editor in step with other people's edits.
  // Own commits are tagged with LOCAL_ORIGIN and skipped; anything else is
  // copied into the textarea and the caret is moved through the change, so two
  // people can type in the same note at the same time without either text (or
  // the whole note) being overwritten.
  useEffect(() => {
    const observer = (_event: Y.YTextEvent, transaction: Y.Transaction) => {
      // While composing, the IME buffer belongs to the input method; the change
      // is reconciled by the commit on compositionend.
      if (composingRef.current) return;
      const el = ref.current;
      if (!el) return;
      if (transaction.origin === LOCAL_ORIGIN) {
        setLength(el.value.length);
        return;
      }
      const next = ytext.toString();
      const prev = el.value;
      if (next === prev) return;
      const start = mapCaret(prev, next, el.selectionStart ?? 0);
      const end = mapCaret(prev, next, el.selectionEnd ?? start);
      el.value = next;
      el.setSelectionRange(start, end);
      setLength(next.length);
    };
    ytext.observe(observer);
    return () => ytext.unobserve(observer);
  }, [ytext]);

  const commit = () => {
    const el = ref.current;
    if (!el) return;
    const raw = el.value;
    const next = clampToLimit(raw);
    if (next !== raw) {
      // Characters beyond the limit are dropped; keep the caret at the end of
      // the text that was kept (a 1,200 character paste ends with the caret 1000).
      const caret = Math.min(el.selectionStart, next.length);
      el.value = next;
      el.setSelectionRange(caret, caret);
    }
    applyTextDiff(ytext, next, LOCAL_ORIGIN);
    setLength(next.length);
  };

  /**
   * Ctrl/Cmd+Z inside a note belongs to the note's text (`undo.typing`). The
   * browser's own undo would rewind the textarea while the shared text — and
   * everybody else's screen — stayed where it was, so the keystroke is taken
   * from the element and the board's history is stepped instead.
   */
  const onUndoKey = (e: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    const key = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && !e.altKey && key === 'z') {
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey) undo?.redo();
      else undo?.undo();
      return;
    }
    if (e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && key === 'y') {
      e.preventDefault();
      e.stopPropagation();
      undo?.redo();
    }
  };

  return (
    <div
      className="sticky-editor"
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <textarea
        ref={ref}
        className="sticky-textarea sticky-text-style"
        data-sticky-textarea=""
        aria-label="Sticky note text"
        style={{ fontSize: `${fontPx}px` }}
        defaultValue=""
        spellCheck={false}
        onChange={() => {
          if (!composingRef.current) commit();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            commit();
            onEnd('selected');
            return;
          }
          // Enter is left to the textarea so it inserts a new line.
          onUndoKey(e);
        }}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={() => {
          composingRef.current = false;
          commit();
        }}
        onBlur={() => {
          // Defensive flush: every input event has already been written, but a
          // blur racing with a composition must not lose the value.
          if (mountedRef.current && !composingRef.current) commit();
          // The edit ends here for a click outside the note; close the capture
          // window so the typing stays one step.
          undo?.boundary();
        }}
      />
      {counterVisible(length) ? (
        <div className="sticky-counter" data-sticky-counter="">
          {`${length}/${STICKY_TEXT_MAX_CHARS}`}
        </div>
      ) : null}
    </div>
  );
}
