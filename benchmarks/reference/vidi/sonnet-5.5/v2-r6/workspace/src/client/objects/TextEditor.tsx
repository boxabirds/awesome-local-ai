import { useEffect, useLayoutEffect, useRef, type CSSProperties } from 'react';
import type * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { clampEdit, applyTextDiff, mapIndexThroughDelta } from '../../shared/text-edit';
import type { UndoController } from '../board/undo';

/** The note or text element that contains the editor; a pointerdown outside it ends editing. */
const EDIT_ROOTS = '[data-sticky-note], [data-text-object]';

export interface TextEditorProps {
  ytext: Y.Text;
  maxChars: number;
  fontPx: number;
  width: number | 'auto';
  onInput(): void;
  onEnd(next: 'selected' | 'unselected'): void;
  undo: UndoController | null | undefined;
  /** Extras for the two users: accessible name, CSS class, extra styles, length reports. */
  label?: string;
  className?: string;
  style?: CSSProperties;
  onLengthChange?(length: number): void;
  /** Text still empty when editing starts stays in the same undo step as its creation. */
  mergeFreshWithCreation?: boolean;
}

/** Plain-text editor over a Y.Text: minimal diffs, clamped length, own undo steps, Escape/outside click ends. */
export function TextEditor(props: TextEditorProps) {
  const { ytext, maxChars, fontPx, width, onInput, onEnd, undo } = props;
  const ref = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const latest = useRef(props);
  latest.current = props;

  // Editing is its own undo step(s): never merged with the actions before or after it. Freshly created
  // (still empty) text stays in one step with its creation so removing it again leaves no trace.
  useEffect(() => {
    if (!undo) return undefined;
    const fresh = props.mergeFreshWithCreation === true && ytext.length === 0;
    if (fresh) undo.hold?.(true);
    else undo.boundary();
    return () => {
      if (fresh) undo.hold?.(false);
      undo.boundary();
    };
  }, [undo, ytext]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const text = ytext.toString();
    el.value = text;
    el.focus();
    el.setSelectionRange(text.length, text.length);
    latest.current.onLengthChange?.(text.length);
  }, [ytext]);

  // Changes from other people land in the textarea without moving the caret off its place.
  useEffect(() => {
    const onChange = (event: Y.YTextEvent, tr: Y.Transaction) => {
      const el = ref.current;
      if (!el || tr.origin === LOCAL_ORIGIN) return;
      const start = mapIndexThroughDelta(el.selectionStart, event.delta);
      const end = mapIndexThroughDelta(el.selectionEnd, event.delta);
      el.value = ytext.toString();
      el.setSelectionRange(start, end);
      latest.current.onLengthChange?.(ytext.length);
    };
    ytext.observe(onChange);
    return () => ytext.unobserve(onChange);
  }, [ytext]);

  // A pointerdown anywhere outside the note or text ends editing.
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const root = ref.current?.closest(EDIT_ROOTS);
      if (root && e.target instanceof Node && root.contains(e.target)) return;
      latest.current.onEnd('unselected');
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, []);

  // The box is written after the input; keep the (hidden-overflow) textarea showing its first line.
  useLayoutEffect(() => {
    const el = ref.current;
    if (el) {
      el.scrollTop = 0;
      el.scrollLeft = 0;
    }
  });

  const sync = () => {
    const el = ref.current;
    // The text may have been deleted meanwhile: never write to a removed Y.Text.
    if (!el || (ytext as unknown as { _item?: { deleted: boolean } })._item?.deleted) return;
    const prev = ytext.toString();
    const { value, caret } = clampEdit(prev, el.value, maxChars);
    if (value !== el.value) {
      el.value = value;
      el.setSelectionRange(caret, caret);
    }
    applyTextDiff(ytext, value, LOCAL_ORIGIN);
    props.onLengthChange?.(value.length);
    onInput();
  };

  return (
    <textarea
      ref={ref}
      className={props.className ?? 'text-editor'}
      aria-label={props.label ?? 'Text'}
      style={{ fontSize: fontPx, ...(width === 'auto' ? null : { width }), ...props.style }}
      spellCheck={false}
      onInput={() => { if (!composing.current) sync(); }}
      onCompositionStart={() => { composing.current = true; }}
      onCompositionEnd={() => { composing.current = false; sync(); }}
      onBlur={() => { if (!composing.current) sync(); }}
      onKeyDown={(e) => {
        const key = e.key.toLowerCase();
        if (undo && (e.ctrlKey || e.metaKey) && !e.altKey && (key === 'z' || (key === 'y' && e.ctrlKey))) {
          e.preventDefault();
          e.stopPropagation();
          if (!composing.current) {
            if (key === 'z' && !e.shiftKey) undo.undo();
            else undo.redo();
          }
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          onEnd('selected');
        }
      }}
    />
  );
}
