import { type CSSProperties, useEffect, useLayoutEffect, useRef } from 'react';
import type * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { applyTextDiff, clampEdit } from '../../shared/text-edit';
import type { UndoController } from '../board/undo';
import { undoShortcut } from '../board/useUndo';

/**
 * Maps a caret index through a remote change so it stays next to the same
 * characters. A remote insert exactly at the caret goes after the caret.
 */
function shiftIndex(index: number, delta: readonly { retain?: number; insert?: unknown; delete?: number }[]): number {
  let oldPos = 0;
  let result = index;
  for (const op of delta) {
    if (oldPos >= index) break;
    if (op.retain !== undefined) oldPos += op.retain;
    else if (typeof op.insert === 'string') result += op.insert.length;
    else if (op.delete !== undefined) {
      result -= Math.min(op.delete, index - oldPos);
      oldPos += op.delete;
    }
  }
  return result;
}

/** A Y.Text whose object has been deleted must not be written to. */
function isDetached(ytext: Y.Text): boolean {
  return ytext.doc === null || ytext._item?.deleted === true;
}

/**
 * Textarea editor for any text-bearing object (sticky notes, text objects).
 * Every input is written to `ytext` immediately as a minimal diff, clamped to
 * `maxChars`, so ending editing never needs another write. Caret at the end on
 * start; Enter inserts a newline; Escape or a press outside the object (the
 * closest `container` ancestor) ends editing. Ctrl/Cmd+Z goes to `undo`.
 */
export function TextEditor(props: {
  ytext: Y.Text;
  maxChars: number;
  fontPx: number;
  width: number | 'auto';
  onInput(): void;
  onEnd(next: 'selected' | 'unselected'): void;
  undo: UndoController;
  /** Accessible name of the textarea. */
  label?: string;
  className?: string;
  style?: CSSProperties;
  /** Selector of the object element; presses inside it do not end editing. */
  container?: string;
  /** The edit continues the current undo step (a text object just created) instead of starting one. */
  joinStep?: boolean;
  /** Called with the text length after every change (sticky note counter). */
  onLength?(length: number): void;
}): React.JSX.Element {
  const { ytext, undo, maxChars } = props;
  const ref = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const latest = useRef(props);
  latest.current = props;
  /** Newest undo step before this edit began: undo inside the editor never goes past it. */
  const editStart = useRef<unknown>(null);
  /** Steps undone inside this edit that may be redone here. */
  const undoneHere = useRef(0);
  const joinStep = useRef(props.joinStep ?? false);

  // Editing is its own run of undo steps: typing never merges with the change
  // before it (e.g. creating a note) or after it.
  useLayoutEffect(() => {
    if (!joinStep.current) undo.boundary();
    joinStep.current = false;
    editStart.current = undo.checkpoint();
    undoneHere.current = 0;
    return () => undo.boundary();
  }, [undo, ytext]);

  // Edit start: current text, focused, caret at the end.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.value = ytext.toString();
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
  }, [ytext]);

  // Other people's typing lands in the textarea at once, so the next local diff
  // (textarea vs Y.Text) never overwrites it; the caret stays with its characters.
  useEffect(() => {
    const onChange = (event: Y.YTextEvent, tx: Y.Transaction) => {
      const el = ref.current;
      if (!el || tx.origin === LOCAL_ORIGIN) return;
      const next = ytext.toString();
      if (el.value === next) return;
      const focused = document.activeElement === el;
      const start = shiftIndex(el.selectionStart, event.delta);
      const end = shiftIndex(el.selectionEnd, event.delta);
      el.value = next;
      if (focused) el.setSelectionRange(start, end);
      latest.current.onLength?.(next.length);
    };
    ytext.observe(onChange);
    return () => ytext.unobserve(onChange);
  }, [ytext]);

  // Any pointerdown outside this object ends editing.
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const selector = latest.current.container;
      const owner = (selector ? ref.current?.closest(selector) : null) ?? ref.current;
      if (owner && e.target instanceof Node && owner.contains(e.target)) return;
      latest.current.onEnd('unselected');
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, []);

  const commit = () => {
    const el = ref.current;
    if (!el || composing.current || isDetached(ytext)) return;
    const prev = ytext.toString();
    const { text, caret } = clampEdit(prev, el.value, maxChars);
    if (text !== el.value) {
      el.value = text;
      if (caret !== null) el.setSelectionRange(caret, caret);
    }
    if (text === prev) return;
    undoneHere.current = 0;
    // The text and whatever onInput writes (a text object's box) are one update.
    const write = () => {
      applyTextDiff(ytext, text, LOCAL_ORIGIN);
      latest.current.onInput();
    };
    if (ytext.doc) ytext.doc.transact(write, LOCAL_ORIGIN);
    else write();
    latest.current.onLength?.(text.length);
  };

  /** Ctrl/Cmd+Z undoes typing in this object; the browser's own textarea undo would diverge from the Y.Text. */
  const onHistoryKey = (kind: 'undo' | 'redo') => {
    commit();
    if (kind === 'undo') {
      if (undo.canUndoSince(editStart.current) && undo.undo()) undoneHere.current++;
    } else if (undoneHere.current > 0 && undo.redo()) {
      undoneHere.current--;
    }
  };

  return (
    <textarea
      ref={ref}
      className={props.className}
      aria-label={props.label}
      spellCheck
      style={{ ...props.style, fontSize: `${props.fontPx}px`, width: props.width === 'auto' ? undefined : props.width }}
      onInput={commit}
      onCompositionStart={() => {
        composing.current = true;
      }}
      onCompositionEnd={() => {
        composing.current = false;
        commit();
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        const history = undoShortcut(e);
        if (history) {
          e.preventDefault();
          e.stopPropagation();
          if (!composing.current) onHistoryKey(history);
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          commit();
          props.onEnd('selected');
        }
      }}
    />
  );
}
