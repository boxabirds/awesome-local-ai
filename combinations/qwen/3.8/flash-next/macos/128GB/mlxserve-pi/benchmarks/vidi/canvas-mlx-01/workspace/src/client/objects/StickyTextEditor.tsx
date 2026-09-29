import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type JSX,
  type ChangeEvent,
  type KeyboardEvent,
} from 'react';
import type * as Y from 'yjs';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config.js';
import { LOCAL_ORIGIN } from '../../shared/board-model.js';
import {
  applyTextDiff,
  clampToLimit,
  counterVisible,
  NOTE_PADDING_PX,
} from './StickyText.js';

export interface StickyTextEditorProps {
  /** The note's live `Y.Text`; every keystroke is written straight to it. */
  ytext: Y.Text;
  /** Current auto-fit font size, shared with the display layer beneath the textarea. */
  fontPx: number;
  /** Called when editing ends: Escape leaves the note selected, a click outside does not. */
  onEnd(next: 'selected' | 'unselected'): void;
}

/**
 * The transparent textarea overlaid on a note's display text while editing.
 *
 * Each `input` event (skipped while an IME composition is in flight, then flushed on
 * `compositionend`) clamps to the character limit, restores the caret when characters
 * were dropped, and writes the *minimal* change to the `Y.Text` so concurrent typing
 * is never destroyed. Because every keystroke is already committed, ending editing
 * performs no additional write; `onBlur` only flushes a defensive remainder. Enter
 * inserts a newline (it is deliberately not intercepted); Escape ends editing with the
 * note still selected; a pointerdown outside the note ends it unselected.
 */
export function StickyTextEditor(props: StickyTextEditorProps): JSX.Element {
  const { ytext, fontPx, onEnd } = props;
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const composingRef = useRef(false);
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;
  const [value, setValue] = useState<string>(() => ytext.toString());

  // On mount: seed the textarea from the document, focus it, and put the caret at the
  // very end of the text (the `sticky.edit_start` requirement). Layout effect so the
  // caret is placed before the first paint.
  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const text = ytext.toString();
    setValue(text);
    textarea.value = text;
    textarea.focus();
    const end = text.length;
    try {
      textarea.setSelectionRange(end, end);
    } catch {
      // Some browsers refuse setSelectionRange on non-text input; never fatal here.
    }
  }, [ytext]);

  // A pointerdown anywhere outside the textarea ends editing as "unselected", captured
  // before the board's own handlers can move focus. Registered after mount so the
  // double-click or Enter that opened the editor is never seen here.
  useEffect(() => {
    const onDocPointerDown = (event: PointerEvent): void => {
      const textarea = textareaRef.current;
      if (textarea && event.target instanceof Node && textarea.contains(event.target)) return;
      onEndRef.current('unselected');
    };
    window.addEventListener('pointerdown', onDocPointerDown, true);
    return () => window.removeEventListener('pointerdown', onDocPointerDown, true);
  }, []);

  /** Clamp a raw value, restore the caret if it was truncated, and diff it into Y.Text. */
  const commit = (raw: string): void => {
    const kept = clampToLimit(raw);
    const textarea = textareaRef.current;
    if (kept !== raw && textarea) {
      // The characters beyond the limit are dropped; the caret goes to the end of what kept.
      textarea.value = kept;
      try {
        textarea.setSelectionRange(kept.length, kept.length);
      } catch {
        // ignore caret failure
      }
    }
    applyTextDiff(ytext, kept, LOCAL_ORIGIN);
    setValue(kept);
  };

  const onInput = (event: ChangeEvent<HTMLTextAreaElement>): void => {
    if (composingRef.current) return;
    commit(event.target.value);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onEndRef.current('selected');
    }
    // Enter and every other key reach the textarea normally (Enter inserts a newline).
  };

  const onBlur = (): void => {
    // Defensive flush: normally every input is already committed. Skip while an IME
    // composition is mid-flight so a half-composed string is never written.
    const textarea = textareaRef.current;
    if (!textarea || composingRef.current) return;
    const kept = clampToLimit(textarea.value);
    if (kept !== ytext.toString()) applyTextDiff(ytext, kept, LOCAL_ORIGIN);
  };

  const showCounter = counterVisible(value.length);

  return (
    <>
      <textarea
        ref={textareaRef}
        className="vidi-note-editor"
        data-testid="sticky-textarea"
        value={value}
        style={{ inset: NOTE_PADDING_PX, fontSize: `${fontPx}px` }}
        spellCheck={false}
        onChange={onInput}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={() => {
          composingRef.current = false;
          const textarea = textareaRef.current;
          if (textarea) commit(textarea.value);
        }}
      />
      {showCounter ? (
        <output
          className="vidi-note-counter"
          data-testid="sticky-counter"
        >{`${value.length}/${STICKY_TEXT_MAX_CHARS}`}</output>
      ) : null}
    </>
  );
}
