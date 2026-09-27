import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import * as Y from 'yjs';
import type { TextSnapshot } from '../../shared/board-model';
import { getTextContent, isEmptyText, deleteIfEmpty } from '../../shared/objects/text';
import { fontSpec, createCanvasMeasurer } from './text/text-layout';
import { useTextBoxSync } from './useTextBoxSync';
import { TextEditor } from './TextEditor';
import { DRAG_THRESHOLD_PX, TEXT_MAX_CHARS } from '../../shared/config';
import type { TransformGesture } from '../board/transform-gesture';

/** One measurer for every block: it caches per string + font. */
const measurer = createCanvasMeasurer();

interface TextObjectProps {
  block: TextSnapshot;
  doc: Y.Doc;
  /** True when this block is part of the selection. */
  selected: boolean;
  /** The group that moves with it (the whole selection, or just itself). */
  groupIds: readonly string[];
  gesture: TransformGesture;
  editing: boolean;
  editable?: boolean;
  onSelect(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
}

type Mode = 'idle' | 'pressed' | 'dragging';

function alive(doc: Y.Doc, id: string): boolean {
  return doc.getMap<Y.Map<unknown>>('objects').has(id);
}

/**
 * One free-text block.
 *
 * The box follows the text, not the other way round: after every change the
 * stored footprint is recomputed from the measured layout (auto blocks grow to
 * the widest line, fixed-width blocks keep their width and grow downwards), and
 * only the horizontal handles are offered for it in the first place. Editing
 * happens in place; a block left empty at the end of editing is removed rather
 * than kept as an empty box.
 */
export function TextObject({
  block,
  doc,
  selected,
  groupIds,
  gesture,
  editing,
  editable = true,
  onSelect,
  onStartEdit,
  onEndEdit,
}: TextObjectProps) {
  const [mode, setMode] = useState<Mode>('idle');
  const modeRef = useRef<Mode>('idle');
  const start = useRef({ px: 0, py: 0, moved: false });
  const pressSelected = useRef(false);

  useEffect(() => {
    if (!alive(doc, block.id)) {
      modeRef.current = 'idle';
      setMode('idle');
    }
  }, [doc, block.id]);

  // --- Layout: keep the footprint in step with the content ------------------
  // Only a LOCAL change re-measures (design key decision 1): a remote update
  // renders the box its author measured, so five clients never rewrite one
  // block's dimensions. The write joins the transaction that caused it, so text
  // and box stay one undo step.
  useTextBoxSync(doc, block.id, measurer);

  // --- Pointer: the same generic move/select rule as every other object -----
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if (e.shiftKey) return; // a Shift+press belongs to the board (marquee)
    e.stopPropagation();
    if (editing || !editable) return;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    start.current = { px: e.clientX, py: e.clientY, moved: false };
    modeRef.current = 'pressed';
    setMode('pressed');
    pressSelected.current = selected;
    const group = selected && groupIds.length > 1 ? [...groupIds] : [block.id];
    gesture.beginMove(group, { x: e.clientX, y: e.clientY });
  };

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (modeRef.current === 'idle') return;
      e.stopPropagation();
      if (!alive(doc, block.id)) {
        gesture.reset();
        modeRef.current = 'idle';
        setMode('idle');
        return;
      }
      const dist = Math.hypot(e.clientX - start.current.px, e.clientY - start.current.py);
      if (dist < DRAG_THRESHOLD_PX) return;
      if (modeRef.current === 'pressed') {
        modeRef.current = 'dragging';
        setMode('dragging');
        if (!pressSelected.current) onSelect(block.id);
      }
      gesture.update({ x: e.clientX, y: e.clientY }, dist);
    },
    [doc, block.id, gesture, onSelect],
  );

  const finish = (e: ReactPointerEvent<HTMLDivElement>) => {
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    if (modeRef.current === 'pressed') onSelect(block.id);
    gesture.reset();
    if (modeRef.current !== 'idle') {
      modeRef.current = 'idle';
      setMode('idle');
    }
  };

  const font = fontSpec(block.size);

  return (
    <div
      role="group"
      aria-label="Text block"
      data-testid="text-block"
      data-block-id={block.id}
      data-selected={selected ? 'true' : 'false'}
      data-mode={mode}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (!editing && editable) onStartEdit(block.id);
      }}
      style={{
        position: 'absolute',
        left: block.x,
        top: block.y,
        width: block.width,
        height: block.height,
        pointerEvents: 'auto',
        outline: selected ? '2px solid #2563eb' : 'none',
        fontSize: font.size,
        lineHeight: font.lineHeight,
        color: '#111',
        background: editing ? 'rgba(255,255,255,0.92)' : 'transparent',
        boxShadow: editing ? '0 1px 4px rgba(0,0,0,0.2)' : 'none',
      }}
    >
      {editing ? (
        <TextBlockEditor key="edit" doc={doc} id={block.id} ytext={getTextContent(doc, block.id)} font={font} onEnd={onEndEdit} />
      ) : (
        <div
          data-testid="text-display"
          style={{
            position: 'absolute',
            inset: 0,
            padding: '6px 8px',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            overflow: 'hidden',
            fontSize: font.size,
            lineHeight: font.lineHeight,
            color: '#111',
          }}
        >
          {block.text}
        </div>
      )}
    </div>
  );
}

/**
 * The in-place editor of a text block: the shared TextEditor with the block's
 * own limits and font, plus the one rule that belongs to text blocks alone — a
 * block left with zero characters when editing ends is deleted, so an
 * abandoned box never stays on the board (contract `text.empty_removed`).
 */
function TextBlockEditor({
  doc,
  id,
  ytext,
  font,
  onEnd,
}: {
  doc: Y.Doc;
  id: string;
  ytext: Y.Text | undefined;
  font: ReturnType<typeof fontSpec>;
  onEnd(next: 'selected' | 'unselected'): void;
}) {
  if (ytext === undefined) return null;
  return (
    <TextEditor
      key={id}
      ytext={ytext}
      maxChars={TEXT_MAX_CHARS}
      fontPx={font.size}
      lineHeight={font.lineHeight}
      padding="6px 8px"
      testId="text-editor"
      ariaLabel="Text block text"
      endOnBlur
      onEnd={() => {
        // Editing can end because the block was deleted remotely; then there is
        // nothing to write and nothing to keep selected.
        if (!alive(doc, id) || isEmptyText(doc, id)) {
          deleteIfEmpty(doc, id);
          onEnd('unselected');
          return;
        }
        onEnd('selected');
      }}
    />
  );
}
