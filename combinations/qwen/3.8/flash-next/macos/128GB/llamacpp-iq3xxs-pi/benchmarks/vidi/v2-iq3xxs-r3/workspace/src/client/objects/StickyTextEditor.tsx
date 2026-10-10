import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { JSX, ChangeEvent, CompositionEvent, KeyboardEvent } from 'react';
import type * as Y from 'yjs';

import { STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { applyTextDiff, clampToLimit, counterVisible } from './StickyText';
import { mapCaret, type TextDeltaOp } from './remote-text';

export interface StickyTextEditorProps {
  /** The note's text; every input event is diffed into it. */
  ytext: Y.Text;
  /** Fitted font size (board units, so it scales with the zoom). */
  fontPx: number;
  /** Escape -> 'selected'; pointerdown outside the note -> 'unselected'. */
  onEnd(next: 'selected' | 'unselected'): void;
}

/**
 * The textarea shown while a note is being edited (sticky.edit_start /
 * sticky.edit_end / sticky.text_limit).
 *
 * Every `input` event is written into the `Y.Text` immediately (as a minimal
 * diff), so ending the edit performs no additional write and nothing typed
 * can get lost. Input is skipped while an IME is composing and applied on
 * `compositionend` so composed input never duplicates characters. On mount the
 * caret is placed at the end of the existing text.
 *
 * While somebody else is typing in the same note (story 3), the doc is the
 * truth: their characters are copied in as they arrive and the caret moves with
 * the text. Without that, the next keystroke would be diffed against a stale
 * copy of the string and would delete what just arrived.
 */
export function StickyTextEditor({
  ytext,
  fontPx,
  onEnd,
}: StickyTextEditorProps): JSX.Element {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState(() => ytext.toString());
  const composingRef = useRef(false);
  /** Where the caret belongs after the remote change being applied now. */
  const caretRef = useRef<{ start: number; end: number } | null>(null);
  /** Latest onEnd, so the document listener is attached only once. */
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;

  // sticky.edit_start: value from the doc, focus, caret at the end.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.value = ytext.toString();
    el.focus();
    const end = el.value.length;
    el.setSelectionRange(end, end);
    // Mount only: later doc changes flow through the local value state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // sticky.edit_end: a pointerdown outside the note ends the edit as
  // 'unselected'. Capture phase: the note stops propagation, but a document
  // listener still sees the press before anything else reacts to it.
  useEffect(() => {
    const el = ref.current;
    const note = el?.closest('[data-note-id]') ?? null;
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (note && target instanceof Node && note.contains(target)) return;
      onEndRef.current('unselected');
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, []);

  // live.merge: somebody else's characters land in this textarea as they come
  // from the room, and the caret keeps its place next to them. Only changes
  // that did not start here count — our own typing is already in the value.
  useEffect(() => {
    const onRemote = (event: Y.YTextEvent): void => {
      if (event.transaction.origin === LOCAL_ORIGIN) return;
      const next = ytext.toString();
      const el = ref.current;
      if (el) {
        const caret = mapCaret(
          { start: el.selectionStart ?? next.length, end: el.selectionEnd ?? next.length },
          event.delta as unknown as TextDeltaOp[],
        );
        caretRef.current = { start: keep(caret.start, next), end: keep(caret.end, next) };
      }
      setValue(next);
    };
    ytext.observe(onRemote);
    return () => ytext.unobserve(onRemote);
  }, [ytext]);

  // React writes the value, and the browser drops the caret at the end of it.
  // This runs after that write and before the paint, so the caret is back in
  // place before anybody could see it move.
  useLayoutEffect(() => {
    const caret = caretRef.current;
    const el = ref.current;
    if (!caret || !el) return;
    caretRef.current = null;
    el.setSelectionRange(caret.start, caret.end);
  });

  const commit = (raw: string): void => {
    const next = clampToLimit(raw);
    // Characters past the limit are dropped and the caret sits at the end of
    // the kept text (sticky.text_limit).
    if (next.length !== raw.length) {
      const el = ref.current;
      if (el) {
        el.value = next;
        el.setSelectionRange(next.length, next.length);
      }
    }
    setValue(next);
    applyTextDiff(ytext, next, LOCAL_ORIGIN);
  };

  const onInput = (event: ChangeEvent<HTMLTextAreaElement>): void => {
    // While composing, the raw string may be an unfinished IME candidate;
    // compositionend writes it.
    if (composingRef.current) {
      setValue(event.target.value);
      return;
    }
    commit(event.target.value);
  };

  const onCompositionStart = (): void => {
    composingRef.current = true;
  };

  const onCompositionEnd = (event: CompositionEvent<HTMLTextAreaElement>): void => {
    composingRef.current = false;
    commit(event.currentTarget.value);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    // Escape ends editing, the text stays (sticky.edit_end). Enter is left to
    // the textarea default, which inserts a new line.
    if (event.key === 'Escape') {
      event.preventDefault();
      onEndRef.current('selected');
    }
  };

  const onBlur = (event: ChangeEvent<HTMLTextAreaElement>): void => {
    // Defensive flush: by contract every input event was already written.
    // Skipped when the note was deleted from under the editor (TC-37) so a
    // detached text is never written to.
    if (!event.currentTarget.isConnected) return;
    commit(event.currentTarget.value);
  };

  return (
    <>
      <textarea
        ref={ref}
        className="sticky-textarea"
        data-testid="sticky-textarea"
        value={value}
        style={{ fontSize: `${fontPx}px` }}
        spellCheck={false}
        onChange={onInput}
        onCompositionStart={onCompositionStart}
        onCompositionEnd={onCompositionEnd}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
      />
      {counterVisible(value.length) ? (
        <div
          className="char-counter"
          data-testid="char-counter"
          aria-label={`${value.length} of ${STICKY_TEXT_MAX_CHARS} characters`}
        >
          {`${value.length}/${STICKY_TEXT_MAX_CHARS}`}
        </div>
      ) : null}
    </>
  );
}

/** Never point outside the text: a stale caret would throw in the browser. */
function keep(index: number, text: string): number {
  return Math.max(0, Math.min(index, text.length));
}
