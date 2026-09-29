import { type CSSProperties, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { applyTextDiff } from '../../shared/text-edit';
import type { UndoController } from '../board/undo';
import { undoShortcut } from '../board/useBoardKeys';
import { useUndoController } from '../board/useUndo';
import { type TextDelta, applyTextEditOver, clampEdit, transformIndex } from './StickyText';

/** True once the text (or the note containing it) has been deleted from the document. */
function isDetached(type: Y.AbstractType<any>): boolean {
  if (!type.doc) return true;
  let item = type._item;
  while (item) {
    if (item.deleted) return true;
    item = (item.parent as Y.AbstractType<any>)._item;
  }
  return false;
}

/**
 * Textarea editing an object's Y.Text (sticky notes, text objects). Each input is written
 * immediately as a minimal diff, clamped to `maxChars`, so ending the edit needs no extra write.
 * Other people's changes to the text appear in the textarea as they arrive, with the caret kept
 * in place (during IME composition they are applied once composition ends, so the composition
 * is not disturbed). Enter inserts a new line; Escape or a press outside the object ends editing.
 */
export function TextEditor(props: {
  ytext: Y.Text;
  maxChars: number;
  fontPx: number;
  /** Width in world units, or 'auto' to fill the container. */
  width: number | 'auto';
  /** After each local change has been written to the Y.Text. */
  onInput?(): void;
  onEnd(next: 'selected' | 'unselected'): void;
  /** The board's history; defaults to the UndoContext's controller. */
  undo?: UndoController | null;
  /** Close the undo step when editing starts (default true). */
  boundaryOnStart?: boolean;
  ariaLabel: string;
  className: string;
  style?: CSSProperties;
  /** Extra content after the textarea (e.g. a character counter), given the current length. */
  after?(length: number): ReactNode;
}) {
  const { ytext, maxChars } = props;
  const ref = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  const [initial] = useState(() => ytext.toString());
  const [length, setLength] = useState(initial.length);
  const onEndRef = useRef(props.onEnd);
  onEndRef.current = props.onEnd;
  /** The text the textarea's content is based on: the Y.Text as of the last sync. */
  const shownRef = useRef(initial);
  /** Remote changes received while composing, not yet shown in the textarea. */
  const pendingRemoteRef = useRef<TextDelta[]>([]);
  const contextHistory = useUndoController();
  const history = props.undo === undefined ? contextHistory : props.undo;
  const [boundaryOnStart] = useState(props.boundaryOnStart ?? true);
  const onInputRef = useRef(props.onInput);
  onInputRef.current = props.onInput;

  // Editing is its own run of undo steps: typing never merges with what came before or after.
  useEffect(() => {
    if (!history) return;
    if (boundaryOnStart) history.boundary();
    return () => history.boundary();
  }, [history, boundaryOnStart]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  // A press anywhere outside the note ends editing.
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const el = ref.current;
      const note = el?.closest('[data-object-id]') ?? el;
      if (note && e.target instanceof Node && note.contains(e.target)) return;
      onEndRef.current('unselected');
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, []);

  // Show other people's edits as they arrive.
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && !isDetached(ytext) && ytext.toString() !== shownRef.current) {
      // Changed between the first render and subscribing.
      el.value = ytext.toString();
      shownRef.current = el.value;
      setLength(el.value.length);
    }
    const onRemote = (event: Y.YTextEvent, tr: Y.Transaction) => {
      const el = ref.current;
      if (!el || tr.origin === LOCAL_ORIGIN) return;
      const delta = event.delta as TextDelta;
      if (composingRef.current) {
        pendingRemoteRef.current.push(delta);
        return;
      }
      const { selectionStart, selectionEnd, selectionDirection } = el;
      el.value = ytext.toString();
      shownRef.current = el.value;
      el.setSelectionRange(
        transformIndex(selectionStart, delta),
        transformIndex(selectionEnd, delta),
        selectionDirection,
      );
      setLength(el.value.length);
    };
    ytext.observe(onRemote);
    return () => ytext.unobserve(onRemote);
  }, [ytext]);

  const sync = () => {
    const el = ref.current;
    if (!el || composingRef.current || isDetached(ytext)) return;
    const base = shownRef.current;
    if (el.value.length > maxChars) {
      const { text, caret } = clampEdit(base, el.value, maxChars);
      el.value = text;
      el.setSelectionRange(caret, caret);
    }
    const remote = pendingRemoteRef.current;
    pendingRemoteRef.current = [];
    if (remote.length === 0) {
      applyTextDiff(ytext, el.value, LOCAL_ORIGIN);
    } else {
      // Remote changes arrived during composition: merge the local edit over them.
      const caret = applyTextEditOver(ytext, base, el.value, remote, LOCAL_ORIGIN);
      el.value = ytext.toString();
      el.setSelectionRange(caret, caret);
    }
    shownRef.current = el.value;
    setLength(el.value.length);
    onInputRef.current?.();
  };

  const width = props.width === 'auto' ? undefined : props.width;
  return (
    <>
      <textarea
        ref={ref}
        className={props.className}
        aria-label={props.ariaLabel}
        defaultValue={initial}
        style={{ ...props.style, width, fontSize: `${props.fontPx}px` }}
        onChange={(e) => {
          if (!(e.nativeEvent as InputEvent).isComposing) sync();
        }}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={() => {
          composingRef.current = false;
          sync();
        }}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          const shortcut = history ? undoShortcut(e.nativeEvent) : null;
          if (history && shortcut) {
            // The board's history, not the textarea's own, so the text never diverges from Y.Text.
            e.preventDefault();
            e.stopPropagation();
            sync();
            if (shortcut === 'undo') history.undo();
            else history.redo();
            return;
          }
          if (e.key !== 'Escape') return;
          e.preventDefault();
          e.stopPropagation();
          sync();
          // Ending runs in the step of the last edit (an emptied text object's removal is undone
          // together with that edit); the step closes right after.
          props.onEnd('selected');
          history?.boundary();
        }}
        onBlur={sync}
      />
      {props.after?.(length)}
    </>
  );
}
