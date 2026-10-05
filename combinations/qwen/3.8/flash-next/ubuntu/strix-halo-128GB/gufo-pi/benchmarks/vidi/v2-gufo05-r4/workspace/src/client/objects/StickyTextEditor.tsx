/**
 * The textarea that types text into a note's shared `Y.Text`.
 *
 * It is uncontrolled: the browser owns the caret and the undo stack while the
 * user types, and every `input` event writes the change through to the document
 * immediately (clamped to the character limit). Ending editing therefore writes
 * nothing — the text is already in the document, which is what makes Escape and
 * clicking outside keep everything typed so far, even if the page dies next.
 *
 * Because an uncontrolled textarea holds its own copy of the text, somebody else
 * editing the same note has to be poured into it (see the observer below): a write
 * of the whole buffer is the smallest change the document can be given, so a buffer
 * that had gone stale would delete their typing.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent
} from 'react';
import type * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import {
  STICKY_LINE_HEIGHT,
  STICKY_TEXT_MAX_CHARS
} from '../../shared/config';
import { useUndoController } from '../board/useUndo';
import { applyTextDiff, clampToLimit, counterVisible, mapCaret, type TextOp } from './StickyText';

export interface StickyTextEditorProps {
  /** The shared text of the note being edited. */
  ytext: Y.Text;
  /** Auto-fitted font size, in world units (so it scales with the board zoom). */
  fontPx: number;
  /** Escape keeps the note selected; a click outside does not. */
  onEnd(next: 'selected' | 'unselected'): void;
}

export function StickyTextEditor(props: StickyTextEditorProps): JSX.Element {
  const { ytext, fontPx, onEnd } = props;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  // Whether this editor is still on screen: a note deleted while editing must
  // not be written to (and cannot be re-created by a late blur).
  const mountedRef = useRef(true);
  const [length, setLength] = useState(() => ytext.toString().length);

  // Keep the latest values reachable from handlers registered once.
  const ytextRef = useRef(ytext);
  ytextRef.current = ytext;
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;
  // The board's undo history, reached through context rather than a prop: the text editor
  // is mounted generically by the note, and every object type shares the same props.
  const undoController = useUndoController();
  const undoRef = useRef(undoController);
  undoRef.current = undoController;

  /** Keep the textarea exactly as tall as its text, so it sits centred like the
   *  text this note shows when it is not being edited. */
  const autoGrow = (element: HTMLTextAreaElement) => {
    element.style.height = 'auto';
    element.style.height = `${element.scrollHeight}px`;
  };

  /** Push the textarea's value into the document, clamped to the limit. */
  const sync = useCallback((raw: string) => {
    if (!mountedRef.current) return;
    const value = clampToLimit(raw);
    const element = textareaRef.current;
    if (element && value !== element.value) {
      // Characters past the limit never arrive; the caret goes to the end of the
      // text that did, so a too-long paste leaves the user where they expect.
      element.value = value;
      element.setSelectionRange(value.length, value.length);
    }
    if (element) autoGrow(element);
    setLength(value.length);
    applyTextDiff(ytextRef.current, value, LOCAL_ORIGIN);
  }, []);

  // Mount: take the note's text, focus it, and put the cursor at the end.
  //
  // The whole edit session is one undo step (`undo.typing`): a boundary on the way in
  // separates the typing from whatever happened before it (the note's creation, a drag),
  // and a boundary when the editor goes away — however it goes away, Escape, an outside
  // click or a blur — closes the step so the next action starts fresh. Within the session
  // the undo manager's own capture window collapses the keystrokes into that one step.
  useLayoutEffect(() => {
    mountedRef.current = true;
    undoRef.current?.boundary();
    const element = textareaRef.current;
    if (!element) return;
    const value = ytextRef.current.toString();
    element.value = value;
    setLength(value.length);
    autoGrow(element);
    element.focus();
    element.setSelectionRange(value.length, value.length);
    return () => {
      mountedRef.current = false;
      undoRef.current?.boundary();
    };
  }, []);

  // A pointerdown outside the note ends editing without losing any text. Capture
  // phase, because notes and toolbars stop propagation: this sees every press,
  // including one on another note, and only acts when it is not inside *this*
  // note (the caret in the textarea must stay where the user put it).
  useEffect(() => {
    const own = textareaRef.current?.closest('[data-vidi6="sticky"]') ?? null;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (own && target instanceof Node && own.contains(target)) return;
      onEndRef.current('unselected');
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => window.removeEventListener('pointerdown', onPointerDown, true);
  }, []);

  // Somebody else's typing, poured in as it arrives.
  //
  // The document is the authority, so the buffer is set to what it now holds and the
  // caret is carried across by the change itself rather than guessed at from the
  // text. Without this, the next keystroke would write a buffer that never learned
  // about the other edit, and their characters would leave the note.
  useEffect(() => {
    const observer = (event: { delta: TextOp[] }, transaction: { origin?: unknown }) => {
      if (transaction.origin === LOCAL_ORIGIN) return; // our own writing, already there
      const element = textareaRef.current;
      if (!element) return;
      const next = ytextRef.current.toString();
      // Mid-composition the buffer belongs to the input method; disturbing it would
      // break the word being built. The composition writes the whole buffer when it
      // ends, which is the one case where a remote character can be overtaken.
      if (!composingRef.current) {
        const anchor = Math.min(next.length, mapCaret(element.selectionStart ?? next.length, event.delta));
        const focus = Math.min(next.length, mapCaret(element.selectionEnd ?? next.length, event.delta));
        element.value = next;
        element.setSelectionRange(anchor, focus);
        autoGrow(element);
      }
      setLength(next.length);
    };
    const text = ytext;
    text.observe(observer);
    return () => text.unobserve(observer);
  }, [ytext]);

  // A blur that was not caused by an outside click (a window switch, a browser
  // shortcut) still gets to keep its text.
  const handleBlur = useCallback(() => {
    if (composingRef.current) return; // compositionend will do the write
    const element = textareaRef.current;
    if (element) sync(element.value);
  }, [sync]);

  const handleInput = useCallback(
    (event: { currentTarget: HTMLTextAreaElement }) => {
      // During IME composition the value is provisional; writing it to the shared
      // document mid-composition would duplicate characters.
      if (composingRef.current) return;
      sync(event.currentTarget.value);
    },
    [sync]
  );

  const handleCompositionEnd = useCallback(
    (event: { currentTarget: HTMLTextAreaElement }) => {
      composingRef.current = false;
      sync(event.currentTarget.value);
    },
    [sync]
  );

  const handleKeyDown = useCallback((event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    // Ctrl/Cmd+Z inside the editor still means the shared text, not the browser's private
    // textarea history: a native undo here would rewrite the buffer out from under the
    // document and the next keystroke would push that back as if the user had typed it.
    // So the board's own history runs it, and the change flows back through the observer
    // (whose origin is the undo manager, not our own write, so it is poured in).
    if ((event.ctrlKey || event.metaKey) && !event.altKey) {
      const key = event.key.toLowerCase();
      const undo = undoRef.current;
      if (undo && (key === 'z' || key === 'y')) {
        event.preventDefault();
        event.stopPropagation();
        if (key === 'y' || event.shiftKey) undo.redo();
        else undo.undo();
        return;
      }
    }
    if (event.key !== 'Escape') return; // Enter inserts a newline, as a note should
    event.preventDefault();
    event.stopPropagation();
    onEndRef.current('selected');
  }, []);

  return (
    <>
      <textarea
        ref={textareaRef}
        className="vidi6-sticky-input"
        data-testid="sticky-input"
        aria-label="Sticky note text"
        spellCheck={false}
        // Shown only while the note is empty; a placeholder is never stored.
        placeholder={length === 0 ? 'Type an idea' : undefined}
        style={{ fontSize: `${fontPx}px`, lineHeight: STICKY_LINE_HEIGHT }}
        onInput={handleInput}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={handleCompositionEnd}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
      />
      {counterVisible(length) ? (
        <div className="vidi6-sticky-counter" data-testid="sticky-counter" aria-live="polite">
          {length}
          /{STICKY_TEXT_MAX_CHARS}
        </div>
      ) : null}
    </>
  );
}
