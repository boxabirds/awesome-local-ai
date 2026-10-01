import { useRef, useLayoutEffect, useEffect, useState, type ReactElement } from 'react';
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
 * A sticky note. Story 7: all drag logic moved out — pointerdown is delegated
 * to `onObjectPointerDown` (selection + group gesture), and the rendered
 * size comes from the object's width/height (falling back to the standard
 * 200×200 for pre-story-7 notes).
 */
export function StickyNote({
  obj,
  doc,
  zoom,
  selected,
  editing,
  onObjectPointerDown,
  onStartEdit,
  onEndEdit,
  undo,
}: ObjectProps): ReactElement {
  const note = obj as StickySnapshot;
  const id = note.id;
  const width = note.width ?? STICKY_SIZE_WORLD;
  const height = note.height ?? STICKY_SIZE_WORLD;
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [fontPx, setFontPx] = useState(STICKY_FONT_MAX_PX);
  const [overflow, setOverflow] = useState(false);

  // Latest callbacks for the (stable) native pointer handlers.
  const onObjectPointerDownRef = useRef(onObjectPointerDown);
  onObjectPointerDownRef.current = onObjectPointerDown;
  const onStartEditRef = useRef(onStartEdit);
  onStartEditRef.current = onStartEdit;

  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    const box = width - 2 * PADDING;
    const { fontPx: fp, overflow: ov } = fitFontSize(el, box);
    setFontPx(fp);
    setOverflow(ov);
  }, [note.text, editing, width]);

  // Pointer interaction: native listeners (NOT React synthetic) so that
  // stopPropagation runs before the board viewport's native pan listener.
  // Story 7: select + group gesture are delegated to onObjectPointerDown.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      e.stopPropagation(); // don't pan the board from a note
      onObjectPointerDownRef.current(e, id);
    };
    const onDoubleClick = (e: MouseEvent) => {
      e.stopPropagation();
      onStartEditRef.current(id);
    };
    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('dblclick', onDoubleClick);
    return () => {
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('dblclick', onDoubleClick);
    };
  }, [id]);

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
      style={{
        position: 'absolute',
        left: note.x,
        top: note.y,
        width,
        height,
        zIndex: note.z,
        padding: PADDING,
        background: color,
        borderRadius: 2,
        boxShadow: '0 2px 6px rgba(0,0,0,0.25)',
        outline: selected ? SELECTION_OUTLINE : 'none',
        boxSizing: 'border-box',
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'stretch',
        userSelect: 'none',
        touchAction: 'none',
      }}
    >
      {editing && text ? (
        <StickyTextEditor ytext={text} fontPx={fontPx} onEnd={onEndEdit} undo={undo} />
      ) : (
        <div
          ref={textRef}
          data-testid={`sticky-text-${id}`}
          aria-label="Note text"
          style={{
            width: '100%',
            height: '100%',
            fontSize: fontPx / zoom,
            fontFamily: 'Segoe Print, Bradley Hand, cursive, sans-serif',
            lineHeight: 1.2,
            overflow: 'hidden',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            pointerEvents: 'none',
          }}
        >
          {note.text}
          {overflow ? (
            <span
              data-testid="sticky-overflow-fade"
              aria-label="Text overflow"
              style={{
                position: 'absolute',
                right: 6,
                bottom: 4,
                fontSize: 14 / zoom,
                color: 'rgba(0,0,0,0.55)',
                pointerEvents: 'none',
              }}
            >
              ↓
            </span>
          ) : null}
        </div>
      )}
    </div>
  );
}
