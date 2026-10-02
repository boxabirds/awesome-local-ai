import { useRef, useLayoutEffect, useState } from 'react';
import {
  STICKY_SIZE_WORLD,
  STICKY_COLORS,
  STICKY_FONT_MAX_PX,
  type StickyColor,
} from '../../shared/config';
import { getStickyText } from '../../shared/board-model';
import { fitFontSize } from './StickyText';
import { StickyTextEditor } from './StickyTextEditor';
import type { ObjectProps } from './registry';

const PADDING = 12;
const SELECTION_OUTLINE = '2px solid #1565C0';

/**
 * A single sticky note: renders at world (x, y) with its (possibly resized)
 * width/height. Selection and moving are handled by the generic transform
 * gesture (story 7): pointerdown is delegated to `onPointerDown`, and the
 * selection outline is drawn from `selected`. Double-click edits the text.
 */
export function StickyNote(props: ObjectProps): React.ReactElement {
  const { obj, doc, selected, editing, onPointerDown, onStartEdit, onEndEdit } = props;
  const id = obj.id;
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [fontPx, setFontPx] = useState<number>(STICKY_FONT_MAX_PX);
  const [overflow, setOverflow] = useState<boolean>(false);

  const width = obj.width ?? STICKY_SIZE_WORLD;
  const height = obj.height ?? STICKY_SIZE_WORLD;

  // Keep the latest onPointerDown available to the native listener.
  const onPointerDownRef = useRef(onPointerDown);
  onPointerDownRef.current = onPointerDown;

  // Native pointerdown: never pan the board from a note; delegate selection
  // and dragging to the generic transform gesture.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: PointerEvent) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      onPointerDownRef.current(e, id);
    };
    el.addEventListener('pointerdown', handler);
    return () => el.removeEventListener('pointerdown', handler);
  }, [id]);

  // Auto-fit the font to the note box when the text, size or edit mode change.
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    const box = width - 2 * PADDING;
    const { fontPx: fp, overflow: ov } = fitFontSize(el, box);
    setFontPx(fp);
    setOverflow(ov);
  }, [obj.text, editing, width]);

  const onDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onStartEdit(id);
  };

  const text = getStickyText(doc, id);
  const color = STICKY_COLORS[obj.color as StickyColor] ?? STICKY_COLORS.yellow;

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
