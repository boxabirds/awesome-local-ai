import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import type * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import { historyCommand } from '../board/useBoardKeys';
import { useUndoController } from '../board/useUndo';
import { applyTextDiff, counterVisible, diffText, limitEdit, transformIndex, type TextDelta } from './StickyText';

/**
 * Textarea editing one note's Y.Text. Every input event is written straight to
 * the Y.Text with a minimal diff, so ending editing needs no extra write.
 * Ends on Escape ('selected') or a pointerdown outside the note ('unselected').
 * Other people's typing (story 3) is merged into the textarea as it arrives,
 * keeping the caret in place; during an IME composition it is held back and
 * merged when the composition ends.
 * Undo (story 8): editing starts and ends an undo step boundary, typing
 * groups into bursts by the capture timeout, and Ctrl/Cmd+Z / redo inside the
 * textarea act on typing steps in this text only (never the native textarea
 * undo, which would diverge from the Y.Text).
 */
export function StickyTextEditor(props: {
  ytext: Y.Text;
  fontPx: number;
  onEnd(next: 'selected' | 'unselected'): void;
  /** Top padding (board units) that vertically centres short text like the display mode. */
  padTop?: number;
}) {
  const { ytext } = props;
  const ref = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  const [length, setLength] = useState(() => ytext.length);
  /** The Y.Text value the textarea last matched (before the current local input). */
  const baseRef = useRef('');
  /** Remote changes received during a composition, oldest first. */
  const pendingRemoteRef = useRef<TextDelta[][]>([]);
  const onEndRef = useRef(props.onEnd);
  onEndRef.current = props.onEnd;
  const undo = useUndoController();
  const undoRef = useRef(undo);
  undoRef.current = undo;

  // Edit start and end are undo step boundaries.
  useEffect(() => {
    undoRef.current.boundary();
    return () => undoRef.current.boundary();
  }, [ytext]);

  // Edit start: current text, focused, caret at the end.
  useLayoutEffect(() => {
    const el = ref.current!;
    const value = ytext.toString();
    el.value = value;
    baseRef.current = value;
    pendingRemoteRef.current = [];
    el.focus({ preventScroll: true });
    el.setSelectionRange(value.length, value.length);
    setLength(value.length);
  }, [ytext]);

  // Remote edits: update the textarea and move the selection with the text.
  useEffect(() => {
    const onChange = (event: Y.YTextEvent, tr: Y.Transaction) => {
      if (tr.origin === LOCAL_ORIGIN) return;
      const el = ref.current;
      if (!el) return;
      const delta = event.delta as TextDelta[];
      if (composingRef.current) {
        pendingRemoteRef.current.push(delta);
        return;
      }
      const { selectionStart, selectionEnd, selectionDirection } = el;
      el.value = ytext.toString();
      el.setSelectionRange(
        transformIndex(selectionStart, delta),
        transformIndex(selectionEnd, delta),
        selectionDirection ?? undefined,
      );
      baseRef.current = el.value;
      setLength(el.value.length);
    };
    ytext.observe(onChange);
    return () => ytext.unobserve(onChange);
  }, [ytext]);

  // A pointerdown anywhere outside this note ends editing.
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const el = ref.current;
      if (!el) return;
      const note = el.closest('[data-note-id]') ?? el;
      if (e.target instanceof Node && note.contains(e.target)) return;
      flush();
      onEndRef.current('unselected');
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, []);

  /** Writes the textarea value to the Y.Text, enforcing the length limit. */
  function flush() {
    const el = ref.current;
    if (!el || composingRef.current) return;
    // The note may have been deleted meanwhile; never write to a detached text.
    if (ytext.doc === null || ytext._item?.deleted) return;
    const pending = pendingRemoteRef.current;
    if (pending.length > 0) {
      // Rebase the composed local edit onto the remote changes it missed.
      pendingRemoteRef.current = [];
      const local = diffText(baseRef.current, el.value);
      let start = local.start;
      let end = local.start + local.deleteCount;
      for (const delta of pending) {
        start = transformIndex(start, delta);
        end = transformIndex(end, delta);
      }
      const current = ytext.toString();
      el.value = current.slice(0, start) + local.insert + current.slice(Math.max(start, end));
      const caret = start + local.insert.length;
      el.setSelectionRange(caret, caret);
    }
    const limited = limitEdit(ytext.toString(), el.value);
    if (limited) {
      el.value = limited.text;
      el.setSelectionRange(limited.caret, limited.caret);
    }
    applyTextDiff(ytext, el.value, LOCAL_ORIGIN);
    baseRef.current = el.value;
    setLength(el.value.length);
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const history = historyCommand(e);
    if (history && !composingRef.current && !e.nativeEvent.isComposing) {
      e.preventDefault();
      e.stopPropagation();
      flush();
      undo.boundary();
      if (undo.nextStepOnlyIn(ytext, history)) {
        if (history === 'undo') undo.undo();
        else undo.redo();
      }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      flush();
      props.onEnd('selected');
    }
  };

  return (
    <>
      <textarea
        ref={ref}
        className="sticky-editor"
        aria-label="Note text"
        spellCheck
        style={{ fontSize: `${props.fontPx}px`, paddingTop: props.padTop }}
        onInput={flush}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={() => {
          composingRef.current = false;
          flush();
        }}
        onBlur={flush}
        onKeyDown={onKeyDown}
        onPointerDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
      />
      {counterVisible(length) && (
        <div className="sticky-counter" aria-live="polite">
          {`${length}/${STICKY_TEXT_MAX_CHARS}`}
        </div>
      )}
    </>
  );
}
