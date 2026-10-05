/**
 * The board's text editor: one shared `Y.Text`, typed into.
 *
 * Sticky notes and free text type into the same thing and need the same care, so there is
 * one editor and it is here. What it owes the document and the person next to you:
 *
 *   - the shared text is the authority. A keystroke is turned into the smallest diff
 *     against what the document holds (`applyTextDiff`), never a wholesale rewrite, so a
 *     change is something a peer can apply without clobbering anyone;
 *   - what somebody else types arrives while you are typing and carries your caret along
 *     with it (`text.collab`, `note.collab_typing`);
 *   - a press outside the object being typed in ends the edit and keeps the text, Escape
 *     ends it and leaves the object selected, and a blur that was neither still writes
 *     what was typed;
 *   - Enter is a newline — an editor on a whiteboard is not a search box;
 *   - characters past the length limit never arrive, and the counter says what is left
 *     before anyone has to discover the limit by losing something;
 *   - IME composition is provisional: the buffer belongs to the input method until it
 *     finishes, and only then is it written (`note.ime`);
 *   - the whole session is one undo step, bounded on the way in and on the way out
 *     (`undo.typing`, and the same promise for free text in `text.edit`).
 *
 * The differences between a note's text and free text are passed in, not branched on:
 * the font size, the wrap width, the length limit and its counter, and the re-measure a
 * free text box needs after every local change (`text.auto_width`).
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type JSX, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { applyTextDiff, mapCaret, type TextOp } from '../../shared/text-edit';
import { useUndoController } from '../board/useUndo';

export interface TextEditorProps {
  /** The shared text being edited. */
  ytext: Y.Text;
  /** The font size, in board units, so it scales with the board's zoom. */
  fontPx: number;
  readonly lineHeight: number;
  /** The longest this text may be (`note.limit_length`, `text.limit_length`). */
  maxChars: number;
  /** The editor's own class: notes and free text look different, and type the same. */
  className: string;
  testId: string;
  ariaLabel: string;
  /** Shown only while the text is empty, and never stored (`note.edit`). */
  emptyPlaceholder?: string;
  /**
   * Show the counter once the text is within this many characters of the limit — the rule
   * story 2 settled on: it appears when the user has to start counting, not before
   * (`note.limit_length`). Omit to never show it.
   */
  counterThreshold?: number;
  /** Class and test id of the counter, which each object names after itself. */
  counterClass?: string;
  counterTestId?: string;
  /**
   * Selector for the element that owns this editor. A press anywhere else ends the edit —
   * `[data-vidi6="sticky"]` for a note, `[data-vidi6="text"]` for free text.
   */
  outsideSelector: string;
  /** Keep the box exactly as tall as its content, so no scrollbars appear mid-typing. */
  autoGrow?: boolean;
  /** The wrap width in board units, for a text whose box has one. */
  widthPx?: number;
  /** Escape keeps the object selected; a click outside does not. */
  onEnd(next: 'selected' | 'unselected'): void;
  /**
   * Called after every local change has reached the document. Free text re-measures its
   * stored box here, in the same capture window as the keystroke, so one undo reverts the
   * words and the box together (`text.auto_width`).
   */
  onLocalChange?(): void;
}

/** Cut to the limit at a character boundary, so a cut in the middle of an emoji cannot
 *  leave half of one behind. */
function clampChars(value: string, maxChars: number): string {
  const allowed = Math.max(0, Math.trunc(maxChars) || 0);
  if (value.length <= allowed) return value;
  const cut = Array.from(value).slice(0, allowed).join('');
  return cut.length > 0 ? cut : value.slice(0, allowed);
}

export function TextEditor(props: TextEditorProps): JSX.Element {
  const { ytext, fontPx, lineHeight, maxChars, className, testId, ariaLabel } = props;
  const autoGrow = props.autoGrow !== false;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  // Whether this editor is still on screen: an object deleted while editing must not be
  // written to, and cannot be re-created by a late blur.
  const mountedRef = useRef(true);
  const [length, setLength] = useState(() => ytext.toString().length);

  // Keep the latest values reachable from handlers registered once.
  const ytextRef = useRef(ytext);
  ytextRef.current = ytext;
  const onEndRef = useRef(props.onEnd);
  onEndRef.current = props.onEnd;
  const onLocalChangeRef = useRef(props.onLocalChange);
  onLocalChangeRef.current = props.onLocalChange;
  const maxCharsRef = useRef(maxChars);
  maxCharsRef.current = maxChars;
  // The board's undo history, reached through context rather than a prop: the editor is
  // mounted by whichever object is being typed into, and every object type shares the
  // same props.
  const undoController = useUndoController();
  const undoRef = useRef(undoController);
  undoRef.current = undoController;

  /** Keep the textarea exactly as tall as its text, so it never scrolls while typing. */
  const grow = (element: HTMLTextAreaElement) => {
    if (!autoGrow) return;
    element.style.height = 'auto';
    element.style.height = `${element.scrollHeight}px`;
  };

  /** Push the textarea's value into the document, clamped to the limit. */
  const sync = useCallback((raw: string) => {
    if (!mountedRef.current) return;
    const value = clampChars(raw, maxCharsRef.current);
    const element = textareaRef.current;
    if (element && value !== element.value) {
      // Characters past the limit never arrive; the caret goes to the end of the text
      // that did, so a too-long paste leaves the user where they expect.
      element.value = value;
      element.setSelectionRange(value.length, value.length);
    }
    if (element) grow(element);
    setLength(value.length);
    applyTextDiff(ytextRef.current, value, LOCAL_ORIGIN);
    onLocalChangeRef.current?.();
  }, []);

  // Mount: take the object's text, focus it, and put the cursor at the end.
  //
  // The whole edit session is one undo step: a boundary on the way in separates the typing
  // from whatever happened before it (the object's creation, a drag), and a boundary when
  // the editor goes away — however it goes away, Escape, an outside click or a blur —
  // closes the step so the next action starts fresh.
  useLayoutEffect(() => {
    mountedRef.current = true;
    undoRef.current?.boundary();
    const element = textareaRef.current;
    if (!element) return;
    const value = ytextRef.current.toString();
    element.value = value;
    setLength(value.length);
    grow(element);
    element.focus();
    element.setSelectionRange(value.length, value.length);
    return () => {
      mountedRef.current = false;
      undoRef.current?.boundary();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A pointerdown outside the object being edited ends editing without losing any text.
  // Capture phase, because objects and toolbars stop propagation: this sees every press,
  // including one on another object, and only acts when it is not inside *this* one (the
  // caret in the textarea must stay where the user put it).
  useEffect(() => {
    const own = textareaRef.current?.closest(props.outsideSelector) ?? null;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (own && target instanceof Node && own.contains(target)) return;
      onEndRef.current('unselected');
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => window.removeEventListener('pointerdown', onPointerDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Somebody else's typing, poured in as it arrives.
  //
  // The document is the authority, so the buffer is set to what it now holds and the caret
  // is carried across by the change itself rather than guessed at from the text. Without
  // this, the next keystroke would write a buffer that never learned about the other edit,
  // and their characters would leave the object.
  useEffect(() => {
    const observer = (event: { delta: TextOp[] }, transaction: { origin?: unknown }) => {
      if (transaction.origin === LOCAL_ORIGIN) return; // our own writing, already there
      const element = textareaRef.current;
      if (!element) return;
      const next = ytextRef.current.toString();
      // Mid-composition the buffer belongs to the input method; disturbing it would break
      // the word being built. The composition writes the whole buffer when it ends, which
      // is the one case where a remote character can be overtaken.
      if (!composingRef.current) {
        const anchor = Math.min(next.length, mapCaret(element.selectionStart ?? next.length, event.delta));
        const focus = Math.min(next.length, mapCaret(element.selectionEnd ?? next.length, event.delta));
        element.value = next;
        element.setSelectionRange(anchor, focus);
        grow(element);
      }
      setLength(next.length);
    };
    const text = ytext;
    text.observe(observer);
    return () => text.unobserve(observer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ytext]);

  // A blur that was not caused by an outside click (a window switch, a browser shortcut)
  // still gets to keep its text.
  const handleBlur = useCallback(() => {
    if (composingRef.current) return; // compositionend will do the write
    const element = textareaRef.current;
    if (element) sync(element.value);
  }, [sync]);

  const handleInput = useCallback(
    (event: { currentTarget: HTMLTextAreaElement }) => {
      // During IME composition the value is provisional; writing it to the shared document
      // mid-composition would duplicate characters.
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
    if (event.key !== 'Escape') return; // Enter inserts a newline, as text on a board should
    event.preventDefault();
    event.stopPropagation();
    onEndRef.current('selected');
  }, []);

  const style = {
    fontSize: `${fontPx}px`,
    lineHeight,
    ...(props.widthPx === undefined ? {} : { width: `${props.widthPx}px` })
  };

  return (
    <>
      <textarea
        ref={textareaRef}
        className={className}
        data-testid={testId}
        aria-label={ariaLabel}
        spellCheck={false}
        // One row, so that `height: auto` means *one line* and the auto-grow measurement
        // below starts from the text rather than from the two rows a textarea asks for by
        // default. A sticky note hides this behind its fixed square; free text paints its
        // box from the same number, and a two-row minimum would make every one-line text
        // look twice as tall as the board says it is.
        rows={1}
        // Shown only while the text is empty; a placeholder is never stored.
        placeholder={length === 0 ? props.emptyPlaceholder : undefined}
        style={style}
        onInput={handleInput}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={handleCompositionEnd}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
      />
      {props.counterThreshold !== undefined && maxChars - length <= props.counterThreshold ? (
        <div
          className={props.counterClass ?? `${className}-counter`}
          data-testid={props.counterTestId ?? `${testId}-counter`}
          aria-live="polite"
        >
          {length}
          /{maxChars}
        </div>
      ) : null}
    </>
  );
}
