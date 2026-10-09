import type { ReactElement } from 'react';
import { useEffect, useRef } from 'react';
import type * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { clampToLimit, applyTextDiff } from '../../shared/text-edit';
import type { UndoController } from '../board/undo';

export interface TextEditorProps {
  ytext: Y.Text;
  /** Maximum number of characters (extra input is dropped). */
  maxChars: number;
  fontPx: number;
  lineHeight: number;
  /** The textarea's aria-label. */
  ariaLabel: string;
  textAlign?: 'left' | 'center';
  /** Called after a LOCAL text change has been applied to the Y.Text. */
  onInput(): void;
  onEnd(next: 'selected' | 'unselected'): void;
  /** The caller's undo controller (story 8). */
  undo: UndoController;
}

/**
 * Story 9 (text.object): a textarea bound to a Y.Text via minimal diffs
 * (shared text-edit helpers). Focuses with the caret at the end of the text.
 * Remote updates (other people typing) are merged into the textarea without
 * losing the caret. Escape ends editing; a pointerdown outside the object is
 * handled by the parent.
 *
 * Story 8 (undo.steps): one undo step per editing session — a boundary
 * before the first character and after the last — and Ctrl/Cmd+Z /
 * Ctrl/Cmd+Shift+Z / Ctrl+Y drive the caller's undo controller (never the
 * native textarea undo, which would diverge from the Y.Text).
 *
 * StickyTextEditor (story 2) wraps this component with the note's padding,
 * centred alignment, character limit and counter.
 */
export function TextEditor(props: TextEditorProps): ReactElement {
  const { ytext, maxChars, fontPx, lineHeight, ariaLabel, onEnd } = props;
  const ref = useRef<HTMLTextAreaElement>(null);
  const undoRef = useRef(props.undo);
  undoRef.current = props.undo;
  const onInputRef = useRef(props.onInput);
  onInputRef.current = props.onInput;

  useEffect(() => {
    undoRef.current.boundary();
    return () => {
      undoRef.current.boundary();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mount: value from Y.Text, focus, caret at end.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.value = ytext.toString();
    el.focus();
    const len = el.value.length;
    el.setSelectionRange(len, len);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Remote updates (origin !== LOCAL_ORIGIN): merge into the textarea, keep caret.
  useEffect(() => {
    const handler = (_events: unknown, transaction: { origin: unknown }) => {
      if (transaction.origin === LOCAL_ORIGIN) return;
      const el = ref.current;
      if (!el) return;
      const next = ytext.toString();
      const caret = Math.min(el.selectionStart ?? next.length, next.length);
      el.value = next;
      el.setSelectionRange(caret, caret);
    };
    ytext.observe(handler);
    return () => {
      ytext.unobserve(handler);
    };
  }, [ytext]);

  const handleInput = () => {
    const el = ref.current;
    if (!el) return;
    const next = clampToLimit(el.value, maxChars);
    if (el.value.length > next.length) {
      // over the limit: drop the excess, restore caret to the end of kept text
      el.value = next;
      el.setSelectionRange(next.length, next.length);
    }
    applyTextDiff(ytext, next, LOCAL_ORIGIN);
    onInputRef.current();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onEnd('selected');
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    if (mod && (e.key === 'z' || e.key === 'Z') && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      undoRef.current.undo();
      return;
    }
    if ((mod && e.shiftKey && (e.key === 'z' || e.key === 'Z')) || (mod && (e.key === 'y' || e.key === 'Y'))) {
      e.preventDefault();
      e.stopPropagation();
      undoRef.current.redo();
    }
  };

  return (
    <textarea
      ref={ref}
      aria-label={ariaLabel}
      spellCheck={false}
      onInput={handleInput}
      onKeyDown={onKeyDown}
      style={{
        position: 'absolute',
        inset: 0,
        margin: 0,
        padding: 0,
        border: 'none',
        outline: 'none',
        resize: 'none',
        background: 'transparent',
        fontFamily: 'inherit',
        fontSize: fontPx,
        lineHeight,
        color: '#23272e',
        textAlign: props.textAlign ?? 'left',
        whiteSpace: 'pre-wrap',
        overflow: 'hidden',
        // While the stored box is still 0×0 (freshly created, not typed into
        // yet) the editor must still be a non-empty, clickable target.
        minWidth: '1em',
        minHeight: '1em',
        zIndex: 5,
      }}
    />
  );
}
