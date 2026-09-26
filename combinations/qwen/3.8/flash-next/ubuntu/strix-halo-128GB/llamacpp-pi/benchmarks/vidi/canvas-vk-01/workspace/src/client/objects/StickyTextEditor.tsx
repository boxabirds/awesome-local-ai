import {
  useEffect,
  useRef,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import * as Y from 'yjs';
import {
  STICKY_TEXT_MAX_CHARS,
} from '../../shared/config';
import { clampToLimit, applyTextDiff, counterVisible } from './StickyText';

export interface StickyTextEditorProps {
  ytext: Y.Text;
  fontPx: number;
  onEnd(next: 'selected' | 'unselected'): void;
}

/**
 * Textarea-based text editor for sticky notes.
 * Mounts with caret at end, writes minimal diffs to Y.Text on each input event.
 */
export function StickyTextEditor({ ytext, fontPx, onEnd }: StickyTextEditorProps): JSX.Element {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const composingRef = useRef(false);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    // Set value from Y.Text and place caret at end
    const text = ytext.toString();
    ta.value = text;
    ta.focus();
    ta.setSelectionRange(text.length, text.length);
  }, [ytext]);

  const handleInput = () => {
    if (composingRef.current) return;
    flush();
  };

  const handleCompositionEnd = () => {
    composingRef.current = false;
    flush();
  };

  const handleCompositionStart = () => {
    composingRef.current = true;
  };

  const flush = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    const raw = ta.value;
    const clamped = clampToLimit(raw);
    if (clamped !== raw) {
      // Restore caret to end of kept text
      const caretPos = clamped.length;
      ta.value = clamped;
      ta.setSelectionRange(caretPos, caretPos);
    }
    applyTextDiff(ytext, clamped, null);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      flush();
      onEnd('selected');
    }
    // Enter inserts a newline (default textarea behaviour), we don't intercept
  };

  const text = ytext.toString();
  const showCounter = counterVisible(text.length);

  return (
    <div className="sticky-text-editor" data-testid="sticky-text-editor">
      <textarea
        ref={textareaRef}
        className="sticky-textarea"
        style={{ fontSize: `${fontPx}px` }}
        onInput={handleInput}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
        onKeyDown={handleKeyDown}
        data-testid="sticky-textarea"
      />
      {showCounter && (
        <span className="sticky-counter" data-testid="sticky-counter">
          {text.length}/{STICKY_TEXT_MAX_CHARS}
        </span>
      )}
    </div>
  );
}
