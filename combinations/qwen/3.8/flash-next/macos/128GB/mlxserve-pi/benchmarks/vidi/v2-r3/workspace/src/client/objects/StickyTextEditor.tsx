import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CompositionEvent,
  type FormEvent,
  type JSX,
  type KeyboardEvent,
} from 'react';
import type * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import { applyTextDelta, clampToLimit, counterVisible } from './StickyText';
import type { EndEditNext } from '../board/useSelection';
import type { UndoController } from '../board/undo';

export interface StickyTextEditorProps {
  /** The note's shared text; every input event is written to it directly. */
  ytext: Y.Text;
  /** Font size (board units) measured by the note, so typing keeps its size. */
  fontPx: number;
  /** Escape -> 'selected'; a pointerdown outside the note -> 'unselected'. */
  onEnd(next: EndEditNext): void;
  /**
   * This person's own undo history. The editor opens and closes a step in it —
   * one edit session is one step, wherever it happens to fall — and takes
   * Ctrl/Cmd+Z for itself, so the undo it performs is the board's and not the
   * browser's. Absent only when the editor is rendered without a board.
   */
  undo?: UndoController;
}

/** Is `node` inside the same sticky note as `inside`? */
function sameNote(inside: HTMLElement, node: EventTarget | null): boolean {
  const note = inside.closest<HTMLElement>('[data-note-id]');
  if (note === null || node === null || !(node instanceof Element)) return false;
  return note.contains(node);
}

/**
 * The note's textarea. Every `input` event is applied to the Y.Text
 * immediately (minimal diff, clamped to 1,000 characters), so finishing
 * editing performs no extra write and nothing typed is ever lost.
 *
 * Story 3 adds the two halves of two people typing into one note:
 *
 * - What goes out is the difference between the textarea and **the text this
 *   document last agreed with the room** (`baseRef`), not the difference
 *   against the shared text as it currently looks. A stale textarea therefore
 *   reports the characters somebody else typed as nothing at all rather than as
 *   a deletion, which is how one of the two people stops losing their text.
 * - What comes in is applied to the textarea inside the document event, before
 *   a keystroke can be queued behind a render of the old value, with the caret
 *   held the same distance from the end of the text. A change that arrives
 *   mid-composition waits for the composition to end, because writing into a
 *   textarea in the middle of an IME session breaks the session.
 */
export function StickyTextEditor(props: StickyTextEditorProps): JSX.Element {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const propsRef = useRef(props);
  const composingRef = useRef(false);
  const endedRef = useRef(false);
  const [length, setLength] = useState(() => props.ytext.toString().length);
  // The text this document last agreed with the room: the base every local edit
  // is measured against. Only an update from elsewhere moves it, plus the
  // refresh after a local write, which by then matches the document.
  const baseRef = useRef<string>(props.ytext.toString());
  // A change that arrived while a composition was open, applied when it closes.
  const waitingRef = useRef(false);

  useEffect(() => {
    propsRef.current = props;
  });

  /** Write the textarea's current value into the document (clamped). */
  const flush = useCallback(() => {
    const el = textareaRef.current;
    if (el === null || composingRef.current) return;
    const clamped = clampToLimit(el.value);
    if (clamped !== el.value) {
      // The characters past the limit are dropped, and the caret goes back to
      // the end of the text that was kept.
      el.value = clamped;
      try {
        el.setSelectionRange(clamped.length, clamped.length);
      } catch {
        /* element not focusable in this environment */
      }
    }
    applyTextDelta(propsRef.current.ytext, baseRef.current, clamped, LOCAL_ORIGIN);
    // What the document holds now is what the next keystroke is a change to.
    baseRef.current = propsRef.current.ytext.toString();
    setLength(clamped.length);
  }, []);

  /**
   * Show a text that came from elsewhere, keeping the caret the same distance
   * from the end of it — where it sits while a person types, and where their
   * next keystroke belongs.
   */
  const showRemote = useCallback((next: string) => {
    const el = textareaRef.current;
    baseRef.current = next;
    setLength(next.length);
    if (el === null) return;
    const fromEnd = el.value.length - el.selectionStart;
    el.value = next;
    const caret = Math.max(0, next.length - fromEnd);
    try {
      el.setSelectionRange(caret, caret);
    } catch {
      /* element not focusable in this environment */
    }
  }, []);

  // Somebody else's change, arriving while this note is being edited.
  useEffect(() => {
    const ytext = propsRef.current.ytext;
    const observer = (event: Y.YTextEvent, transaction: Y.Transaction) => {
      // A write this browser made is already in the textarea; applying it again
      // would move a caret that has since moved on.
      if (transaction.origin === LOCAL_ORIGIN) return;
      const next = clampToLimit(ytext.toString());
      if (composingRef.current) {
        // Not in the middle of an IME session: remembered, and applied the
        // moment the composition closes.
        waitingRef.current = true;
        return;
      }
      showRemote(next);
    };
    ytext.observe(observer);
    return () => {
      ytext.unobserve(observer);
    };
  }, []);

  // Edit start: value from the document, focus, caret at the end of the text.
  useEffect(() => {
    // Where this edit begins, in my own history: whatever I did before it stays
    // a step of its own, and the typing that follows is this one.
    propsRef.current.undo?.boundary();
    const el = textareaRef.current;
    if (el === null) return;
    const initial = clampToLimit(propsRef.current.ytext.toString());
    baseRef.current = initial;
    el.value = initial;
    setLength(initial.length);
    el.focus();
    try {
      el.setSelectionRange(initial.length, initial.length);
    } catch {
      /* jsdom: selection ranges are supported, but never fail the edit */
    }
  }, []);

  const end = useCallback((next: EndEditNext) => {
    if (endedRef.current) return;
    endedRef.current = true;
    // And where it ends. What is typed after this is another step, even if no
    // time has passed at all.
    propsRef.current.undo?.boundary();
    propsRef.current.onEnd(next);
  }, []);

  // A pointerdown anywhere outside the note finishes editing (sticky.edit_end).
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const el = textareaRef.current;
      if (el === null || sameNote(el, e.target)) return;
      end('unselected');
    };
    // Capture phase: the note and the toolbars stop propagation, but this
    // still sees every pointerdown made outside them.
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => window.removeEventListener('pointerdown', onPointerDown, true);
  }, [end]);

  const onInput = (_e: FormEvent<HTMLTextAreaElement>) => {
    flush();
  };

  const onCompositionStart = (_e: CompositionEvent<HTMLTextAreaElement>) => {
    composingRef.current = true;
  };

  const onCompositionEnd = (_e: CompositionEvent<HTMLTextAreaElement>) => {
    composingRef.current = false;
    flush(); // IME text lands here, never twice
    if (waitingRef.current) {
      // The change that arrived during the composition goes up against the
      // document, which is the text the next keystroke is a change to.
      waitingRef.current = false;
      showRemote(clampToLimit(propsRef.current.ytext.toString()));
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // While an IME composition is open the textarea owns every key: Escape
    // cancels the composition, it does not finish editing.
    if (e.nativeEvent.isComposing || composingRef.current) return;

    // Ctrl/Cmd+Z inside the note is the board's undo, not the textarea's: the
    // browser's own undo of a textarea changes its value without ever reaching
    // the shared text, and would then be flushed up as a change of mine. Redo is
    // taken for the same reason. The event does not carry on to the board,
    // which would undo a second thing underneath the typing.
    const undo = propsRef.current.undo;
    if (undo !== undefined && (e.ctrlKey || e.metaKey) && !e.altKey) {
      const key = e.key.toLowerCase();
      if (key === 'z' || key === 'y') {
        e.preventDefault();
        e.stopPropagation();
        if (key === 'z' && e.shiftKey) undo.redo();
        else if (key === 'z') undo.undo();
        else undo.redo();
        return;
      }
    }

    if (e.key === 'Escape') {
      // Escape finishes editing and keeps the note selected. Enter is left to
      // the textarea so it inserts a new line; Delete/Backspace edit text.
      e.preventDefault();
      e.stopPropagation();
      end('selected');
    }
  };

  return (
    <div className="sticky-editor" data-testid="sticky-editor">
      <textarea
        ref={textareaRef}
        className="sticky-textarea"
        data-testid="sticky-textarea"
        aria-label="Sticky note text"
        defaultValue=""
        style={{ fontSize: `${props.fontPx}px` }}
        onInput={onInput}
        onCompositionStart={onCompositionStart}
        onCompositionEnd={onCompositionEnd}
        onBlur={flush}
        onKeyDown={onKeyDown}
        spellCheck={false}
      />
      {counterVisible(length) ? (
        <span className="sticky-counter" data-testid="sticky-counter" aria-live="polite">
          {length}/{STICKY_TEXT_MAX_CHARS}
        </span>
      ) : null}
    </div>
  );
}
