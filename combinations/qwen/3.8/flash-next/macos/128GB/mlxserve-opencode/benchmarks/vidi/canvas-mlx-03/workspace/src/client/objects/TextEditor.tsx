// The generalised in-place text editor (story 9), factored out of story 2's
// `StickyTextEditor`. A sticky note and a free-text object edit the same way — seed
// the textarea from a Y.Text on mount with the caret at the end, clamp to a length
// limit, write every change as a minimal Y.Text diff (never a full replace, so a
// colleague's concurrent typing survives), treat Enter as a newline, end the edit on
// Escape or a click outside, and route Ctrl/Cmd+Z to the *board's* undo rather than
// the textarea's browser history.
//
// The only difference between the two editors is cosmetic (font size, width, and the
// sticky's character counter), so they share this one implementation: `StickyTextEditor`
// is now a thin wrapper over it.
//
// Undo boundaries: opening an edit opens a capture window and closing it closes one,
// so typing is its own undo step and a line typed straight after a drag is never
// undone *with* the drag (story 8, TC-16).

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model.ts';
import { clampToLimit, applyTextDiff } from '../../shared/text-edit.ts';
import { useUndoBoundary } from '../board/useUndo.ts';
import type { UndoController } from '../board/undo.ts';

export interface TextEditorProps {
  ytext: Y.Text;
  /** The character limit the editor clamps to (TEXT_MAX_CHARS / STICKY_TEXT_MAX_CHARS). */
  maxChars: number;
  fontPx: number;
  /** The editor's box width in world units, or 'auto' to fill its container. */
  width: number | 'auto';
  /** Fired after every committed change, so the caller can remeasure the box. */
  onInput(): void;
  /** Left the editor: the object ends up selected, or unselected. */
  onEnd(next: 'selected' | 'unselected'): void;
  /** This board's undo history, for the Ctrl/Cmd+Z chord. */
  undo: UndoController;
  /** Extra chrome drawn under the textarea (the sticky's character counter). */
  counter?: (len: number) => ReactNode;
  /** A "limit reached" hint shown while the editor is at `maxChars` (free text). */
  limitHint?: string;
  /** The textarea's data-testid, so each type's tests still find their editor. */
  testId?: string;
  textAlign?: 'left' | 'center';
}

/**
 * The in-place textarea used by every editable object. On mount it seeds from
 * Y.Text, focuses and parks the caret at the end; Enter inserts a newline (never
 * intercepted); Escape ends the edit; a click outside commits and ends it.
 */
export function TextEditor(props: TextEditorProps) {
  const {
    ytext,
    maxChars,
    fontPx,
    width,
    onInput,
    onEnd,
    undo,
    counter,
    limitHint,
    testId,
    textAlign,
  } = props;
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const composingRef = useRef(false);
  const [len, setLen] = useState(() => ytext.toString().length);
  // `boundary` opens a capture window on mount and closes it on unmount; the editor
  // is mounted only while this object is the one being edited.
  const boundary = useUndoBoundary();

  // Mount: seed value, focus, caret at end of the existing text. Opening an edit is
  // the start of an action; closing it (Escape, a click elsewhere, the object being
  // deleted or the board unmounting) is the end of one.
  useEffect(() => {
    const ta = ref.current;
    if (ta) {
      ta.value = ytext.toString();
      setLen(ta.value.length);
      ta.focus();
      const end = ta.value.length;
      try {
        ta.setSelectionRange(end, end);
      } catch {
        /* jsdom may not support selection ranges */
      }
    }
    boundary();
    return boundary;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setCaretEnd = (length: number) => {
    const ta = ref.current;
    if (!ta) return;
    try {
      ta.setSelectionRange(length, length);
    } catch {
      /* ignore */
    }
  };

  const commit = () => {
    const ta = ref.current;
    if (!ta) return;
    const raw = ta.value;
    const clamped = clampToLimit(raw, maxChars);
    if (clamped !== raw) {
      ta.value = clamped;
      setCaretEnd(clamped.length);
    }
    applyTextDiff(ytext, clamped, LOCAL_ORIGIN);
    setLen(clamped.length);
    onInput();
  };

  /** The document moved under the textarea (undo, redo, a colleague): show it, caret at end. */
  const reseed = () => {
    const ta = ref.current;
    if (!ta) return;
    const value = ytext.toString();
    ta.value = value;
    setLen(value.length);
    setCaretEnd(value.length);
  };

  // Concurrent editing (TC-29): when a colleague's change lands in the shared Y.Text
  // while we are mid-edit, reflect it immediately — caret back to the end — so our
  // *next* keystroke diffs against the merged text and neither side's typing is lost.
  // Our own writes (LOCAL_ORIGIN) are already in the textarea, and a change arriving
  // mid-IME-composition is left for the composition end to resolve.
  useEffect(() => {
    const observer = (_event: Y.YTextEvent, transaction: Y.Transaction) => {
      if (transaction.origin === LOCAL_ORIGIN) return;
      if (composingRef.current) return;
      reseed();
    };
    ytext.observe(observer);
    return () => ytext.unobserve(observer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ytext]);

  const onIInput = () => {
    if (composingRef.current) return;
    commit();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      commit();
      onEnd('selected');
      return;
    }
    // Enter intentionally falls through: it inserts a newline.
    const chord = (e.ctrlKey || e.metaKey) && !e.altKey;
    const key = e.key.toLowerCase();
    if (!chord || (key !== 'z' && key !== 'y')) return;
    const direction = key === 'y' ? 'redo' : e.shiftKey ? 'redo' : 'undo';
    e.preventDefault();
    e.stopPropagation();
    commit();
    if (direction === 'redo') undo.redo();
    else undo.undo();
    reseed();
  };

  return (
    <>
      <textarea
        ref={ref}
        data-testid={testId ?? 'text-editor'}
        className="vidi6-text-editor"
        spellCheck={false}
        style={{
          position: 'absolute',
          inset: 0,
          width: width === 'auto' ? '100%' : width,
          maxWidth: '100%',
          height: '100%',
          border: 'none',
          resize: 'none',
          outline: 'none',
          background: 'transparent',
          color: 'inherit',
          fontFamily: 'inherit',
          fontSize: `${fontPx}px`,
          lineHeight: 1.3,
          padding: 0,
          margin: 0,
          textAlign: textAlign ?? 'left',
          whiteSpace: 'pre-wrap',
          overflowWrap: 'break-word',
          overflow: 'hidden',
          boxSizing: 'border-box',
          caretColor: 'currentColor',
        }}
        onInput={onIInput}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={() => {
          composingRef.current = false;
          commit();
        }}
        onKeyDown={onKeyDown}
        onPointerDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onBlur={() => {
          // Defensive flush of any pending value not routed through `input`.
          if (!composingRef.current) commit();
        }}
      />
      {counter ? counter(len) : null}
      {limitHint && len >= maxChars ? (
        <span
          data-testid="text-limit-hint"
          style={{
            position: 'absolute',
            right: 0,
            bottom: -16,
            fontSize: 11,
            color: '#b3261e',
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
          }}
        >
          {limitHint}
        </span>
      ) : null}
    </>
  );
}
