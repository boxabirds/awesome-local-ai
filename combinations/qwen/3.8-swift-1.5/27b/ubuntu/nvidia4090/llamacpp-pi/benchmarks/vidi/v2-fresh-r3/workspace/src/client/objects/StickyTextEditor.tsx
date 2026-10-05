import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import * as Y from 'yjs';
import { STICKY_SIZE_WORLD, STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import {
  clampToLimit,
  applyTextDiff,
  counterVisible,
  fitFontSize,
  STICKY_TEXT_PADDING,
} from './StickyText';
import type { UndoController } from '../board/undo';

const TEXT_BOX = STICKY_SIZE_WORLD - STICKY_TEXT_PADDING * 2;

export interface StickyTextEditorProps {
  ytext: Y.Text;
  /** Font size (board units) the display mode currently uses; re-fitted while typing. */
  fontPx: number;
  onEnd(next: 'selected' | 'unselected'): void;
  /** Story 8: the undo controller for this board. */
  undo?: UndoController;
}

/**
 * Text editing for one sticky note. Mounts a textarea with the current text,
 * focuses it with the caret at the end, and diffs every input into the
 * Y.Text (minimal change, clamped to STICKY_TEXT_MAX_CHARS). Escape ends
 * editing keeping the note selected; a pointerdown outside the note ends it
 * unselected. Every input is written as it happens, so ending editing
 * performs no additional write.
 */
export function StickyTextEditor(props: StickyTextEditorProps): JSX.Element {
  const { ytext, onEnd, undo } = props;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState(() => ytext.toString());
  const [fontPx, setFontPx] = useState(props.fontPx);
  const [overflow, setOverflow] = useState(false);
  const composingRef = useRef(false);
  const endedRef = useRef(false);

  // Mount: focus with the caret at the end of the text (edit start).
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    // Story 8: boundary at edit start so typing doesn't merge with prior actions.
    undo?.boundary();
  }, []);

  // Story 8: boundary at edit end (unmount).
  useEffect(() => {
    return () => {
      undo?.boundary();
    };
  }, [undo]);

  // Pointerdown anywhere outside the note ends editing (unselected).
  useEffect(() => {
    const onPointerDown = (e: PointerEvent | MouseEvent) => {
      if (endedRef.current) return;
      const el = textareaRef.current;
      if (el && e.target instanceof Node && el.contains(e.target)) return;
      endedRef.current = true;
      onEnd('unselected');
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  });

  // Auto-fit the font on mount and on every text change (zoom scales
  // uniformly, so no refit on zoom).
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    const fit = fitFontSize(el, TEXT_BOX);
    setFontPx(fit.fontPx);
    setOverflow(fit.overflow);
  }, [value]);

  const writeValue = (raw: string) => {
    const clamped = clampToLimit(raw);
    setValue(clamped);
    applyTextDiff(ytext, clamped, LOCAL_ORIGIN);
    return clamped;
  };

  const handleInput = () => {
    const el = textareaRef.current;
    if (!el || composingRef.current) return;
    const clamped = writeValue(el.value);
    if (clamped.length !== el.value.length) {
      // Truncated at the limit: restore the caret to the end of kept text.
      el.value = clamped;
      el.setSelectionRange(clamped.length, clamped.length);
    }
  };

  const handleCompositionEnd = () => {
    composingRef.current = false;
    // The input event after compositionend is skipped while composing;
    // write the composed value now so IME text is not lost or duplicated.
    handleInput();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      endedRef.current = true;
      onEnd('selected');
      return;
    }
    // Story 8: intercept Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z / Ctrl+Y inside the
    // editor so native textarea undo never diverges from the Y.Text.
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey && undo) {
        e.preventDefault();
        undo.undo();
        return;
      }
      if (((key === 'z' && e.shiftKey) || key === 'y') && undo) {
        e.preventDefault();
        undo.redo();
        return;
      }
    }
    // Enter inserts a newline (the textarea default).
  };

  // Defensive flush: if the textarea blurs for any reason, make sure the
  // Y.Text matches what is shown (normally a no-op — every input is already
  // written, and ending editing performs no additional write).
  const handleBlur = () => {
    const el = textareaRef.current;
    if (!el) return;
    const clamped = clampToLimit(el.value);
    if (clamped !== ytext.toString()) {
      applyTextDiff(ytext, clamped, LOCAL_ORIGIN);
    }
  };

  return (
    <div
      data-testid="sticky-text-editor"
      className={overflow ? 'sticky-text-editor sticky-fade' : 'sticky-text-editor'}
      style={{ position: 'absolute', inset: 0 }}
    >
      <textarea
        ref={textareaRef}
        data-testid="sticky-textarea"
        value={value}
        onInput={handleInput}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={handleCompositionEnd}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        spellCheck={false}
        style={{
          width: '100%',
          height: '100%',
          padding: STICKY_TEXT_PADDING,
          boxSizing: 'border-box',
          border: 'none',
          outline: 'none',
          resize: 'none',
          background: 'transparent',
          color: '#222',
          fontFamily: 'system-ui, sans-serif',
          fontSize: fontPx,
          lineHeight: 1.2,
          whiteSpace: 'pre-wrap',
          overflowWrap: 'break-word',
          overflow: 'hidden',
          display: 'block',
        }}
      />
      {counterVisible(value.length) && (
        <span
          data-testid="char-counter"
          aria-label={`Character count ${value.length} of ${STICKY_TEXT_MAX_CHARS}`}
          style={{
            position: 'absolute',
            right: 4,
            bottom: 2,
            fontSize: 10,
            lineHeight: 1,
            color: 'rgba(0,0,0,0.55)',
            pointerEvents: 'none',
          }}
        >
          {value.length}/{STICKY_TEXT_MAX_CHARS}
        </span>
      )}
    </div>
  );
}
