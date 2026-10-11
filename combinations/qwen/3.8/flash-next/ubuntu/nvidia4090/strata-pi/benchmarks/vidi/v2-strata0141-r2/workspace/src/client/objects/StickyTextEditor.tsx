import {
  type JSX,
  type CompositionEvent as ReactCompositionEvent,
  type FormEvent as ReactFormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type * as Y from 'yjs';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { clampToLimit, applyTextDiff, counterVisible } from './StickyText';
import type { EndEditNext } from '../board/useSelection';

/**
 * The note's text editor: a plain textarea whose value is diffed into the
 * shared Y.Text on every keystroke.
 *
 * - typing is written immediately, so ending editing performs no extra write;
 * - characters past the 1,000 character limit are never written at all;
 * - Escape keeps the note selected, a click outside (handled by the note) drops
 *   the selection;
 * - Enter inserts a newline instead of leaving the editor.
 */

export interface StickyTextEditorProps {
  ytext: Y.Text;
  /** Font size chosen by the note's fit measurement, in board units. */
  fontPx: number;
  onEnd(next: EndEditNext): void;
}

function isComposing(event: ReactFormEvent<HTMLTextAreaElement> | ReactKeyboardEvent<HTMLTextAreaElement>): boolean {
  return (event.nativeEvent as CompositionEvent & KeyboardEvent).isComposing === true;
}

export function StickyTextEditor({ ytext, fontPx, onEnd }: StickyTextEditorProps): JSX.Element {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const composingRef = useRef(false);
  const caretRef = useRef<number | 'end' | null>(null);
  const [value, setValue] = useState<string>(() => ytext.toString());

  // Edit start: caret at the end of the existing text.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) {
      return;
    }
    const length = el.value.length;
    el.focus();
    try {
      el.setSelectionRange(length, length);
    } catch {
      // Some browsers refuse setSelectionRange on non-text inputs; harmless.
    }
  }, []);

  // A clamped or remotely replaced value can leave the caret past the end of
  // the text, so the caret is restored in the same commit that changes it.
  useLayoutEffect(() => {
    const target = caretRef.current;
    if (target === null) {
      return;
    }
    caretRef.current = null;
    const el = textareaRef.current;
    if (!el) {
      return;
    }
    const position = target === 'end' ? el.value.length : Math.min(target, el.value.length);
    if (el.selectionStart !== position || el.selectionEnd !== position) {
      el.setSelectionRange(position, position);
    }
  }, [value]);

  // Another client editing the same note while the editor is open.
  useEffect(() => {
    const handler = (event: Y.YTextEvent): void => {
      // Local writes are already reflected in the textarea; adopting them again
      // would fight the caret, so only foreign origins are adopted.
      if (event.transaction.origin === LOCAL_ORIGIN) {
        return;
      }
      const remote = ytext.toString();
      const el = textareaRef.current;
      // Never rewrite an in-progress IME composition; the caret stays put for a
      // plain remote edit so typing can continue where the client left it.
      if (composingRef.current) {
        return;
      }
      const caret = el === null ? remote.length : el.selectionStart;
      setValue(() => remote);
      caretRef.current = caret;
    };
    ytext.observe(handler);
    return () => {
      ytext.unobserve(handler);
    };
  }, [ytext]);

  const applyValue = (next: string): void => {
    try {
      applyTextDiff(ytext, next, LOCAL_ORIGIN);
    } catch {
      // The note (or its text) disappeared mid-keystroke: drop the edit.
    }
  };

  const commit = (next: string): void => {
    const clamped = clampToLimit(next);
    if (clamped !== next) {
      caretRef.current = 'end';
    }
    if (clamped !== value) {
      applyValue(clamped);
    }
    setValue(clamped);
  };

  const handleInput = (event: ReactFormEvent<HTMLTextAreaElement>): void => {
    // IME composition is applied on compositionend instead, so partial
    // composition strings never reach the document.
    if (composingRef.current || isComposing(event)) {
      return;
    }
    commit(event.currentTarget.value);
  };

  const handleCompositionEnd = (event: ReactCompositionEvent<HTMLTextAreaElement>): void => {
    composingRef.current = false;
    commit(event.currentTarget.value);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      commit(event.currentTarget.value);
      onEnd('selected');
      return;
    }
    // Enter inside a note adds a new line; it must not bubble to the board's
    // Enter shortcut or reach the delete shortcut.
    if (event.key === 'Enter' || event.key === 'Delete' || event.key === 'Backspace') {
      event.stopPropagation();
    }
  };

  const handleBlur = (event: ReactFormEvent<HTMLTextAreaElement>): void => {
    // Defensive flush: every input event already wrote, so this is a no-op
    // unless a composition was interrupted.
    commit(event.currentTarget.value);
  };

  return (
    <div className="sticky-editor" data-testid="sticky-editor">
      <textarea
        ref={textareaRef}
        className="sticky-textarea"
        data-testid="sticky-textarea"
        value={value}
        style={{ fontSize: `${fontPx}px` }}
        aria-label="Sticky note text"
        spellCheck
        onChange={handleInput}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={handleCompositionEnd}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
      />
      {counterVisible(value.length) ? (
        <span className="sticky-counter" data-testid="sticky-counter" aria-live="polite">
          {value.length}
          /{STICKY_TEXT_MAX_CHARS}
        </span>
      ) : null}
    </div>
  );
}
