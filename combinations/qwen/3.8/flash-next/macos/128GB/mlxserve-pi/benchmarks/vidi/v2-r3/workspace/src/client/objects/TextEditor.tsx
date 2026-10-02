// The free text object's editor: a transparent textarea laid over the object,
// with the same font size, line height, line breaking, padding and alignment as
// the text underneath it, so the text never jumps when it becomes editable
// (design section 5.3).
//
// It is a textarea and not a contenteditable, for the same two reasons the sticky
// note has: its value and selection range can be read and written directly, and
// it takes no HTML.
//
// Every input event is written into the shared text as it happens, so finishing
// editing performs no extra write and nothing typed is ever lost. What goes out
// is the difference against *the text this document last agreed with the room*,
// so a stale textarea reports another person's characters as nothing at all
// rather than as a deletion.
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
import { TEXT_MAX_CHARS } from '../../shared/config';
import { applyTextDelta, clampToLimit } from '../../shared/text-edit';
import type { EndEditNext } from '../board/useSelection';
import type { UndoController } from '../board/undo';

export interface TextEditorProps {
  /** The object's shared text; every input event is written to it directly. */
  ytext: Y.Text;
  /** The object's id, for aria and for keeping the editor with its object. */
  id: string;
  /** Font size (board units) of the object, so typing keeps its size. */
  fontPx: number;
  /**
   * Measure the text as it now is and store the box, if it is not the box it
   * already has. Called after every write this editor makes — a keystroke is a
   * possible change of wrapping, and of height — and never in response to a
   * change that came from somebody else.
   */
  remeasure(): void;
  /** Escape -> 'selected'; a pointerdown outside the object -> 'unselected'. */
  onEnd(next: EndEditNext): void;
  /**
   * This person's own undo history. The editor opens and closes a step in it —
   * one edit session is one step, wherever it happens to fall — and takes
   * Ctrl/Cmd+Z for itself, so the undo it performs is the board's and not the
   * browser's.
   */
  undo?: UndoController;
  /**
   * How many characters this kind of object may hold. A sticky note and a free
   * text have one limit and a shape's label has another, and both are the
   * setting of the object being edited rather than of this editor; it defaults
   * to the free text's, so story 9's callers are unchanged.
   */
  maxChars?: number;
  /**
   * Selector for the element this editor is laid over, which is what an outside
   * click is measured against. Defaults to a free text object's.
   */
  objectSelector?: string;
  /** The editor's `data-testid`, so a test can tell two kinds of editor apart. */
  testId?: string;
}

/** Is `node` inside the same object as `inside`? */
function sameObject(inside: HTMLElement, node: EventTarget | null, selector: string): boolean {
  const object = inside.closest<HTMLElement>(selector);
  if (object === null || node === null || !(node instanceof Element)) return false;
  return object.contains(node);
}

export function TextEditor(props: TextEditorProps): JSX.Element {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const propsRef = useRef(props);
  const composingRef = useRef(false);
  const endedRef = useRef(false);
  /** The limit of the object being edited, which is not this editor's business. */
  const limit = useCallback(() => propsRef.current.maxChars ?? TEXT_MAX_CHARS, []);
  /** The element the editor is laid over, for the outside click. */
  const selector = useCallback(() => propsRef.current.objectSelector ?? '[data-text-id]', []);
  // The text this document last agreed with the room: the base every local edit
  // is measured against. Only an update from elsewhere moves it, plus the refresh
  // after a local write, which by then matches the document.
  const baseRef = useRef<string>(props.ytext.toString());
  // A change that arrived while a composition was open, applied when it closes.
  const waitingRef = useRef(false);
  // How much of the limit the text has used, purely to paint the box differently.
  const [length, setLength] = useState(() => props.ytext.toString().length);

  useEffect(() => {
    propsRef.current = props;
  });

  /** Write the textarea's current value into the document (clamped to the limit). */
  const flush = useCallback(() => {
    const el = textareaRef.current;
    if (el === null || composingRef.current) return;
    const clamped = clampToLimit(el.value, limit());
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
    const current = propsRef.current;
    applyTextDelta(current.ytext, baseRef.current, clamped, LOCAL_ORIGIN);
    // What the document holds now is what the next keystroke is a change to.
    baseRef.current = current.ytext.toString();
    setLength(clamped.length);
    // The box grows from the text this write just made, in the same transaction
    // window as the typing, so one Undo returns the text and its box together.
    current.remeasure();
  }, [limit]);

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

  // Somebody else's change, arriving while this object is being edited.
  useEffect(() => {
    const ytext = propsRef.current.ytext;
    const observer = (event: Y.YTextEvent, transaction: Y.Transaction) => {
      // A write this browser made is already in the textarea; applying it again
      // would move a caret that has since moved on.
      if (transaction.origin === LOCAL_ORIGIN) return;
      const next = clampToLimit(ytext.toString(), limit());
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
  }, [limit]);

  // Edit start: the box measured from the text that is already there, the value
  // taken from the document, focus, and the caret at the end of the text.
  useEffect(() => {
    // Where this edit begins, in my own history: whatever I did before it stays
    // a step of its own, and the typing that follows is this one.
    propsRef.current.undo?.boundary();
    // Opening an object is not a change to it, so it measures nothing: the box it
    // finds in the document is the box the client that changed the text measured,
    // and a board whose five people each corrected it on opening it would have
    // five boxes in it, one per font, and no way to settle on one.
    const current = propsRef.current;
    const el = textareaRef.current;
    if (el === null) return;
    const initial = clampToLimit(current.ytext.toString(), limit());
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

  // A pointerdown anywhere outside the object finishes editing.
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const el = textareaRef.current;
      if (el === null || sameObject(el, e.target, selector())) return;
      end('unselected');
    };
    // Capture phase: the object and its toolbar stop propagation, but this
    // still sees every pointerdown made outside them.
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => window.removeEventListener('pointerdown', onPointerDown, true);
  }, [end, selector]);

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
      showRemote(clampToLimit(propsRef.current.ytext.toString(), limit()));
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // While an IME composition is open the textarea owns every key: Escape
    // cancels the composition, it does not finish editing.
    if (e.nativeEvent.isComposing || composingRef.current) return;

    // Ctrl/Cmd+Z inside the object is the board's undo, not the textarea's: the
    // browser's own undo of a textarea changes its value without ever reaching
    // the shared text, and would then be flushed up as a change of mine. Redo is
    // taken for the same reason. The event does not carry on to the board, which
    // would undo a second thing underneath the typing.
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
      // Escape finishes editing and keeps the object selected. Enter is left to
      // the textarea so it inserts a new line; Delete and Backspace edit text;
      // 'v', 't' and 'n' are typing, and the tool keys never see them because
      // they ignore a key whose target is something being typed into.
      e.preventDefault();
      e.stopPropagation();
      end('selected');
    }
  };

  return (
    <textarea
      ref={textareaRef}
      className={`text-editor${length > limit() * 0.9 ? ' is-near-limit' : ''}`}
      data-testid={props.testId ?? 'text-editor'}
      data-text-length={length}
      aria-label="Text"
      defaultValue=""
      style={{ fontSize: `${props.fontPx}px` }}
      onInput={onInput}
      onCompositionStart={onCompositionStart}
      onCompositionEnd={onCompositionEnd}
      onBlur={flush}
      onKeyDown={onKeyDown}
      spellCheck={false}
    />
  );
}
