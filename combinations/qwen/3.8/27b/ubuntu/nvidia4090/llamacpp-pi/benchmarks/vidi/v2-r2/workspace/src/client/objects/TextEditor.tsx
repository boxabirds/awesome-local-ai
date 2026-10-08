/**
 * Generalised inline text editor (story 9, text.object; generalised from
 * story 2's sticky editor). One implementation serves sticky notes (auto-
 * fit font, padding, fade, counter) and free text (fixed font per size
 * preset, no background).
 *
 * - A native textarea (native IME: input is committed once per composition,
 *   so CJK never duplicates), filling its object's content box.
 * - Every input event: clamp to `maxChars`, write the minimal diff into the
 *   shared Y.Text (single transaction, LOCAL_ORIGIN), run the optional font
 *   auto-fit, and call `onInput()` so the object can re-measure its box
 *   (useTextBoxSync for text objects).
 * - Escape → onEnd('selected'); pointerdown outside this object's editor →
 *   onEnd('unselected'). A blurred editor defensively flushes its diff.
 * - Undo boundaries (story 8): one on mount (edit start), one on unmount
 *   (edit end — covers Escape, outside click and the object disappearing),
 *   so the whole edit is one capture window. Ctrl/Cmd+Z inside the editor
 *   undoes this tab's last step.
 * - The length counter (when `ui.counterNear` is set) appears only within
 *   that many characters of the limit.
 */
import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import type * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { TEXT_FONT_FAMILY, TEXT_LINE_HEIGHT } from '../../shared/config';
import { clampToLimit } from '../../shared/text-edit';
import {
  adjustCaretForMerge,
  applyTextDiff,
} from './StickyText';

/** Presentation knobs so each object type keeps its own look. */
export interface TextEditorUi {
  /** Accessible name of the textarea. */
  ariaLabel: string;
  /** data-testid of the textarea (story 2 tests use "sticky-textarea"). */
  textareaTestid: string;
  /** data-testid of the editor root (default "text-editor"). */
  editorTestid?: string;
  /** data-testid of the length counter (default "text-counter"). */
  counterTestid?: string;
  /** data-testid of the overflow fade (omit for no fade). */
  fadeTestid?: string;
  /** Inset of the textarea inside the object, world units (default 0). */
  padding?: number;
  /** Horizontal alignment (default 'left'; the shape label uses 'center'). */
  textAlign?: 'left' | 'center';
  /** Line-height ratio (default TEXT_LINE_HEIGHT). */
  lineHeight?: number;
  /** Ink colour (default the text object ink). */
  color?: string;
  /** Show the length counter within this many characters of maxChars. */
  counterNear?: number;
}

/** The minimal undo surface the editor needs (UndoController satisfies it). */
export interface TextEditorUndo {
  /** Close the undo capture window (edit start/end). */
  boundary(): void;
  /** Undo this tab's last step. */
  undo(): void;
}

export interface TextEditorProps {
  /** The shared text content. */
  ytext: Y.Text;
  /** Characters beyond this limit are dropped (clamped on input). */
  maxChars: number;
  /** Font size in world units (maximum when `fit` is provided). */
  fontPx: number;
  /** Content width available to the text, world units, or 'auto' (the box
   *  grows with the content; free text in auto mode). */
  width: number | 'auto';
  /** Called after each local input commit (box re-measurement hook). */
  onInput(): void;
  /** End editing: 'selected' (Escape) or 'unselected' (outside press). */
  onEnd(next: 'selected' | 'unselected'): void;
  /** This tab's undo controller surface (story 8). */
  undo: TextEditorUndo;
  /** Presentation (per object type). */
  ui: TextEditorUi;
  /**
   * Optional font auto-fit (sticky notes): called with the textarea to
   * choose the rendered font size; omitted for free text (fixed font).
   */
  fit?(ta: HTMLTextAreaElement): { fontPx: number; overflow: boolean };
}

/** Ink colour for free text objects (matches the sticky ink). */
export const TEXT_INK = '#3c3c34';

export function TextEditor({
  ytext,
  maxChars,
  fontPx,
  width: _width,
  onInput,
  onEnd,
  undo,
  ui,
  fit,
}: TextEditorProps): JSX.Element {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Undo boundaries (story 8, undo.boundaries): one on edit start (mount)
  // and one on edit end (unmount — covers Escape, outside click and the
  // object disappearing), so the whole edit is one capture window.
  const undoRef = useRef(undo);
  undoRef.current = undo;
  useEffect(() => {
    undoRef.current.boundary();
    return () => {
      undoRef.current.boundary();
    };
  }, []);
  const composingRef = useRef(false);
  // The merged Y.Text content the textarea currently represents. The observe
  // handler keeps this in lockstep with ytext so a local commit always diffs
  // against up-to-date content and never deletes a concurrent remote edit.
  const lastMergedRef = useRef('');
  const [fitResult, setFitResult] = useState<{ fontPx: number; overflow: boolean }>({
    fontPx,
    overflow: false,
  });
  const [length, setLength] = useState(0);

  const renderedFontPx = fit !== undefined ? fitResult.fontPx : fontPx;
  const lineHeight = ui.lineHeight ?? TEXT_LINE_HEIGHT;

  // Reflect a merged Y.Text value into the textarea: replace the value, keep
  // the caret stable across the change, and re-fit / re-count.
  const syncFromMerged = useCallback(
    (merged: string): void => {
      const ta = taRef.current;
      if (ta !== null) {
        const caret = adjustCaretForMerge(lastMergedRef.current, merged, ta.selectionStart);
        ta.value = merged;
        ta.setSelectionRange(caret, caret);
        if (fit !== undefined) {
          setFitResult(fit(ta));
        }
      }
      lastMergedRef.current = merged;
      setLength(merged.length);
    },
    [fit],
  );

  // Take over the current text, focus, and put the caret at the end.
  useEffect(() => {
    const ta = taRef.current;
    if (ta === null) {
      return;
    }
    lastMergedRef.current = ytext.toString();
    ta.value = lastMergedRef.current;
    setLength(ta.value.length);
    ta.focus();
    const len = ta.value.length;
    ta.setSelectionRange(len, len);
    if (fit !== undefined) {
      setFitResult(fit(ta));
    }
  }, [ytext, fit]);

  // Merge every Y.Text change (local or remote) into the textarea so
  // concurrent edits appear in the box being edited and the caret stays put.
  // Yjs fires this synchronously when a change is applied, so it always runs
  // before the next local input is committed.
  useEffect(() => {
    const onChange = (): void => {
      const merged = ytext.toString();
      if (merged === lastMergedRef.current) {
        return; // our own commit: already reflected in the textarea
      }
      if (composingRef.current) {
        // Don't clobber an in-progress IME composition; it is re-synced on
        // compositionend. Track the merged content for the next caret calc.
        lastMergedRef.current = merged;
        return;
      }
      syncFromMerged(merged);
    };
    ytext.observe(onChange);
    return () => {
      ytext.unobserve(onChange);
    };
  }, [ytext, syncFromMerged]);

  // pointerdown anywhere outside THIS editor's object ends editing
  // (unselected).
  useEffect(() => {
    const onPointerDown = (e: PointerEvent): void => {
      const root = rootRef.current;
      if (root === null) {
        return;
      }
      if (e.target instanceof Node && root.contains(e.target)) {
        return; // inside this object: keep editing
      }
      onEnd('unselected');
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [onEnd]);

  const commit = (value: string): void => {
    const kept = clampToLimit(value, maxChars);
    setLength(kept.length);
    // Mark the value as already reflected so the observe handler skips our
    // own commit (the native caret is left exactly where the user put it).
    lastMergedRef.current = kept;
    applyTextDiff(ytext, kept, LOCAL_ORIGIN);
    const ta = taRef.current;
    if (ta !== null && fit !== undefined) {
      setFitResult(fit(ta));
    }
    // Box re-measurement (story 9): the object's stored width/height is a
    // cache of the measured layout; this input just changed it.
    onInput();
  };

  const onInputEvent = (): void => {
    if (composingRef.current) {
      return; // IME: the final value is committed on compositionend
    }
    const ta = taRef.current;
    if (ta === null) {
      return;
    }
    const clamped = clampToLimit(ta.value, maxChars);
    if (clamped !== ta.value) {
      // The typed text crossed the limit: keep the first `maxChars`
      // characters and move the caret to the end of the kept text.
      ta.value = clamped;
      const len = clamped.length;
      ta.setSelectionRange(len, len);
    }
    commit(clamped);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    // Ctrl/Cmd+Z (story 8): undo this tab's last step and suppress the
    // browser's native textarea undo so it never diverges from the Y.Text;
    // the Y.Text change flows back into the textarea through the observe
    // handler. Ctrl/Cmd+Shift+Z (redo) is left to the board shortcut once
    // editing ends.
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      undoRef.current.undo();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      // Consume this Escape: end editing but keep the object selected
      // (sel.keyboard: board-level Escape deselects, editor Escape does not).
      // stopPropagation keeps it from reaching the board's window keydown
      // handler — React flushes this end-edit synchronously, so by the time
      // the event would bubble to window the board already sees "not
      // editing" and would wrongly clear the selection.
      e.stopPropagation();
      e.nativeEvent.stopPropagation();
      onEnd('selected');
    }
    // Enter inserts a newline (native behaviour); the board-level handler
    // ignores it while editing, so it never re-triggers editing.
  };

  const onBlur = (): void => {
    // Defensive flush: if the editor unmounts before a commit (e.g. the
    // object is deleted elsewhere), sync the last local value into the
    // Y.Text.
    const ta = taRef.current;
    if (ta !== null && !composingRef.current && ta.value !== ytext.toString()) {
      lastMergedRef.current = clampToLimit(ta.value, maxChars);
      applyTextDiff(ytext, clampToLimit(ta.value, maxChars), LOCAL_ORIGIN);
    }
  };

  const padding = ui.padding ?? 0;
  const overflow = fit !== undefined && fitResult.overflow;

  return (
    <div
      ref={rootRef}
      data-testid={ui.editorTestid ?? 'text-editor'}
      style={{ position: 'absolute', inset: 0 }}
    >
      <textarea
        ref={taRef}
        data-testid={ui.textareaTestid}
        aria-label={ui.ariaLabel}
        spellCheck={false}
        onInput={onInputEvent}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={() => {
          composingRef.current = false;
          onInputEvent();
        }}
        style={{
          position: 'absolute',
          inset: padding,
          padding: 0,
          margin: 0,
          border: 'none',
          outline: 'none',
          resize: 'none',
          background: 'transparent',
          fontFamily: TEXT_FONT_FAMILY,
          fontSize: `${renderedFontPx}px`,
          lineHeight: String(lineHeight),
          overflow: 'hidden',
          color: ui.color ?? TEXT_INK,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          textAlign: ui.textAlign ?? 'left',
        }}
      />
      {overflow && ui.fadeTestid !== undefined && (
        <div
          data-testid={ui.fadeTestid}
          className="sticky-note-fade"
          style={{
            position: 'absolute',
            left: padding,
            right: padding,
            bottom: 0,
            height: 28,
            background: 'linear-gradient(to bottom, rgba(0,0,0,0), rgba(0,0,0,0.22))',
            pointerEvents: 'none',
          }}
        />
      )}
      {ui.counterNear !== undefined && maxChars - length <= ui.counterNear && (
        <span
          data-testid={ui.counterTestid ?? 'text-counter'}
          style={{
            position: 'absolute',
            right: padding,
            bottom: 2,
            fontSize: '10px',
            lineHeight: '12px',
            color: 'rgba(60, 60, 52, 0.65)',
            pointerEvents: 'none',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {length}/{maxChars}
        </span>
      )}
    </div>
  );
}
