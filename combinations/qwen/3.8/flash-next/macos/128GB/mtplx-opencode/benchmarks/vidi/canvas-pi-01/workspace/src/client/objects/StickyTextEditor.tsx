/**
 * Story 2 · task 4 — the sticky note text editor (design "Sticky note text
 * editing and fit").
 *
 * A transparent `textarea` overlaid on the note, used only while a note is
 * being edited. It writes every keystroke straight into the note's `Y.Text`
 * (via a minimal diff, clamped to the character limit), so ending editing needs
 * no extra write and no characters can be lost on blur or unmount. It owns the
 * auto-fit font size, the bottom "text overflow" fade and the character counter
 * (shown only within the last 50 characters of the limit). Escape ends editing
 * with the selection kept; a pointer-down outside the note ends it unselected
 * (handled by the board surface, not here).
 */
import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import { applyTextDiff, clampToLimit, counterVisible, fitText } from './StickyText';

export interface StickyTextEditorProps {
  ytext: Y.Text;
  /** Text at the moment editing began (caret is placed at its end). */
  initial: string;
  /** Inner content box (note size minus padding), in world units. */
  box: number;
  /** Padding around the text, in world units. */
  padding: number;
  /** Font size to start from, in world units. */
  fontPx: number;
  onEnd(next: 'selected' | 'unselected'): void;
}

export function StickyTextEditor(props: StickyTextEditorProps): JSX.Element {
  const { ytext, initial, box, padding, fontPx, onEnd } = props;

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState(initial);
  const [font, setFont] = useState<{ fontPx: number; overflow: boolean }>({
    fontPx: fontPx,
    overflow: false,
  });
  const composingRef = useRef(false);

  // On mount: focus the textarea and place the caret at the end of the text
  // (PRD "cursor at the end"), then fit once to the current content.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    const length = value.length;
    el.focus();
    try {
      el.setSelectionRange(length, length);
    } catch {
      // Some engines reject a selection on a non-focused control; ignore.
    }
    setFont(fitText(value, box, box));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const commit = useCallback(
    (next: string) => {
      const el = textareaRef.current;
      const clamped = clampToLimit(next);
      applyTextDiff(ytext, clamped, LOCAL_ORIGIN);
      setValue(clamped);
      setFont(fitText(clamped, box, box));
      if (el && next.length > clamped.length) {
        // If the input was truncated, drop the caret at the end of the kept
        // text (PRD "caret restored to end of kept text").
        try {
          el.setSelectionRange(clamped.length, clamped.length);
        } catch {
          // ignore
        }
      }
    },
    [ytext, box],
  );

  const onInput = (nextValue: string) => {
    if (composingRef.current) return; // IME: handled on compositionend
    commit(nextValue);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onEnd('selected');
    }
    // Enter is intentionally not intercepted: it inserts a newline.
  };

  return (
    <div
      className={`sticky-content sticky-editing${font.overflow ? ' text-overflow-fade' : ''}`}
      data-editing="true"
      style={{ padding: `${padding}px` }}
    >
      <textarea
        ref={textareaRef}
        className="sticky-textarea"
        data-testid="sticky-editor"
        aria-label="Sticky note text"
        value={value}
        spellCheck={false}
        style={{ fontSize: `${font.fontPx}px` }}
        onChange={(event) => {
          if (!composingRef.current) onInput(event.target.value);
        }}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={(event) => {
          composingRef.current = false;
          // Flush the completed composition through the same path.
          onInput((event.target as HTMLTextAreaElement).value);
        }}
        onKeyDown={onKeyDown}
      />
      {counterVisible(value.length) ? (
        <div className="sticky-counter" data-testid="sticky-counter">
          {`${value.length}/${STICKY_TEXT_MAX_CHARS}`}
        </div>
      ) : null}
    </div>
  );
}