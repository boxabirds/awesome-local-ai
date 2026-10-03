/**
 * The editing surface shared by the board's text fields.
 *
 * A sticky note edits in a `textarea`; free text edits in a `contenteditable` div, because a
 * textarea is a fixed box of its own making and cannot show text that grows past the box the
 * board measured for it. Everything *about* editing them is the same, though, and this file is
 * that part — the two fields must not grow two sets of rules about when a keystroke reaches
 * the document, and story 9's design says so: the caret and IME logic lives here, the
 * element stays with the type.
 *
 * What `useSharedTextEdit` owns:
 *
 * - **The value is in the DOM, not in React state**, so an IME composition is never
 *   interrupted by a re-render. Changes are applied on `input`, and again on
 *   `compositionend`, where composed text is finally complete.
 * - **Every accepted change is clamped** to `maxChars` (`sticky.text_limit`,
 *   `text.edit_limit`), with the caret put back at the end of what was kept.
 * - **Each change is one small transaction** on the object's `Y.Text` (`applyTextDiff`),
 *   which is why leaving a field writes nothing, and why two people can type in one object.
 * - **Text that arrives from elsewhere is written into the field** with the caret moved
 *   along, never dropped at the start (`shiftCaret`). While a composition is running the
 *   field is left alone; the incoming text lands on the next commit.
 * - **Undo and redo are the board's** (`undo.typing`): the browser's own history knows
 *   nothing about the shared document, so answering Ctrl+Z here would show this person a
 *   text nobody else has.
 * - **Opening and leaving are step boundaries** (`undo.steps`), so typing never merges
 *   into the gesture before it.
 * - **A press outside the object ends editing**, and writes nothing more.
 *
 * What stays with the object: which element to render, its classes and test ids, and what
 * to re-measure when the text changes — a note re-fits its font, free text rewrites its box.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from 'react';
import type * as Y from 'yjs';

import { LOCAL_ORIGIN } from '../../shared/board-model';
import { TEXT_LINE_HEIGHT, TEXT_MAX_CHARS } from '../../shared/config';
import { applyTextDiff, shiftCaret } from './StickyText';
import { undoGesture, type UndoController } from '../board/undo';

/** How a field is read, written and caret-placed, whatever element it is. */
export interface FieldDom<T extends HTMLElement> {
  /** What the person has in the field right now. */
  read(element: T): string;
  /**
   * Put text in the field.
   *
   * Called on mount, when text arrives from somewhere else, and when a clamp removed
   * characters — never after a local keystroke, which would move a caret that was
   * already where the person left it.
   */
  write(element: T, value: string): void;
  /** Where the caret is, or null when this field has no caret to give. */
  caret(element: T): number | null;
  /** Place the caret, where the engine allows it. */
  setCaret(element: T, offset: number): void;
}

/** A `textarea`: the value is the text, and the engine knows where the caret is. */
export const textareaField: FieldDom<HTMLTextAreaElement> = {
  read: (element) => element.value,
  write: (element, value) => {
    element.value = value;
  },
  caret: (element) => element.selectionStart,
  setCaret: (element, offset) => {
    try {
      element.setSelectionRange(offset, offset);
    } catch {
      // Engines without selection support keep the caret where it is.
    }
  },
};

/**
 * A `contenteditable` div.
 *
 * The DOM inside it is kept as plain text nodes, so `textContent` is the text and there are
 * no tags to read back: Enter inserts a newline text node rather than leaving the browser to
 * choose between a `div`, a `br` and a stray empty line. Writing the whole value replaces the
 * markup a paste may have brought in, which is the point — this is a board, not a word
 * processor, and what two people share is the string.
 */
export const editableField: FieldDom<HTMLElement> = {
  read: (element) => element.textContent ?? '',
  write: (element, value) => {
    element.textContent = value;
  },
  caret: (element) => {
    const selection = element.ownerDocument?.defaultView?.getSelection?.();
    if (!selection || selection.rangeCount === 0) return null;
    const anchor = selection.anchorNode;
    if (!anchor || !element.contains(anchor)) return null;
    if (anchor === element) return selection.anchorOffset;
    let offset = 0;
    const walker = element.ownerDocument?.createTreeWalker(element, 4 /* NodeFilter.SHOW_TEXT */);
    for (let node = walker?.firstChild(); node; node = walker?.nextNode()) {
      if (node === anchor) return offset + selection.anchorOffset;
      offset += node.textContent?.length ?? 0;
    }
    return offset;
  },
  setCaret: (element, offset) => {
    const view = element.ownerDocument?.defaultView;
    const selection = view?.getSelection?.();
    if (!element.ownerDocument || !selection) return;
    try {
      const range = element.ownerDocument.createRange();
      const target = caretPosition(element, offset);
      range.setStart(target.node, target.offset);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
    } catch {
      // Some engines refuse a range inside an element that has just been rewritten.
      // The text is right, which is what matters; the caret lands at the start.
    }
  },
};

/** The node and offset that hold the `offset`th character of a text-only subtree. */
function caretPosition(element: HTMLElement, offset: number): { node: Node; offset: number } {
  let remaining = Math.max(0, offset);
  const walker = element.ownerDocument?.createTreeWalker(element, 4 /* NodeFilter.SHOW_TEXT */);
  for (let node = walker?.firstChild(); node; node = walker?.nextNode()) {
    const length = node.textContent?.length ?? 0;
    if (remaining <= length) return { node, offset: remaining };
    remaining -= length;
  }
  // Past the end: the caret belongs after whatever is there.
  return { node: element, offset: element.childNodes.length };
}

/** Insert a newline at the caret of a contenteditable field, as a text node. */
function insertNewline(element: HTMLElement): void {
  const doc = element.ownerDocument;
  const selection = doc?.defaultView?.getSelection?.();
  const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
  if (!doc || !selection || !range || !element.contains(range.startContainer)) {
    // No usable caret inside the field — which happens the moment a field is opened in an
    // engine that will not place one. The newline goes at the end, because the end is
    // where a field that has just been opened is typing anyway.
    editableField.write(element, `${editableField.read(element)}\n`);
    return;
  }
  range.deleteContents();
  const node = element.ownerDocument.createTextNode('\n');
  range.insertNode(node);
  range.setStartAfter(node);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

/** Why the text changed, so the object knows whether it may re-measure. */
export type TextChangeKind = 'local' | 'remote' | 'mount';

export interface SharedTextEditOptions<T extends HTMLElement> {
  ytext: Y.Text;
  /** Characters this field keeps. Anything past it never existed. */
  maxChars: number;
  field: FieldDom<T>;
  /**
   * Selector for the element that owns the field.
   *
   * A press inside it keeps editing; anywhere else ends it. A note passes its own
   * element, so clicking the colour bar above it does not close the field.
   */
  hostSelector: string;
  /** Leave editing. The selection is left alone. */
  onEnd(): void;
  /**
   * Does this field make its own newlines?
   *
   * A textarea does, and Enter is left to it. A contenteditable div does not do it
   * usefully — the browser chooses between a `div`, a `br` and a stray empty line — so
   * the field inserts a newline text node instead (`text.edit`).
   */
  ownNewlines?: boolean;
  /** This person's history: boundaries around the edit, and Ctrl+Z inside it. */
  undo?: UndoController;
  /**
   * The text changed. `local` means this person typed it, which is the only kind that
   * may be written back to the document — a field that re-measured on somebody else's
   * change would be answering a message it had already received.
   */
  onText?(value: string, element: T, kind: TextChangeKind): void;
}

export interface SharedTextEditResult<T extends HTMLElement> {
  ref: RefObject<T | null>;
  /** The text the field and the document agree on, for counters and fitting. */
  value: string;
  /** Spread onto the editable element. */
  fieldProps: {
    ref: RefObject<T | null>;
    onInput: (event: { currentTarget: T }) => void;
    onCompositionStart: () => void;
    onCompositionEnd: (event: { currentTarget: T }) => void;
    onKeyDown: (event: React.KeyboardEvent<T>) => void;
    onBlur: (event: { currentTarget: T }) => void;
  };
}

export function useSharedTextEdit<T extends HTMLElement>(
  options: SharedTextEditOptions<T>,
): SharedTextEditResult<T> {
  const { ytext, maxChars, field, hostSelector, onEnd, undo, ownNewlines } = options;
  const ref = useRef<T | null>(null);
  const [value, setValue] = useState(() => ytext.toString());
  const composingRef = useRef(false);
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;
  const undoRef = useRef(undo);
  undoRef.current = undo;
  // The latest options without re-binding the document observers on every render.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  /**
   * The text this field and the document last agreed on.
   *
   * Keeping it is what makes two people typing in one object safe. Every keystroke is
   * committed straight away, so between keystrokes the field, the document and this value
   * hold the same string; when somebody else's text arrives it is written into the field
   * and this value moves with it. A commit is then always a diff against the text it
   * started from — a local edit — and never a diff against a stale copy, which is how the
   * other person's characters would go away.
   */
  const sharedValueRef = useRef<string>(ytext.toString());

  const settle = useCallback((next: string, kind: TextChangeKind) => {
    setValue(next);
    const element = ref.current;
    if (element) optionsRef.current.onText?.(next, element, kind);
  }, []);

  /** Write what the person has into the document, keeping the caret in place. */
  const commit = useCallback(
    (raw: string) => {
      const element = ref.current;
      const next = raw.length > maxChars ? raw.slice(0, maxChars) : raw;
      if (element && next !== raw) {
        // The characters past the limit never existed; keep the caret at the end of
        // what is really in the object.
        const caret = Math.min(field.caret(element) ?? next.length, next.length);
        field.write(element, next);
        field.setCaret(element, caret);
      }
      applyTextDiff(ytext, next, LOCAL_ORIGIN);
      sharedValueRef.current = next;
      settle(next, 'local');
    },
    [field, maxChars, settle, ytext],
  );

  // Somebody else's typing, arriving in the object being edited: it goes into the field,
  // because an object that shows one thing to each person is not a shared object. While a
  // composition is running the field is left alone — replacing text a person is halfway
  // through composing is worse than a short delay — and it lands on the next commit.
  useEffect(() => {
    const onRemoteChange = (_event: Y.YEvent<Y.Text>, origin: unknown) => {
      if (origin === LOCAL_ORIGIN) return; // this field wrote it; it already has it
      const element = ref.current;
      if (!element || composingRef.current) return;
      const next = ytext.toString();
      const previous = sharedValueRef.current;
      if (previous === next) return;
      const focused = element.ownerDocument?.activeElement === element;
      const caret = field.caret(element) ?? next.length;
      sharedValueRef.current = next;
      field.write(element, next);
      if (focused) field.setCaret(element, shiftCaret(caret, previous, next));
      settle(next, 'remote');
    };
    ytext.observe(onRemoteChange);
    return () => {
      ytext.unobserve(onRemoteChange);
    };
  }, [field, settle, ytext]);

  // Mount: the object's current text, focused, caret at the end (`edit.start`).
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const next = ytext.toString();
    sharedValueRef.current = next;
    field.write(element, next);
    element.focus();
    field.setCaret(element, next.length);
    settle(next, 'mount');
    // Only on opening this field: the element and the text belong to the object, and a
    // re-run would move a caret the person has since moved themselves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Edit start and edit end are step boundaries (`undo.steps`): the first keystroke never
  // merges into whatever was done before this field was opened, and nothing typed here
  // merges into what is done after. Leaving is caught on unmount rather than in `onEnd`,
  // because a field can stop being edited in more ways than the ones that call `onEnd` —
  // for one, the person next door can delete the object being typed into.
  useEffect(() => {
    undoRef.current?.boundary();
    return () => {
      undoRef.current?.boundary();
    };
  }, []);

  // A pointerdown outside the object ends editing; it never writes again.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const element = ref.current;
      if (!element) return;
      if (!(event.target instanceof Element)) return;
      const host = element.closest(hostSelector);
      if (host && host.contains(event.target)) return; // still inside this object
      onEndRef.current();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [hostSelector]);

  const fieldProps = {
    ref,
    onInput: (event: { currentTarget: T }) => {
      if (composingRef.current) return; // applied on compositionend instead
      commit(field.read(event.currentTarget));
    },
    onCompositionStart: () => {
      composingRef.current = true;
    },
    onCompositionEnd: (event: { currentTarget: T }) => {
      composingRef.current = false;
      commit(field.read(event.currentTarget));
    },
    onKeyDown: (event: ReactKeyboardEvent<T>) => {
      const gesture = undoGesture(event);
      if (gesture !== null && undoRef.current) {
        // The field's own undo would change what this screen shows and nothing else, and
        // the next keystroke would then diff the document against a text the field no
        // longer holds. The controller's undo changes the document, and the observer
        // above writes the result back into this field.
        event.preventDefault();
        event.stopPropagation();
        if (gesture === 'redo') undoRef.current.redo();
        else undoRef.current.undo();
        return;
      }
      if (event.key === 'Enter' && ownNewlines) {
        // A newline of our own making (see `editableField`); the browser's version of
        // Enter wraps things in elements this board would only have to strip again.
        event.preventDefault();
        insertNewline(event.currentTarget);
        commit(field.read(event.currentTarget));
        return;
      }
      if (event.key !== 'Escape') return; // Enter and Tab belong to the field
      event.preventDefault(); // the board must not react to it either
      event.stopPropagation();
      onEndRef.current();
    },
    onBlur: () => {
      const element = ref.current;
      if (element && !composingRef.current) commit(field.read(element));
    },
  };

  return { ref, value, fieldProps };
}

export interface TextEditorProps {
  /** The object's own `Y.Text`: what this field writes into. */
  ytext: Y.Text;
  /** Font size the text is rendered at, in world units — the field is inside the scaled layer. */
  sizePx: number;
  /** Stop editing. Escape and a press outside the object both mean this. */
  onEnd(): void;
  /** This person's history: step boundaries around the edit, and Ctrl+Z inside it. */
  undo?: UndoController;
  /**
   * This person changed the text.
   *
   * The hook knows which changes came from the keyboard and which arrived from another
   * board; only the first kind may re-measure (`text.autosize`), because a box written in
   * answer to somebody else's text is a box that will be written again by them.
   */
  onLocalText?(): void;
}

/**
 * The `contenteditable` field of a piece of free text.
 *
 * It is a div rather than a textarea because the box this object stores is the text's own
 * size: the field has to be that box, with the browser's wrapping inside it, and a textarea
 * is a rectangle of its own making that would fight the measurement. Everything else about
 * editing — the limit, the caret, the IME, the remote update, the undo keys, the press that
 * closes it — is the shared behaviour in `useSharedTextEdit`.
 */
export function TextEditor({ ytext, sizePx, onEnd, undo, onLocalText }: TextEditorProps) {
  const { fieldProps } = useSharedTextEdit<HTMLDivElement>({
    ytext,
    maxChars: TEXT_MAX_CHARS,
    field: editableField,
    // The object's own element: a press anywhere else ends editing.
    hostSelector: '[data-text-object]',
    onEnd,
    undo,
    ownNewlines: true,
    onText: (_next, _element, kind) => {
      if (kind === 'local') onLocalText?.();
    },
  });

  return (
    <div
      className="text-object__editor"
      data-testid="text-editor"
      role="textbox"
      aria-multiline="true"
      aria-label="Text content"
      contentEditable
      // The DOM inside is the text itself, written by the hook rather than by React; this
      // is the arrangement React wants to be told about.
      suppressContentEditableWarning
      spellCheck={false}
      style={{ fontSize: `${sizePx}px`, lineHeight: TEXT_LINE_HEIGHT }}
      {...fieldProps}
    />
  );
}
