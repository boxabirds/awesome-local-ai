/**
 * Story 9 · task 8 — the generalised text editor (design "TextEditor", shared by
 * sticky notes and free text).
 *
 * The story-2 sticky editor and the story-9 free-text editor need the *same*
 * behaviour: caret at the end on mount, Enter inserts a newline, Escape / an
 * outside click ends editing, a minimal `applyTextDiff` (never a full replace)
 * so a concurrent teammate's characters survive, a clamp to an explicit limit,
 * undo boundaries around the whole session and Ctrl/Cmd+Z routed to the personal
 * history. Rather than copy it, this module lifts the mechanism out and takes
 * the three things that actually differ — `maxChars`, `fontPx` and the measured
 * content box — as props.
 *
 * `StickyTextEditor` is now a thin wrapper that supplies the sticky limit
 * (`STICKY_TEXT_MAX_CHARS`) and the auto-fit font, so every story-2 test and
 * caller is unchanged.
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
import { applyTextDiff, clampToLimit } from '../../shared/text-edit';
import type { UndoController } from '../board/undo';

export interface TextEditorProps {
  ytext: Y.Text;
  /** Text at the moment editing began (caret is placed at its end). */
  initial: string;
  /** Character limit for this editor (sticky: 1,000; text: TEXT_MAX_CHARS). */
  maxChars: number;
  /** Inner content box (object size minus padding), in world units. */
  box: number;
  /** Padding around the text, in world units. */
  padding: number;
  /** Font size to start from, in world units. */
  fontPx: number;
  onEnd(next: 'selected' | 'unselected'): void;
  /** The personal undo history (story 8). Optional; a whole session = one step. */
  undo?: UndoController;
  /**
   * Called after every committed keystroke so the owner can remeasure the stored
   * box (text objects call `remeasureAfterLocalChange`; sticky notes fit the
   * font instead and leave this unset).
   */
  onEdit?(value: string): void;
  /** The accessible name of the textarea. */
  ariaLabel?: string;
  /** The test id of the textarea (defaults to the sticky editor's). */
  testId?: string;
}

/** True when the counter should show: within the last 50 characters of `max`. */
export function counterVisible(length: number, max: number): boolean {
  return max - length <= 50;
}

export function TextEditor(props: TextEditorProps): JSX.Element {
  const { ytext, initial, maxChars, padding, fontPx, onEnd, undo, onEdit, ariaLabel, testId } =
    props;

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState(initial);
  const composingRef = useRef(false);
  const undoRef = useRef(undo);
  undoRef.current = undo;
  const onEditRef = useRef(onEdit);
  onEditRef.current = onEdit;

  // A whole editing session is ONE undo step: open a boundary here and close it
  // on unmount so the next action is its own step; typing merges via typingEdit.
  useLayoutEffect(() => {
    undoRef.current?.boundary();
    return () => {
      undoRef.current?.boundary();
    };
  }, []);

  // On mount: focus and place the caret at the end of the existing text.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the visible text aligned with the underlying `Y.Text` when a change did
  // not come from this field (an undo here, a remote edit, the toolbar). Only
  // rewrite when the string actually differs, so our own keystrokes are ignored.
  useEffect(() => {
    const observer = (event: Y.YTextEvent, origin: unknown) => {
      if (origin === LOCAL_ORIGIN) return;
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
    };
    ytext.observe(observer);
    return () => ytext.unobserve(observer);
  }, [ytext]);

  const commit = useCallback(
    (next: string) => {
      const el = textareaRef.current;
      const clamped = clampToLimit(next, maxChars);
      undoRef.current?.typingEdit();
      applyTextDiff(ytext, clamped, LOCAL_ORIGIN);
      setValue(clamped);
      onEditRef.current?.(clamped);
      if (el && next.length > clamped.length) {
        try {
          el.setSelectionRange(clamped.length, clamped.length);
        } catch {
          // ignore
        }
      }
    },
    [ytext, maxChars],
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
    // Ctrl/Cmd+Z inside the field drives the personal history, not the browser's
    // textarea undo (criterion 10): preventDefault the native undo, route to the
    // controller, and stopPropagation so the board handler does not also fire.
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
      className="text-content text-editing"
      data-editing="true"
      style={{ padding: `${padding}px` }}
    >
      <textarea
        ref={textareaRef}
        className="text-textarea"
        data-testid={testId ?? 'text-editor'}
        aria-label={ariaLabel ?? 'Text'}
        value={value}
        spellCheck={false}
        style={{ fontSize: `${fontPx}px` }}
        onChange={(event) => {
          if (!composingRef.current) onInput(event.target.value);
        }}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={(event) => {
          composingRef.current = false;
          onInput((event.target as HTMLTextAreaElement).value);
        }}
        onKeyDown={onKeyDown}
      />
      {counterVisible(value.length, maxChars) ? (
        <div className="text-counter" data-testid="text-counter">
          {`${value.length}/${maxChars}`}
        </div>
      ) : null}
    </div>
  );
}
