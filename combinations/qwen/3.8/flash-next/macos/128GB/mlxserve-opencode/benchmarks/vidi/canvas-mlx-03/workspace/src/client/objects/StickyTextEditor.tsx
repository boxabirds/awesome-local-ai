import { useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model.ts';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config.ts';
import { clampToLimit, applyTextDiff, counterVisible } from './StickyText.ts';
import { useUndoBoundary, useUndoController } from '../board/useUndo.ts';

export interface StickyTextEditorProps {
  ytext: Y.Text;
  fontPx: number;
  onEnd(next: 'selected' | 'unselected'): void;
}

/**
 * The in-note textarea for editing. On mount it seeds the textarea from Y.Text,
 * focuses it and parks the caret at the end of the text. Every `input` (skipped
 * during IME composition, handled on `compositionend`) is clamped to the length
 * limit and written to Y.Text with a minimal diff — so ending an edit needs no
 * final write. Enter inserts a newline (not intercepted); Escape ends editing.
 */
export function StickyTextEditor(props: StickyTextEditorProps) {
  const { ytext, fontPx, onEnd } = props;
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const composingRef = useRef(false);
  const [len, setLen] = useState(() => ytext.toString().length);
  // Story 8. `boundary` is stable; the controller is read through a ref-free value
  // because the key handler below is rebuilt every render anyway.
  const boundary = useUndoBoundary();
  const undo = useUndoController();

  // Mount: seed value, focus, caret at end of the existing text.
  useEffect(() => {
    const ta = ref.current;
    if (!ta) return;
    ta.value = ytext.toString();
    setLen(ta.value.length);
    ta.focus();
    const end = ta.value.length;
    try {
      ta.setSelectionRange(end, end);
    } catch {
      /* jsdom may not support selection ranges */
    }
    // Opening a note is the start of an action, and closing it — by Escape, by a
    // click elsewhere, by the note being deleted or the board unmounting — is the
    // end of one. Without this, a line typed right after a drag would be undone
    // *with* the drag (TC-16) and recolouring straight after typing would be the
    // same step.
    boundary();
    return boundary;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const commit = () => {
    const ta = ref.current;
    if (!ta) return;
    const raw = ta.value;
    const clamped = clampToLimit(raw);
    if (clamped !== raw) {
      ta.value = clamped;
      const end = clamped.length;
      try {
        ta.setSelectionRange(end, end);
      } catch {
        /* ignore */
      }
    }
    applyTextDiff(ytext, clamped, LOCAL_ORIGIN);
    setLen(clamped.length);
  };

  /**
   * The document moved underneath the textarea (an undo, a redo, a colleague's
   * edit): show what is in the document now, caret at the end.
   */
  const reseed = () => {
    const ta = ref.current;
    if (!ta) return;
    const value = ytext.toString();
    ta.value = value;
    setLen(value.length);
    try {
      ta.setSelectionRange(value.length, value.length);
    } catch {
      /* ignore */
    }
  };

  const onInput = () => {
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
    // Enter intentionally falls through: it inserts a newline in the textarea.
    //
    // Ctrl/Cmd+Z inside a note means *the board's* undo. Left alone, the textarea
    // would undo its own last keystrokes from browser history — leaving the
    // document holding something else entirely — and the window-level shortcut
    // never sees the key, because a focused textarea is an editable target. So the
    // chord is taken here: commit first (a pending IME line is part of what I
    // typed), then reverse one step of my own history and show the result.
    const chord = (e.ctrlKey || e.metaKey) && !e.altKey;
    const key = e.key.toLowerCase();
    if (!chord || (key !== 'z' && key !== 'y')) return;
    const direction = key === 'y' ? 'redo' : e.shiftKey ? 'redo' : 'undo';
    if (!undo) return;
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
        data-testid="sticky-text-editor"
        className="sticky-note__editor"
        spellCheck={false}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          border: 'none',
          resize: 'none',
          outline: 'none',
          background: 'transparent',
          color: 'inherit',
          font: 'inherit',
          fontSize: `${fontPx}px`,
          lineHeight: 1.25,
          padding: 0,
          margin: 0,
          textAlign: 'center',
          whiteSpace: 'pre-wrap',
          overflowWrap: 'break-word',
          overflow: 'hidden',
          boxSizing: 'border-box',
          caretColor: '#2c2f36',
        }}
        onInput={onInput}
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
          // Defensive flush: every input is already committed, but guard any
          // pending value not routed through `input` (skipped mid-composition).
          if (!composingRef.current) commit();
        }}
      />
      {counterVisible(len) ? (
        <span
          data-testid="sticky-counter"
          className="sticky-note__counter"
          style={{
            position: 'absolute',
            right: 6,
            bottom: 4,
            fontSize: 11,
            color: 'rgba(44,47,54,0.7)',
            pointerEvents: 'none',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {len}/{STICKY_TEXT_MAX_CHARS}
        </span>
      ) : null}
    </>
  );
}
