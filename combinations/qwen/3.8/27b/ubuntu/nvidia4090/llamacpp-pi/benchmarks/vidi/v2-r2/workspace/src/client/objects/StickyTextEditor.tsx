import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import type * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import {
  STICKY_SIZE_WORLD,
  STICKY_TEXT_MAX_CHARS,
  STICKY_TEXT_PADDING,
} from '../../shared/config';
import {
  adjustCaretForMerge,
  applyTextDiff,
  clampToLimit,
  counterVisible,
  fitFontSize,
} from './StickyText';

/**
 * The full inner box the text may occupy, in board units
 * (note size minus padding on both sides).
 */
const TEXT_BOX = STICKY_SIZE_WORLD - STICKY_TEXT_PADDING * 2;
const LINE_HEIGHT = 1.2;
const INK_COLOR = '#3c3c34';

export interface StickyTextEditorProps {
  ytext: Y.Text;
  fontPx: number;
  onEnd: (next: 'selected' | 'unselected') => void;
  /**
   * Close the undo capture window (story 8): called when editing starts and
   * ends, so the typing burst is its own undo step and never merges with
   * the action before or after the edit.
   */
  onBoundary?(): void;
  /** Ctrl/Cmd+Z inside the editor: undo this tab's last step (story 8). */
  onUndo?(): void;
}

/**
 * Text box inside a note, in Editing state (story 2).
 *
 * - A native textarea (native IME: input is committed once per composition,
 *   so CJK never duplicates), full note size minus padding.
 * - Every input event: clamp to the 1,000-char limit, write the minimal diff
 *   into the shared Y.Text (single transaction, LOCAL_ORIGIN), re-fit the
 *   font (binary search, no reflow of other notes), and re-measure.
 * - Escape → onEnd('selected'); pointerdown outside the note →
 *   onEnd('unselected'). A blurred editor defensively flushes its diff.
 * - The length counter appears only within 50 characters of the limit.
 */
export function StickyTextEditor({
  ytext,
  fontPx,
  onEnd,
  onBoundary,
  onUndo,
}: StickyTextEditorProps): JSX.Element {
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Undo boundaries (story 8, undo.boundaries): one on edit start (mount) and
  // one on edit end (unmount — covers Escape, outside click and the note
  // disappearing), so the whole edit is one capture window.
  const onBoundaryRef = useRef(onBoundary);
  onBoundaryRef.current = onBoundary;
  useEffect(() => {
    onBoundaryRef.current?.();
    return () => {
      onBoundaryRef.current?.();
    };
  }, []);
  const composingRef = useRef(false);
  // The merged Y.Text content the textarea currently represents. The observe
  // handler keeps this in lockstep with ytext so a local commit always diffs
  // against up-to-date content and never deletes a concurrent remote edit.
  const lastMergedRef = useRef('');
  const [fit, setFit] = useState<{ fontPx: number; overflow: boolean }>({ fontPx, overflow: false });
  const [length, setLength] = useState(0);

  // Reflect a merged Y.Text value into the textarea: replace the value, keep
  // the caret stable across the change, and re-fit / re-count.
  const syncFromMerged = useCallback((merged: string): void => {
    const ta = taRef.current;
    if (ta !== null) {
      const caret = adjustCaretForMerge(lastMergedRef.current, merged, ta.selectionStart);
      ta.value = merged;
      ta.setSelectionRange(caret, caret);
      setFit(fitFontSize(ta, TEXT_BOX));
    }
    lastMergedRef.current = merged;
    setLength(merged.length);
  }, []);

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
    setFit(fitFontSize(ta, TEXT_BOX));
  }, [ytext]);

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

  // pointerdown anywhere outside THIS note ends editing (unselected).
  useEffect(() => {
    const onPointerDown = (e: PointerEvent): void => {
      const ta = taRef.current;
      if (ta === null) {
        return;
      }
      const ownNote = ta.closest('[data-sticky-note]');
      if (ownNote !== null && e.target instanceof Element && ownNote.contains(e.target)) {
        return; // inside this note: keep editing
      }
      onEnd('unselected');
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [onEnd]);

  const commit = (value: string): void => {
    const kept = clampToLimit(value);
    setLength(kept.length);
    // Mark the value as already reflected so the observe handler skips our own
    // commit (the native caret is left exactly where the user put it).
    lastMergedRef.current = kept;
    applyTextDiff(ytext, kept, LOCAL_ORIGIN);
    const ta = taRef.current;
    if (ta !== null) {
      setFit(fitFontSize(ta, TEXT_BOX));
    }
  };

  const onInput = (): void => {
    if (composingRef.current) {
      return; // IME: the final value is committed on compositionend
    }
    const ta = taRef.current;
    if (ta === null) {
      return;
    }
    const clamped = clampToLimit(ta.value);
    if (clamped !== ta.value) {
      // The typed text crossed the limit: keep the first 1,000 characters and
      // move the caret to the end of the kept text (sticky.text_max_chars).
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
      onUndo?.();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      // Consume this Escape: end editing but keep the note selected
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
    // Defensive flush: if the editor unmounts before a commit (e.g. the note
    // is deleted elsewhere), sync the last local value into the Y.Text.
    const ta = taRef.current;
    if (ta !== null && !composingRef.current && ta.value !== ytext.toString()) {
      lastMergedRef.current = clampToLimit(ta.value);
      applyTextDiff(ytext, clampToLimit(ta.value), LOCAL_ORIGIN);
    }
  };

  const overflow = fit.overflow;

  return (
    <div data-testid="sticky-text-editor" style={{ position: 'absolute', inset: 0 }}>
      <textarea
        ref={taRef}
        data-testid="sticky-textarea"
        aria-label="Sticky note text"
        spellCheck={false}
        onInput={onInput}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={() => {
          composingRef.current = false;
          onInput();
        }}
        style={{
          position: 'absolute',
          inset: STICKY_TEXT_PADDING,
          padding: 0,
          margin: 0,
          border: 'none',
          outline: 'none',
          resize: 'none',
          background: 'transparent',
          fontFamily: 'inherit',
          fontSize: `${fit.fontPx}px`,
          lineHeight: String(LINE_HEIGHT),
          overflow: 'hidden',
          color: INK_COLOR,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      />
      {overflow && (
        <div
          data-testid="sticky-fade"
          className="sticky-note-fade"
          style={{
            position: 'absolute',
            left: STICKY_TEXT_PADDING,
            right: STICKY_TEXT_PADDING,
            bottom: 0,
            height: 28,
            background: 'linear-gradient(to bottom, rgba(0,0,0,0), rgba(0,0,0,0.22))',
            pointerEvents: 'none',
          }}
        />
      )}
      {counterVisible(length) && (
        <span
          data-testid="sticky-counter"
          style={{
            position: 'absolute',
            right: STICKY_TEXT_PADDING,
            bottom: 2,
            fontSize: '10px',
            lineHeight: '12px',
            color: 'rgba(60, 60, 52, 0.65)',
            pointerEvents: 'none',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {length}/{STICKY_TEXT_MAX_CHARS}
        </span>
      )}
    </div>
  );
}
