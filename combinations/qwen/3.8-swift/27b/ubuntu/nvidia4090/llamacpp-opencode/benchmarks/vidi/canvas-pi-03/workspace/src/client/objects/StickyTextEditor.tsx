import { useEffect, useRef, useState, type JSX } from 'react';
import * as Y from 'yjs';
import { STICKY_TEXT_MAX_CHARS } from 'src/shared/config';
import { clampToLimit, applyTextDiff, counterVisible } from './StickyText';
import { LOCAL_ORIGIN } from 'src/shared/board-model';

export interface StickyTextEditorProps {
  ytext: Y.Text;
  fontPx: number;
  onEnd: (next: 'selected' | 'unselected') => void;
}

const PADDING = 12; // world units; must match the display-mode text padding in StickyNote

/**
 * Text editing for one sticky note. The textarea is uncontrolled and every
 * committed `input`/`paste` is written to the Y.Text immediately via a minimal
 * diff, so ending editing (Escape, outside click, unmount) performs no
 * additional write and can never lose typed characters.
 */
export function StickyTextEditor(props: StickyTextEditorProps): JSX.Element {
  const { ytext, fontPx, onEnd } = props;
  const ref = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  const endedRef = useRef(false);
  const [length, setLength] = useState(() => ytext.length);

  // On mount: focus and put the caret at the end of the text (sticky.edit_start).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

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
