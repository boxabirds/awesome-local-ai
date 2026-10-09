import type { ReactElement } from 'react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import {
  STICKY_TEXT_MAX_CHARS,
} from '../../shared/config';
import type { UndoController } from '../board/undo';
import { applyTextDiff, clampToLimit, counterVisible } from './StickyText';

export interface StickyTextEditorProps {
  ytext: Y.Text;
  fontPx: number;
  padding: number;
  /** The caller's undo controller (story 8). */
  undo: UndoController;
  onEnd(next: 'selected' | 'unselected'): void;
}

/**
 * Textarea bound to a Y.Text via minimal diffs. Focuses with the caret at the
 * end of the text. Remote updates (other people typing) are merged into the
 * textarea without losing the caret. Escape ends editing; a pointerdown
 * outside the note is handled by the parent.
 */
export function StickyTextEditor(props: StickyTextEditorProps): ReactElement {
  const { ytext, fontPx, padding, onEnd } = props;
  const ref = useRef<HTMLTextAreaElement>(null);
  const [length, setLength] = useState(() => ytext.toString().length);
  const undoRef = useRef(props.undo);
  undoRef.current = props.undo;

  // Story 8 (undo.steps): one undo step per editing session — a boundary
  // before the first character and after the last, so consecutive sessions
  // (or a preceding gesture) never merge into one step.
  useEffect(() => {
    undoRef.current.boundary();
    return () => {
      undoRef.current.boundary();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mount: value from Y.Text, focus, caret at end.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.value = ytext.toString();
    el.focus();
    const len = el.value.length;
    el.setSelectionRange(len, len);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Remote updates (origin !== LOCAL_ORIGIN): merge into the textarea, keep caret.
  useEffect(() => {
    const handler = (_events: unknown, transaction: { origin: unknown }) => {
      if (transaction.origin === LOCAL_ORIGIN) return;
      const el = ref.current;
      if (!el) return;
      const next = ytext.toString();
      const caret = Math.min(el.selectionStart ?? next.length, next.length);
      el.value = next;
      el.setSelectionRange(caret, caret);
      setLength(next.length);
    };
    ytext.observe(handler);
    return () => {
      ytext.unobserve(handler);
    };
  }, [ytext]);

  const onInput = () => {
    const el = ref.current;
    if (!el) return;
    const next = clampToLimit(el.value);
    if (el.value.length > next.length) {
      // over the limit: drop the excess, restore caret to the end of kept text
      el.value = next;
      el.setSelectionRange(next.length, next.length);
    }
    applyTextDiff(ytext, next, LOCAL_ORIGIN);
    setLength(next.length);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onEnd('selected');
      return;
    }
    // Story 8: Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z / Ctrl+Y drive the caller's
    // undo history (not the native textarea undo, which would diverge from
    // Y.Text). The result is synced back through the Y.Text observer above.
    const mod = e.ctrlKey || e.metaKey;
    if (mod && (e.key === 'z' || e.key === 'Z') && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      undoRef.current.undo();
      return;
    }
    if ((mod && e.shiftKey && (e.key === 'z' || e.key === 'Z')) || (mod && (e.key === 'y' || e.key === 'Y'))) {
      e.preventDefault();
      e.stopPropagation();
      undoRef.current.redo();
    }
  };

  return (
    <div className="sticky-editor-wrap" style={{ position: 'absolute', inset: 0, zIndex: 5 }}>
      <textarea
        ref={ref}
        aria-label="Note text"
        spellCheck={false}
        onInput={onInput}
        onKeyDown={onKeyDown}
        style={{
          position: 'absolute',
          inset: padding,
          width: 'auto',
          height: 'auto',
          border: 'none',
          outline: 'none',
          resize: 'none',
          background: 'transparent',
          fontFamily: 'inherit',
          fontSize: fontPx,
          lineHeight: 1.25,
          color: '#23272e',
          textAlign: 'center',
          whiteSpace: 'pre-wrap',
          overflow: 'hidden',
        }}
      />
      {counterVisible(length) && (
        <div
          className="char-counter"
          aria-live="polite"
          style={{
            position: 'absolute',
            bottom: 2,
            right: 4,
            fontSize: 10,
            color: 'rgba(0,0,0,0.55)',
            pointerEvents: 'none',
          }}
        >
          {Math.min(length, STICKY_TEXT_MAX_CHARS)}/{STICKY_TEXT_MAX_CHARS}
        </div>
      )}
    </div>
  );
}
