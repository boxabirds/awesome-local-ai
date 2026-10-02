import { useRef, useLayoutEffect, useState } from 'react';
import {
  STICKY_SIZE_WORLD,
  STICKY_COLORS,
  STICKY_FONT_MAX_PX,
  type StickyColor,
} from '../../shared/config';
import { getStickyText, type StickySnapshot } from '../../shared/board-model';
import { fitFontSize } from './StickyText';
import { StickyTextEditor } from './StickyTextEditor';
import type { ObjectProps } from './registry';

const PADDING = 12;
const SELECTION_OUTLINE = '2px solid #1565C0';

/**
 * A single sticky note: renders at world (x, y) with its (possibly
 * story-7-era) width/height. Selecting, moving and resizing are delegated to
 * the generic transform gesture (sel.all_types): pointerdown is handed to
 * `onPointerDown`, double-click starts editing.
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
  const id = obj.id;
  const note = obj as StickySnapshot;
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [fontPx, setFontPx] = useState<number>(STICKY_FONT_MAX_PX);
  const [overflow, setOverflow] = useState<boolean>(false);

  const width = note.width ?? STICKY_SIZE_WORLD;
  const height = note.height ?? STICKY_SIZE_WORLD;

  // Auto-fit the font to the note box when the text (or edit mode) changes.
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    const box = width - 2 * PADDING;
    const { fontPx: fp, overflow: ov } = fitFontSize(el, box);
    setFontPx(fp);
    setOverflow(ov);
  }, [note.text, editing, width]);

  // Pointer interaction: the generic transform gesture owns select/drag.
  const onPointerDownRef = useRef(onPointerDown);
  onPointerDownRef.current = onPointerDown;
  const handlePointerDownRef = useRef((e: PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation(); // never pan the board from a note
    onPointerDownRef.current(e);
  });
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: PointerEvent) => handlePointerDownRef.current(e);
    el.addEventListener('pointerdown', handler);
    return () => el.removeEventListener('pointerdown', handler);
  }, []);

  const onDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onStartEdit();
  };

  const text = getStickyText(doc, id);
  const color = STICKY_COLORS[note.color as StickyColor] ?? STICKY_COLORS.yellow;

  return (
    <div
      ref={containerRef}
      role="group"
      aria-label="Sticky note"
      data-testid={`sticky-note-${id}`}
      data-selected={selected || undefined}
      data-color={note.color}
      tabIndex={0}
      onDoubleClick={onDoubleClick}
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
