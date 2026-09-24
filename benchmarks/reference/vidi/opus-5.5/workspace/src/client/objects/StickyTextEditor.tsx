import { useContext, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import type * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import { undoKey } from '../board/undo';
import type { EndEditNext } from '../board/useSelection';
import { UndoContext } from '../board/useUndo';
import { applyTextDiff, clampToLimit, counterVisible, transformIndex, type TextDeltaOp } from './StickyText';

export interface StickyTextEditorProps {
  ytext: Y.Text;
  fontPx: number;
  onEnd(next: EndEditNext): void;
}

/**
 * Transparent textarea laid over the note's text while editing. Every input event is
 * written straight to the Y.Text (minimal diff), so ending editing needs no extra write
 * and unmounting can never lose characters.
 */
export function StickyTextEditor({ ytext, fontPx, onEnd }: StickyTextEditorProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  const [length, setLength] = useState(() => ytext.length);
  const undo = useContext(UndoContext);
  /** The newest undo step when editing started: undo inside the editor stops there. */
  const baselineRef = useRef<object | null>(null);
  /** Steps undone inside this editor that may still be redone here. */
  const redoableRef = useRef(0);

  // Edit start and end are undo boundaries: typing never merges with the actions around it
  // (story 8). Within the edit, typing groups into bursts by UNDO_CAPTURE_TIMEOUT_MS.
  useEffect(() => {
    if (!undo) return undefined;
    undo.boundary();
    baselineRef.current = undo.lastStep();
    redoableRef.current = 0;
    return () => undo.boundary();
  }, [undo, ytext]);

  const fitHeight = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };

  // Edit start: current text, focused, caret at the end.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.value = ytext.toString();
    el.focus();
    const end = el.value.length;
    el.setSelectionRange(end, end);
    setLength(end);
    fitHeight();
  }, [ytext]);

  useLayoutEffect(fitHeight, [fontPx]);

  // Other people's typing in this note (story 3) appears in the textarea as it arrives, with
  // this person's caret and selection kept in place. Local input is already in the textarea.
  useEffect(() => {
    const onRemote = (event: Y.YTextEvent, transaction: Y.Transaction) => {
      if (transaction.origin === LOCAL_ORIGIN) return;
      const el = ref.current;
      if (!el) return;
      const next = ytext.toString();
      if (el.value === next) return;
      const delta = event.delta as TextDeltaOp[];
      const start = transformIndex(el.selectionStart, delta);
      const end = transformIndex(el.selectionEnd, delta);
      el.value = next;
      el.setSelectionRange(start, end);
      setLength(next.length);
      fitHeight();
    };
    ytext.observe(onRemote);
    return () => ytext.unobserve(onRemote);
  }, [ytext]);

  const commit = () => {
    const el = ref.current;
    if (!el) return;
    const clamped = clampToLimit(el.value);
    if (clamped !== el.value) {
      // Characters beyond the limit are dropped; caret goes to the end of the kept text.
      el.value = clamped;
      el.setSelectionRange(clamped.length, clamped.length);
    }
    const before = ytext.toString();
    applyTextDiff(ytext, clamped, LOCAL_ORIGIN);
    // A new change clears redo (undo.redo_cleared).
    if (ytext.toString() !== before) redoableRef.current = 0;
    setLength(clamped.length);
    fitHeight();
  };

  /**
   * Ctrl/Cmd+Z undoes this edit's typing and Ctrl/Cmd+Shift+Z / Ctrl+Y redoes it, through the
   * board's history, never the textarea's own (which would diverge from the shared text). The
   * change arrives like a remote one: the observer above updates the textarea and caret.
   */
  const onHistoryKey = (kind: 'undo' | 'redo') => {
    if (!undo) return;
    commit();
    if (kind === 'undo') {
      if (undo.lastStep() === null || undo.lastStep() === baselineRef.current) return;
      if (undo.undo()) redoableRef.current += 1;
    } else if (redoableRef.current > 0 && undo.redo()) {
      redoableRef.current -= 1;
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const history = undoKey(e);
    if (history !== null && !composingRef.current) {
      e.preventDefault();
      onHistoryKey(history);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      commit();
      onEnd('selected');
    }
    // Enter is not intercepted: it inserts a newline.
  };

  return (
    <>
      <textarea
        ref={ref}
        className="sticky-note__editor"
        aria-label="Note text"
        maxLength={STICKY_TEXT_MAX_CHARS}
        spellCheck
        style={{ fontSize: `${fontPx}px` }}
        onChange={() => {
          if (!composingRef.current) commit();
        }}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={() => {
          composingRef.current = false;
          commit();
        }}
        onBlur={() => {
          // Defensive flush; normally every input event has already been written.
          if (!composingRef.current) commit();
        }}
        onKeyDown={onKeyDown}
      />
      {counterVisible(length) && (
        <div className="sticky-note__counter" aria-live="polite" data-testid="sticky-counter">
          {`${length}/${STICKY_TEXT_MAX_CHARS}`}
        </div>
      )}
    </>
  );
}
