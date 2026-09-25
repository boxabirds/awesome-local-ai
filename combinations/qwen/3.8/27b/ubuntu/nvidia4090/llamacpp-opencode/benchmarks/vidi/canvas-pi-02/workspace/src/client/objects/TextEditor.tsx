/**
 * General-purpose text editor (story 9): a textarea diffed into Y.Text.
 *
 * - On mount: value from Y.Text, focused, caret at the end.
 * - On input: clamp to `limit`, write the minimal diff.
 * - Escape ends editing (parent handles the selection state).
 * - Ctrl/Cmd+Z / Shift+Z / Y: undo/redo against the Y.Text history.
 * - The character counter shows when within `counterThreshold` of the limit.
 */

import { useEffect, useRef } from 'react';
import type { JSX } from 'react';
import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { applyTextDelta, applyTextDiff, clampToLimit } from '../../shared/text-edit';
import type { UndoController } from '../board/undo';

export interface TextEditorProps {
  /** The live Y.Text; every input is written to it immediately. */
  ytext: Y.Text;
  /** Font size in world px. */
  fontPx: number;
  /** Maximum characters (default TEXT_MAX_CHARS = 5000). */
  limit?: number;
  /** Characters before the limit when the counter becomes visible. */
  counterThreshold?: number;
  /** Escape → 'selected'; outside pointerdown → 'unselected'. */
  onEnd(next: 'selected' | 'unselected'): void;
  /** The tab's undo controller. */
  undo: UndoController;
  /** CSS line-height (unitless multiplier). */
  lineHeight?: number;
}

export function TextEditor(props: TextEditorProps): JSX.Element {
  const { ytext, fontPx, limit = 5000, counterThreshold = 50, onEnd, undo, lineHeight = 1.3 } = props;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  const endedRef = useRef(false);

  const syncToYText = (): void => {
    const ta = textareaRef.current;
    if (!ta) return;
    const value = clampToLimit(ta.value, limit);
    if (value !== ta.value) {
      ta.value = value;
      ta.setSelectionRange(value.length, value.length);
    }
    applyTextDiff(ytext, ta.value, LOCAL_ORIGIN);
  };

  const finish = (next: 'selected' | 'unselected'): void => {
    if (endedRef.current) return;
    endedRef.current = true;
    syncToYText();
    undo.boundary();
    onEnd(next);
  };

  useEffect(() => {
    undo.boundary();
    const ta = textareaRef.current;
    if (!ta) return;
    const text = ytext.toString();
    ta.value = text;
    ta.focus();
    ta.setSelectionRange(text.length, text.length);

    const onRemoteChange = (event: Y.YTextEvent, transaction: Y.Transaction): void => {
      if (transaction.origin === LOCAL_ORIGIN) return;
      const el = textareaRef.current;
      if (!el) return;
      const next = applyTextDelta(el.value, event.delta, el.selectionStart, el.selectionEnd);
      el.value = next.text;
      el.setSelectionRange(next.start, next.end);
    };
    ytext.observe(onRemoteChange);
    return () => {
      ytext.unobserve(onRemoteChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const showCounter = limit - ytext.length <= counterThreshold;

  return (
    <div className="vidi6-text__editor">
      <textarea
        ref={textareaRef}
        className="vidi6-text__textarea"
        style={{
          fontSize: `${fontPx}px`,
          lineHeight,
        }}
        aria-label="Text"
        spellCheck={false}
        wrap="soft"
        onInput={() => {
          if (composingRef.current) return;
          syncToYText();
        }}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={() => {
          composingRef.current = false;
          syncToYText();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            finish('selected');
            return;
          }
          if ((e.ctrlKey || e.metaKey) && !e.altKey) {
            const key = e.key.toLowerCase();
            if (key === 'z' && !e.shiftKey) {
              e.preventDefault();
              undo.undo();
              return;
            }
            if ((key === 'z' && e.shiftKey) || key === 'y') {
              e.preventDefault();
              undo.redo();
              return;
            }
          }
        }}
        onBlur={() => finish('selected')}
      />
      {showCounter && (
        <span
          className="vidi6-text__counter"
          aria-label={`Character count ${ytext.length} of ${limit}`}
        >
          {ytext.length}/{limit}
        </span>
      )}
    </div>
  );
}
