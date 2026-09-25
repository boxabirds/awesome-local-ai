/**
 * In-place text editor of a sticky note (anchors: sticky.edit_start, sticky.edit_end,
 * sticky.text_limit).
 *
 * Every `input` event is written straight to the note's Y.Text with a minimal diff, so
 * ending editing needs no extra write and unmounting can never lose characters. During
 * IME composition nothing is written; the composed text is written on compositionend.
 *
 * Undo (anchor: undo.boundaries): editing starts and ends an undo step boundary, so typing
 * never merges with other actions; bursts of typing are grouped by the history's capture
 * timeout. Ctrl/Cmd+Z (redo: Ctrl/Cmd+Shift+Z, Ctrl+Y) undoes typing in this note through
 * the shared history instead of the textarea's native undo, which would diverge from the
 * Y.Text; it never reaches past the typing into earlier actions while the note is edited.
 */
import { useContext, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import type * as Y from 'yjs';
import { isDetachedText, LOCAL_ORIGIN } from '../../shared/board-model';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import { applyTextDiff, clampAtCaret, counterVisible } from './StickyText';
import { UndoContext } from '../board/useUndo';

/** Moves a caret index across a Y.Text delta made by someone else. */
function shiftIndex(index: number, delta: Y.YTextEvent['delta']): number {
  let pos = 0;
  let result = index;
  for (const op of delta) {
    if (op.retain !== undefined) {
      pos += op.retain;
    } else if (op.insert !== undefined) {
      const len = typeof op.insert === 'string' ? op.insert.length : 1;
      if (pos <= result) result += len;
      pos += len;
    } else if (op.delete !== undefined) {
      if (pos < result) result -= Math.min(op.delete, result - pos);
    }
    if (pos > result) break;
  }
  return result;
}

export function StickyTextEditor(props: {
  ytext: Y.Text;
  fontPx: number;
  onEnd(next: 'selected' | 'unselected'): void;
  /** Extra top padding (world units) that vertically centres short text like display mode. */
  offsetTop?: number;
}): React.JSX.Element {
  const { ytext, onEnd } = props;
  const ref = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const [length, setLength] = useState(() => ytext.length);
  const history = useContext(UndoContext);

  // Edit start and end are undo step boundaries.
  useEffect(() => {
    history.boundary();
    return () => history.boundary();
  }, [history]);

  const commit = () => {
    const el = ref.current;
    if (el === null || composing.current || isDetachedText(ytext)) return;
    const { text, caret } = clampAtCaret(el.value, el.selectionEnd ?? el.value.length);
    if (text !== el.value) {
      el.value = text;
      el.setSelectionRange(caret, caret);
    }
    applyTextDiff(ytext, text, LOCAL_ORIGIN);
    setLength(text.length);
  };

  // Edit start: value from the document, focus, caret at the end.
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const value = ytext.toString();
    el.value = value;
    el.focus({ preventScroll: true });
    el.setSelectionRange(value.length, value.length);
  }, [ytext]);

  // Changes made to the text by anyone else (e.g. live collaboration later) show up here.
  useEffect(() => {
    const onChange = (e: Y.YTextEvent, tr: Y.Transaction) => {
      const el = ref.current;
      if (el === null || tr.origin === LOCAL_ORIGIN) return;
      const value = ytext.toString();
      if (el.value === value) return;
      const start = shiftIndex(el.selectionStart, e.delta);
      const end = shiftIndex(el.selectionEnd, e.delta);
      el.value = value;
      el.setSelectionRange(Math.min(start, value.length), Math.min(end, value.length));
      setLength(value.length);
    };
    ytext.observe(onChange);
    return () => ytext.unobserve(onChange);
  }, [ytext]);

  // Edit end by a pointerdown anywhere outside this note, before focus moves.
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const note = ref.current?.closest('.sticky-note');
      if (note instanceof Element && e.target instanceof Node && note.contains(e.target)) return;
      commit();
      onEnd('unselected');
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
    // commit only reads refs and `ytext`, which are fixed for this effect's lifetime.
  }, [onEnd, ytext]);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Keys typed into the note never trigger board shortcuts (Delete, Enter, ...).
    e.stopPropagation();
    const key = e.key.toLowerCase();
    const ctrlOrMeta = (e.ctrlKey || e.metaKey) && !e.altKey;
    const isUndo = ctrlOrMeta && key === 'z' && !e.shiftKey;
    const isRedo = (ctrlOrMeta && key === 'z' && e.shiftKey) || (e.ctrlKey && !e.metaKey && !e.altKey && key === 'y');
    if (isUndo || isRedo) {
      e.preventDefault();
      if (composing.current) return;
      commit();
      history.boundary();
      if (isUndo) history.undoIn(ytext);
      else history.redoIn(ytext);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      commit();
      onEnd('selected');
    }
  };

  const style: CSSProperties = {
    fontSize: `${props.fontPx}px`,
    paddingTop: props.offsetTop === undefined ? undefined : `calc(var(--sticky-padding) + ${props.offsetTop}px)`,
  };

  return (
    <>
      <textarea
        ref={ref}
        className="sticky-editor"
        aria-label="Note text"
        spellCheck
        style={style}
        onInput={(e) => {
          if ((e.nativeEvent as InputEvent).isComposing) return;
          commit();
        }}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={() => {
          composing.current = false;
          commit();
        }}
        onBlur={commit}
        onKeyDown={onKeyDown}
        onPointerDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
      />
      {counterVisible(length) && (
        <div className="sticky-counter" data-testid="sticky-counter" aria-live="polite">
          {`${length}/${STICKY_TEXT_MAX_CHARS}`}
        </div>
      )}
    </>
  );
}
