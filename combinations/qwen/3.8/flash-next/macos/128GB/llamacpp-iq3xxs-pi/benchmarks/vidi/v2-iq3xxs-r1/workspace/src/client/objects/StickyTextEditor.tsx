import { useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { applyRemoteDelta, applyTextDiff, clampToLimit, counterVisible } from './StickyText';

export interface StickyTextEditorProps {
  ytext: Y.Text;
  /** Font size from the note's auto-fit, so editing and display look identical. */
  fontPx: number;
  /** Escape keeps the selection, a click outside drops it. */
  onEnd(next: 'selected' | 'unselected'): void;
}

/** The note element the editor is nested in (used for "click outside"). */
export const NOTE_SELECTOR = '[data-note-root]';

/**
 * Text editing for one sticky note: an uncontrolled textarea whose every input
 * is written straight into the shared `Y.Text` with a minimal diff. Because each
 * keystroke is already stored, ending an edit performs no extra write.
 *
 * - mount: value from `Y.Text`, focus, caret at the end of the text
 * - input: clamp to the 1,000 character limit, then `applyTextDiff`
 * - Escape: end editing and keep the note selected
 * - pointerdown outside the note: end editing and drop the selection
 * - Enter: inserts a new line (the textarea default)
 * - Backspace/Delete: edit characters, they never reach the note-deleting handler
 */
export function StickyTextEditor({ ytext, fontPx, onEnd }: StickyTextEditorProps) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const composingRef = useRef(false);
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;
  const [length, setLength] = useState(() => ytext.toString().length);

  /** Write whatever the textarea holds into the shared text (defensive flush). */
  const flush = (): void => {
    const el = ref.current;
    if (!el || composingRef.current) return;
    const clamped = clampToLimit(el.value);
    if (clamped !== el.value) {
      el.value = clamped;
      el.setSelectionRange(clamped.length, clamped.length);
    }
    applyTextDiff(ytext, el.value, LOCAL_ORIGIN);
    setLength((prev) => (prev === el.value.length ? prev : el.value.length));
  };

  // Cursor at the end of the existing text (sticky.edit_start).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const end = el.value.length;
    el.setSelectionRange(end, end);
  }, []);

  // Somebody else typed in this note while we are typing in it: their change is
  // applied to what we are holding, and the caret stays where we left it (PRD
  // live.concurrent_text). Updates from our own keystrokes are ignored — the
  // textarea is already ahead of the document there. Changes arriving mid-
  // composition are left to the next flush, which diffs rather than replaces.
  useEffect(() => {
    const onText = (event: Y.YTextEvent, transaction: Y.Transaction): void => {
      if (transaction.origin === LOCAL_ORIGIN) return;
      const el = ref.current;
      if (!el || composingRef.current) return;
      const next = applyRemoteDelta(
        el.value,
        { start: el.selectionStart ?? 0, end: el.selectionEnd ?? 0 },
        event.delta,
      );
      el.value = next.value;
      el.setSelectionRange(next.selection.start, next.selection.end);
      setLength((prev) => (prev === next.value.length ? prev : next.value.length));
    };
    ytext.observe(onText);
    return () => ytext.unobserve(onText);
  }, [ytext]);

  // A pointerdown anywhere outside this note ends editing without losing text.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      const el = ref.current;
      if (!el) return;
      const note = el.closest(NOTE_SELECTOR);
      const target = event.target;
      if (note && target instanceof Node && note.contains(target)) return;
      flush();
      onEndRef.current('unselected');
    };
    // Capture phase: a note's own pointerdown handler stops propagation, so a
    // bubbling listener would never see clicks on other notes.
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [ytext]);

  return (
    <>
      <textarea
        ref={ref}
        className="sticky-note-input"
        data-testid="sticky-note-input"
        aria-label="Sticky note text"
        defaultValue={ytext.toString()}
        spellCheck={false}
        style={{ fontSize: `${fontPx}px` }}
        onInput={flush}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={() => {
          composingRef.current = false;
          flush();
        }}
        onBlur={flush}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            flush();
            onEndRef.current('selected');
          }
        }}
      />
      {counterVisible(length) ? (
        <div className="sticky-note-counter" data-testid="sticky-note-counter" aria-live="polite">
          {`${length}/${STICKY_TEXT_MAX_CHARS}`}
        </div>
      ) : null}
    </>
  );
}
