// Sticky note text editor (story 2). A transparent <textarea> mounted over a
// note while it is being edited. Every `input` writes the minimal diff into the
// note's Y.Text, so ending an edit performs no extra write and can never lose
// typed characters.
import { useEffect, useRef } from 'react';
import type React from 'react';
import type * as Y from 'yjs';
import { applyTextDiff, clampToLimit, counterVisible } from './StickyText.ts';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config.ts';
import { LOCAL_ORIGIN } from '../../shared/board-model.ts';
import type { EndMode } from '../board/useSelection.ts';

export interface StickyTextEditorProps {
  ytext: Y.Text;
  fontPx: number;
  onEnd(next: EndMode): void;
}

const PADDING = 12;

export function StickyTextEditor(props: StickyTextEditorProps): React.JSX.Element {
  const { ytext, fontPx, onEnd } = props;
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const composing = useRef(false);

  // Mount: seed the textarea from the Y.Text, focus it, place the caret at the
  // end of the existing text (covers `sticky.edit_start`).
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    const initial = ytext.toString();
    ta.value = initial;
    ta.focus();
    const end = ta.value.length;
    ta.setSelectionRange(end, end);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const commit = (raw: string) => {
    const ta = taRef.current;
    const clamped = clampToLimit(raw);
    if (ta && clamped !== raw) {
      // Characters beyond the limit are dropped; caret goes to end of kept text.
      ta.value = clamped;
      const end = clamped.length;
      ta.setSelectionRange(end, end);
    }
    applyTextDiff(ytext, clamped, LOCAL_ORIGIN);
  };

  const onInput = (e: React.FormEvent<HTMLTextAreaElement>) => {
    if (composing.current) return; // handled on compositionend
    commit((e.target as HTMLTextAreaElement).value);
  };

  const onCompositionEnd = (e: React.CompositionEvent<HTMLTextAreaElement>) => {
    composing.current = false;
    commit((e.target as HTMLTextAreaElement).value);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      // Text typed so far is already in the document; keep it, return to selected.
      onEnd('selected');
      return;
    }
    // Enter inserts a newline (default textarea behaviour, not intercepted).
    // Delete/Backspace edit the text here; stop them reaching the board handler.
    if (e.key === 'Enter') {
      e.stopPropagation();
    }
  };

  // A blur caused by a pointerdown outside the note (handled by the note /
  // viewport) tears this editor down; flush any pending uncommitted value first.
  const onBlur = (e: React.FocusEvent<HTMLTextAreaElement>) => {
    if (composing.current) return; // wait for compositionend
    commit((e.target as HTMLTextAreaElement).value);
  };

  return (
    <textarea
      ref={taRef}
      data-testid="sticky-editor"
      className="sticky-editor"
      spellCheck={false}
      onCompositionStart={() => {
        composing.current = true;
      }}
      onCompositionEnd={onCompositionEnd}
      onInput={onInput}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        border: 'none',
        outline: 'none',
        resize: 'none',
        background: 'transparent',
        color: '#202020',
        font: 'inherit',
        fontSize: `${fontPx}px`,
        padding: `${PADDING}px`,
        boxSizing: 'border-box',
        overflow: 'hidden',
        caretColor: '#202020',
        lineHeight: 1.25,
      }}
      aria-label="Sticky note text"
    >
      {/* value is controlled imperatively via the ref to avoid fighting the
          browser's own input handling (IME, caret). */}
    </textarea>
  );
}

export function StickyCharCounter({ length }: { length: number }): React.JSX.Element | null {
  if (!counterVisible(length)) return null;
  return (
    <span data-testid="sticky-counter" className="sticky-counter" aria-live="off">
      {length}/{STICKY_TEXT_MAX_CHARS}
    </span>
  );
}
