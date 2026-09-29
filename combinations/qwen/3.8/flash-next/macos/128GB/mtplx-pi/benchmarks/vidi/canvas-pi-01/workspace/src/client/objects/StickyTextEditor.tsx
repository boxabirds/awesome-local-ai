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
  useEffect,
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
import type { UndoController } from '../board/undo';

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
  /**
   * The personal undo history (story 8). A whole editing session is one step: a
   * boundary is opened on mount and closed on unmount, and every keystroke is
   * marked with `typingEdit` so a run of typing merges into one undo step. With
   * no controller (read-only / unit tests) the editor still writes but owns no
   * history.
   */
  undo?: UndoController;
}

export function StickyTextEditor(props: StickyTextEditorProps): JSX.Element {
  const { ytext, initial, box, padding, fontPx, onEnd, undo } = props;

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState(initial);
  const [font, setFont] = useState<{ fontPx: number; overflow: boolean }>({
    fontPx: fontPx,
    overflow: false,
  });
  const composingRef = useRef(false);
  const undoRef = useRef(undo);
  undoRef.current = undo;

  // Editing a note is ONE undo step: open a boundary here (a fresh step, separate
  // from whatever came before) and close it on unmount so the next action is its
  // own step. Typing inside the session merges via `typingEdit` below.
  useLayoutEffect(() => {
    undoRef.current?.boundary();
    return () => {
      undoRef.current?.boundary();
    };
  }, []);

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

  // Keep the visible text in sync with the underlying `Y.Text`. Typing already
  // pushes `value` → `Y.Text`, but an *external* change — an undo/redo driven by
  // Ctrl+Z here, the toolbar, or the board — rewrites the `Y.Text` without going
  // through this field. Without this observer the data would revert while the
  // textarea kept showing the old string. We only rewrite when the string
  // actually differs (so our own keystrokes, which already set `value`, are
  // unaffected) and drop the caret at the end.
  useEffect(() => {
    const observer = (event: Y.YTextEvent, origin: unknown) => {
      if (origin === LOCAL_ORIGIN) return; // our own keystroke: value is already current
      void event;
      const next = ytext.toString();
      setValue((prev) => {
        if (prev === next) return prev;
        const el = textareaRef.current;
        if (el) {
          requestAnimationFrame(() => {
            try {
              el.setSelectionRange(next.length, next.length);
            } catch {
              // ignore selection on a non-focused control
            }
          });
        }
        return next;
      });
      setFont(fitText(next, box, box));
    };
    ytext.observe(observer);
    return () => ytext.unobserve(observer);
  }, [ytext, box]);

  const commit = useCallback(
    (next: string) => {
      const el = textareaRef.current;
      const clamped = clampToLimit(next);
      // Mark the keystroke on the history clock before writing, so a continuous
      // burst stays one step and a pause after 500 ms starts a new one.
      undoRef.current?.typingEdit();
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
      return;
    }
    // Ctrl/Cmd+Z inside the field drives the *personal history*, not the
    // browser's textarea undo (criterion 10): we preventDefault to stop the
    // native undo and route to the controller, and stopPropagation so the
    // board-level handler does not also fire.
    if ((event.ctrlKey || event.metaKey) && !event.altKey) {
      const key = event.key.toLowerCase();
      const isUndo = key === 'z' && !event.shiftKey;
      const isRedo = (key === 'z' && event.shiftKey) || key === 'y';
      if (isUndo || isRedo) {
        const undo = undoRef.current;
        if (!undo) return;
        event.preventDefault();
        event.stopPropagation();
        if (isUndo) undo.undo();
        else undo.redo();
      }
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