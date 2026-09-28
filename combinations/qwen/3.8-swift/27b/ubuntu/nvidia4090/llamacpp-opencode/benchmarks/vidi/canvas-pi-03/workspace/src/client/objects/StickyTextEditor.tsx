import { useEffect, useRef, useState, type JSX } from 'react';
import * as Y from 'yjs';
import { STICKY_TEXT_MAX_CHARS } from 'src/shared/config';
import { clampToLimit, applyTextDiff, adjustCaret, counterVisible } from './StickyText';
import { LOCAL_ORIGIN } from 'src/shared/board-model';
import type { UndoController } from '../board/undo';

export interface StickyTextEditorProps {
  ytext: Y.Text;
  fontPx: number;
  onEnd: (next: 'selected' | 'unselected') => void;
  /** Story 8: the board's per-user undo controller. */
  undo: UndoController;
}

const PADDING = 12; // world units; must match the display-mode text padding in StickyNote

/**
 * Text editing for one sticky note. The textarea is uncontrolled and every
 * committed `input`/`paste` is written to the Y.Text immediately via a minimal
 * diff, so ending editing (Escape, outside click, unmount) performs no
 * additional write and can never lose typed characters.
 */
export function StickyTextEditor(props: StickyTextEditorProps): JSX.Element {
  const { ytext, fontPx, onEnd, undo } = props;
  const ref = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  const endedRef = useRef(false);
  const undoRef = useRef(undo);
  undoRef.current = undo;
  const [length, setLength] = useState(() => ytext.length);

  // Story 8: an edit session starts its own undo step — the boundary closes
  // the capture window so typing never merges with the action that started
  // the edit (undo.boundaries).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    undoRef.current.boundary();
  }, []);
  // Reflect REMOTE Y.Text changes into the (uncontrolled) textarea in real
  // time, keeping the local caret stable. Without this, a subsequent local
  // diff would be computed against a value that lacks the remote characters
  // and would delete them — concurrent typing would lose characters.
  useEffect(() => {
    const onRemoteUpdate = (event: Y.YTextEvent, transaction: Y.Transaction) => {
      if (transaction.origin === LOCAL_ORIGIN) return; // local changes are already in the DOM
      const el = ref.current;
      if (!el || endedRef.current) return;
      const prevCaret = el.selectionStart ?? el.value.length;
      const nextCaret = adjustCaret(prevCaret, event.delta);
      el.value = ytext.toString();
      el.setSelectionRange(nextCaret, nextCaret);
      setLength(el.value.length);
    };
    ytext.observe(onRemoteUpdate);
    return () => ytext.unobserve(onRemoteUpdate);
  }, [ytext]);

  // A pointerdown anywhere outside the note ends editing as unselected.
  // Capture phase so this fires before the viewport/note handlers act.
  useEffect(() => {
    const onPointerDown = (e: Event) => {
      const el = ref.current;
      if (!el || endedRef.current) return;
      if (el.contains(e.target as Node)) return;
      end('unselected');
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const end = (next: 'selected' | 'unselected') => {
    if (endedRef.current) return;
    endedRef.current = true;
    // Story 8: ending the edit closes the capture window, so the burst of
    // typing is one finished step and the next action starts a new one.
    undoRef.current.boundary();
    onEnd(next);
  };

  const commit = (value: string, caret: number) => {
    const kept = clampToLimit(value);
    const el = ref.current!;
    el.value = kept;
    const safeCaret = Math.max(0, Math.min(caret, kept.length));
    el.setSelectionRange(safeCaret, safeCaret);
    setLength(kept.length);
    if (kept !== ytext.toString()) {
      applyTextDiff(ytext, kept, LOCAL_ORIGIN);
    }
  };

  const handleInput = () => {
    const el = ref.current;
    if (!el || composingRef.current) return;
    const caret = el.selectionStart ?? el.value.length;
    commit(el.value, Math.min(caret, el.value.length));
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    e.preventDefault();
    const el = ref.current!;
    const text = e.clipboardData.getData('text/plain');
    if (text === '') return;
    const start = el.selectionStart ?? el.value.length;
    const endSel = el.selectionEnd ?? start;
    const next = el.value.slice(0, start) + text + el.value.slice(endSel);
    commit(next, start + text.length);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      // sticky.edit_end: keep all text typed so far (already in the doc).
      e.preventDefault();
      end('selected');
      return;
    }
    // Story 8: Ctrl/Cmd+Z / Ctrl/Cmd+Shift+Z / Ctrl+Y inside the editor are
    // routed to the board's controller with preventDefault, so the browser's
    // native textarea undo can never diverge from the Y.Text (and
    // useBoardKeys ignores the event while a sticky is being edited).
    if (e.ctrlKey || e.metaKey) {
      if (e.key === 'z' || e.key === 'Z') {
        e.preventDefault();
        if (e.shiftKey) undoRef.current.redo();
        else undoRef.current.undo();
        return;
      }
      if (e.key === 'y' || e.key === 'Y') {
        e.preventDefault();
        undoRef.current.redo();
        return;
      }
    }
    // Enter is NOT intercepted: it inserts a newline inside the note.
  };

  const handleCompositionStart = () => {
    composingRef.current = true;
  };

  const handleCompositionEnd = () => {
    composingRef.current = false;
    handleInput();
  };

  // Defensively flush any pending value on blur (IME guard: not mid-composition).
  const handleBlur = () => {
    const el = ref.current;
    if (!el || composingRef.current) return;
    if (el.value !== ytext.toString()) {
      applyTextDiff(ytext, el.value, LOCAL_ORIGIN);
    }
  };

  const showCounter = counterVisible(length);

  return (
    <div
      data-testid="sticky-text-editor"
      style={{ position: 'absolute', inset: 0 }}
    >
      <textarea
        ref={ref}
        defaultValue={ytext.toString()}
        aria-label="Sticky note text"
        data-testid="sticky-note-textarea"
        spellCheck={false}
        wrap="soft"
        onInput={handleInput}
        onPaste={handlePaste}
        onKeyDown={handleKeyDown}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
        onBlur={handleBlur}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          boxSizing: 'border-box',
          padding: PADDING,
          margin: 0,
          border: 'none',
          outline: 'none',
          resize: 'none',
          overflow: 'hidden',
          background: 'transparent',
          color: 'inherit',
          textAlign: 'center',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          fontFamily: 'inherit',
          lineHeight: 1.2,
          fontSize: fontPx,
          cursor: 'text',
        }}
      />
      {showCounter && (
        <span
          data-testid="sticky-char-counter"
          style={{
            position: 'absolute',
            right: 6,
            bottom: 2,
            fontSize: 10,
            color: 'rgba(0,0,0,0.55)',
            pointerEvents: 'none',
          }}
        >
          {length}/{STICKY_TEXT_MAX_CHARS}
        </span>
      )}
    </div>
  );
}
