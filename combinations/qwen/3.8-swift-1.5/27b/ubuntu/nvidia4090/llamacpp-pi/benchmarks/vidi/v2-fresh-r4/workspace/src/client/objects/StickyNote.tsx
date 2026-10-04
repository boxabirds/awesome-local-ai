import { useEffect, useRef, useState, type JSX } from 'react';
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

export interface StickyNoteProps extends ObjectProps {
  /** The Y.Doc for text editing (only used when editing). */
  doc?: import('yjs').Doc;
  /** Current zoom level for font sizing. */
  zoom?: number;
  /** Called when editing ends. */
  onEndEdit?: (next: 'selected' | 'unselected') => void;
}

/**
 * Sticky note component. Delegates pointer events to the transform gesture.
 * Renders width/height from the object snapshot (falls back to STICKY_SIZE_WORLD).
 */
export function StickyNote(props: StickyNoteProps): JSX.Element {
  const { obj, selected, editing, onPointerDown, onDoubleClick, doc, onEndEdit } = props;
  const noteRef = useRef<HTMLDivElement>(null);

  const width = obj.width ?? STICKY_SIZE_WORLD;
  const height = obj.height ?? STICKY_SIZE_WORLD;

  // Font fit
  const [fontPx, setFontPx] = useState(STICKY_FONT_MAX_PX);
  const [overflow, setOverflow] = useState(false);

  const text = (obj as { text?: string }).text ?? '';

  // Re-fit font when text changes
  useEffect(() => {
    const el = noteRef.current?.querySelector('.sticky-text-display') as HTMLElement | null;
    if (!el) return;
    const result = fitFontSize(el, width - 16);
    setFontPx(result.fontPx);
    setOverflow(result.overflow);
  }, [text, width]);

  const ytext = editing && doc ? getStickyText(doc, obj.id) : undefined;

  const color = (obj as { color?: StickyColor }).color ?? 'yellow';

  return (
    <div
      ref={noteRef}
      className={`sticky-note${selected ? ' sticky-note--selected' : ''}${overflow ? ' sticky-note--overflow' : ''}`}
      role="group"
      aria-label="Sticky note"
      data-vidi6="sticky-note"
      data-selected={selected ? 'true' : 'false'}
      data-editing={editing ? 'true' : 'false'}
      tabIndex={0}
      style={{
        position: 'absolute',
        left: `${obj.x}px`,
        top: `${obj.y}px`,
        width: `${width}px`,
        height: `${height}px`,
        backgroundColor: STICKY_COLORS[color],
        zIndex: obj.z,
      }}
      onPointerDown={(e) => {
        if (editing) return; // Don't start drag while editing
        onPointerDown(e, obj.id);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onDoubleClick(e, obj.id);
      }}
    >
      {editing && ytext ? (
        <StickyTextEditor ytext={ytext} fontPx={fontPx} onEnd={onEndEdit ?? (() => {})} />
      ) : (
        <div
          className="sticky-text-display"
          style={{ fontSize: `${fontPx}px` }}
          data-vidi6="sticky-text-display"
        >
          {text}
        </div>
      )}
    </div>
  );
}
