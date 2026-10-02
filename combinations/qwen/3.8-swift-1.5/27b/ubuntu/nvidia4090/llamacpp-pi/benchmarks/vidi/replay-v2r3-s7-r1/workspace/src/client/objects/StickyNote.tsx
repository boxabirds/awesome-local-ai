import { useRef, useLayoutEffect, useState } from 'react';
import { STICKY_SIZE_WORLD, STICKY_COLORS, STICKY_FONT_MAX_PX } from '../../shared/config';
import { getStickyText, type StickySnapshot } from '../../shared/board-model';
import { fitFontSize } from './StickyText';
import { StickyTextEditor } from './StickyTextEditor';
import type { ObjectProps } from './registry';

const PADDING = 12;
const SELECTION_OUTLINE = '2px solid #1565C0';

/**
 * A single sticky note: renders at world (x, y) at its stored (or default)
 * size. Selection, move and resize are delegated to the generic transform
 * gesture (story 7) via `onPointerDown`; double-click starts text editing.
 */
export function StickyNote({
  obj,
  doc,
  selected,
  editing,
  onPointerDown,
  onStartEdit,
  onEndEdit,
}: ObjectProps): React.ReactElement {
  const note = obj as StickySnapshot;
  const id = note.id;
  const textRef = useRef<HTMLDivElement>(null);
  const width = note.width ?? STICKY_SIZE_WORLD;
  const height = note.height ?? STICKY_SIZE_WORLD;
  const [fontPx, setFontPx] = useState<number>(STICKY_FONT_MAX_PX);
  const [overflow, setOverflow] = useState<boolean>(false);

  // Auto-fit the font to the note box when the text, size (or edit mode) changes.
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    const box = width - 2 * PADDING;
    const { fontPx: fp, overflow: ov } = fitFontSize(el, box);
    setFontPx(fp);
    setOverflow(ov);
  }, [note.text, editing, width]);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation(); // never pan the board from a note
    // Prevent the implicit focus change on mousedown: a focus change mid
    // pointer-sequence makes Chromium cancel the pointer (pointercancel),
    // which kills in-progress move/resize gestures.
    e.nativeEvent.preventDefault();
    onPointerDown(e.nativeEvent, id);
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!editing) onStartEdit(id);
  };

  const text = getStickyText(doc, id);
  const color = STICKY_COLORS[note.color] ?? STICKY_COLORS.yellow;

  return (
    <div
      role="group"
      aria-label="Sticky note"
      data-testid={`sticky-note-${id}`}
      data-board-object
      data-selected={selected || undefined}
      data-color={note.color}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDoubleClick}
      className={overflow && !editing ? 'sticky-note--overflow' : undefined}
      style={{
        position: 'absolute',
        left: note.x,
        top: note.y,
        width,
        height,
        zIndex: note.z,
        background: color,
        boxShadow: '0 2px 6px rgba(0,0,0,0.25)',
        outline: selected ? SELECTION_OUTLINE : 'none',
        cursor: editing ? 'text' : 'grab',
        boxSizing: 'border-box',
        touchAction: 'none',
      }}
    >
      {editing && text ? (
        <StickyTextEditor ytext={text} fontPx={fontPx} onEnd={onEndEdit} />
      ) : (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            overflow: 'hidden',
            padding: PADDING,
            display: 'flex',
            alignItems: overflow ? 'flex-start' : 'center',
            justifyContent: 'center',
          }}
        >
          <div
            ref={textRef}
            style={{
              whiteSpace: 'pre-wrap',
              textAlign: 'center',
              width: '100%',
              color: '#222',
              fontSize: `${fontPx}px`,
              lineHeight: 1.2,
            }}
          >
            {note.text}
          </div>
        </div>
      )}
      {overflow && !editing && (
        <div
          data-testid="sticky-overflow-fade"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: 28,
            background: `linear-gradient(to bottom, transparent, ${color})`,
            pointerEvents: 'none',
          }}
        />
      )}
    </div>
  );
}
