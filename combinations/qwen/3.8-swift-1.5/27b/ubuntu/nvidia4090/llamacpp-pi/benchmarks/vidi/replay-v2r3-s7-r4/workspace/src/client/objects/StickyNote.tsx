import { useRef, useLayoutEffect, useEffect, useState } from 'react';
import {
  STICKY_SIZE_WORLD,
  STICKY_COLORS,
  STICKY_FONT_MAX_PX,
} from '../../shared/config';
import { getStickyText } from '../../shared/board-model';
import { fitFontSize } from './StickyText';
import { StickyTextEditor } from './StickyTextEditor';
import type { ObjectProps } from './registry';

const PADDING = 12;
const SELECTION_OUTLINE = '2px solid #1565C0';

/**
 * A sticky note. Story 7: selection, moving and resizing are delegated to
 * the generic transform gesture (`onObjectPointerDown`); the note only
 * renders its (now persisted) bounds and handles editing.
 */
export function StickyNote({
  obj,
  doc,
  selected,
  editing,
  onObjectPointerDown,
  onStartEdit,
  onEndEdit,
}: ObjectProps): React.ReactElement {
  const id = obj.id;
  const width = obj.width ?? STICKY_SIZE_WORLD;
  const height = obj.height ?? STICKY_SIZE_WORLD;
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [fontPx, setFontPx] = useState<number>(STICKY_FONT_MAX_PX);
  const [overflow, setOverflow] = useState<boolean>(false);

  const onObjectPointerDownRef = useRef(onObjectPointerDown);
  onObjectPointerDownRef.current = onObjectPointerDown;

  // Auto-fit the font to the note box when the text, size (or edit mode) changes.
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    const box = width - 2 * PADDING;
    const { fontPx: fp, overflow: ov } = fitFontSize(el, box);
    setFontPx(fp);
    setOverflow(ov);
  }, [obj.text, editing, width]);

  // Pointer interaction: delegate select/drag/resize to the generic gesture.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      e.stopPropagation(); // never pan the board from a note
      onObjectPointerDownRef.current(e, id);
    };
    el.addEventListener('pointerdown', onPointerDown);
    return () => {
      el.removeEventListener('pointerdown', onPointerDown);
    };
  }, [id]);

  const onDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onStartEdit(id);
  };

  const text = getStickyText(doc, id);
  const color = STICKY_COLORS[obj.color ?? 'yellow'];

  return (
    <div
      ref={containerRef}
      role="group"
      aria-label="Sticky note"
      data-testid={`sticky-note-${id}`}
      data-selected={selected || undefined}
      data-color={obj.color}
      tabIndex={0}
      onDoubleClick={onDoubleClick}
      className={overflow && !editing ? 'sticky-note--overflow' : undefined}
      style={{
        position: 'absolute',
        left: obj.x,
        top: obj.y,
        width,
        height,
        zIndex: obj.z,
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
            {obj.text ?? ''}
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
