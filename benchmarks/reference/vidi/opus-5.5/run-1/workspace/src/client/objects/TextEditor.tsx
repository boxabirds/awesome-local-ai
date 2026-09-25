import { useEffect, useLayoutEffect, useRef, type KeyboardEvent } from 'react';
import type * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { applyTextDiff, clampToLimit } from '../../shared/text-edit';
import { undoKey, type UndoController } from '../board/undo';
import type { EndEditNext } from '../board/useSelection';
import { transformIndex, type TextDeltaOp } from './StickyText';

export interface TextEditorProps {
  ytext: Y.Text;
  /** Characters beyond this are not added (typing or pasting). */
  maxChars: number;
  fontPx: number;
  /** Width in world px, or 'auto' to leave it to CSS. */
  width: number | 'auto';
  /** After every local change written to the Y.Text (not remote ones). */
  onInput(): void;
  /** Escape: stop editing (the object stays selected). */
  onEnd(next: EndEditNext): void;
  /** This tab's undo history (story 8), or null outside a board. */
  undo: UndoController | null;
  className?: string;
  ariaLabel?: string;
  /** The text's length after each change (sticky notes show a counter). */
  onLengthChange?(length: number): void;
}

/**
 * Transparent textarea over an object's text while it is edited (stories 2 and 9). Every input
 * event is written straight to the Y.Text as a minimal diff, clamped to `maxChars`, so ending
 * editing needs no extra write and unmounting never loses characters. Caret at the end on
 * mount; Enter inserts a newline; Escape ends editing; other people's typing appears in place
 * with the caret kept (story 3). Edit start and end are undo boundaries, and Ctrl/Cmd+Z inside
 * only walks back this edit's own steps (story 8).
 */
export function TextEditor(props: TextEditorProps) {
  const { ytext, maxChars, fontPx, width, undo, className, ariaLabel } = props;
  const ref = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  const propsRef = useRef(props);
  propsRef.current = props;
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
    // A box that just grew must not stay scrolled from when the text briefly overflowed it.
    el.scrollLeft = 0;
  };

  const reportLength = (length: number) => propsRef.current.onLengthChange?.(length);

  // Edit start: current text, focused, caret at the end.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.value = ytext.toString();
    el.focus();
    const end = el.value.length;
    el.setSelectionRange(end, end);
    reportLength(end);
    fitHeight();
  }, [ytext]);

  useLayoutEffect(fitHeight, [fontPx, width]);

  // Other people's typing (story 3) and undo/redo appear in the textarea as they arrive, with
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
      reportLength(next.length);
      fitHeight();
    };
    ytext.observe(onRemote);
    return () => ytext.unobserve(onRemote);
  }, [ytext]);

  const commit = () => {
    const el = ref.current;
    if (!el) return;
    const clamped = clampToLimit(el.value, propsRef.current.maxChars);
    if (clamped !== el.value) {
      // Characters beyond the limit are dropped; caret goes to the end of the kept text.
      el.value = clamped;
      el.setSelectionRange(clamped.length, clamped.length);
    }
    const before = ytext.toString();
    applyTextDiff(ytext, clamped, LOCAL_ORIGIN);
    const changed = ytext.toString() !== before;
    // A new change clears redo (undo.redo_cleared).
    if (changed) redoableRef.current = 0;
    reportLength(clamped.length);
    if (changed) propsRef.current.onInput();
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
      propsRef.current.onEnd('selected');
    }
    // Enter is not intercepted: it inserts a newline.
  };

  return (
    <textarea
      ref={ref}
      className={className}
      aria-label={ariaLabel}
      maxLength={maxChars}
      spellCheck
      style={{ fontSize: `${fontPx}px`, width: width === 'auto' ? undefined : `${width}px` }}
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
  );
}
