import * as React from 'react';
import {
  STICKY_SIZE_WORLD,
  STICKY_COLORS,
  DEFAULT_STICKY_COLOR,
  DRAG_THRESHOLD_PX,
  STICKY_FONT_MAX_PX,
} from '../../shared/config';
import type { StickySnapshot } from '../../shared/board-model';
import type { Doc } from 'yjs';
import { fitFontSize, getStickyText, applyTextDiff } from '../../shared/board-model';
import { StickyTextEditor } from './StickyTextEditor';
import { NoteToolbar } from './NoteToolbar';
import type { Camera } from '../canvas/camera';

interface StickyNoteProps {
  note: StickySnapshot;
  doc: Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  camera: Camera;
  onSelect: (id: string) => void;
  onStartEdit: (id: string) => void;
  onEndEdit: (next: 'selected' | 'unselected') => void;
  onDelete?: (id: string) => void;
  onMove?: (id: string, x: number, y: number) => boolean;
  onBringToFront?: (id: string) => boolean;
}

export function StickyNote(props: StickyNoteProps): React.JSX.Element {
  const {
    note,
    doc,
    zoom,
    selected,
    editing,
    camera,
    onSelect,
    onStartEdit,
    onEndEdit,
  } = props;

  const { x, y, color, text, id } = note;
  const ref = React.useRef<HTMLDivElement>(null);
  const dragRef = React.useRef<{
    state: 'none' | 'pressed' | 'selected' | 'dragging' | 'editing';
    startX: number;
    startY: number;
    noteStartX: number;
    noteStartY: number;
  }>({ state: 'none', startX: 0, startY: 0, noteStartX: 0, noteStartY: 0 });
  const rafRef = React.useRef<number | null>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const fontFitRef = React.useRef<number | null>(null);
  const overflowRef = React.useRef<boolean>(false);
  const [editorValue, setEditorValue] = React.useState(text);
  // Get Y.Text reference for editor - guard against non-Yjs docs
  function getYText() {
    try {
      if ((doc as any).getMap) {
        return getStickyText(doc as any, id);
      }
    } catch {
      // ignore
    }
    return undefined;
  }
  const ytextRef = React.useRef(getYText());

  // Compute font size and overflow on mount and when text changes
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const result = fitFontSize(el, STICKY_SIZE_WORLD);
    fontFitRef.current = result.fontPx;
    overflowRef.current = result.overflow;
  }, [text]);

  // Update editor value when text prop changes externally
  React.useEffect(() => {
    setEditorValue(text);
  }, [text]);

  // Pointer down handler
  const handlePointerDown = React.useCallback(
    (e: React.PointerEvent) => {
      e.stopPropagation();

      const cx = (e as unknown as { clientX?: number; pageX?: number }).clientX ?? (e as unknown as { pageX?: number }).pageX ?? 0;
      const cy = (e as unknown as { clientY?: number; pageY?: number }).clientY ?? (e as unknown as { pageY?: number }).pageY ?? 0;
      const drag = dragRef.current;
      drag.state = 'pressed';
      drag.startX = cx;
      drag.startY = cy;
      drag.noteStartX = x;
      drag.noteStartY = y;
    },
    [x, y],
  );

  // Pointer move handler
  const handlePointerMove = React.useCallback(
    (e: React.PointerEvent) => {
      const drag = dragRef.current;
      if (drag.state === 'none' || drag.state === 'editing') return;

      const cx = (e as unknown as { clientX?: number; pageX?: number }).clientX ?? (e as unknown as { pageX?: number }).pageX ?? 0;
      const cy = (e as unknown as { clientY?: number; pageY?: number }).clientY ?? (e as unknown as { pageY?: number }).pageY ?? 0;
      const distX = cx - drag.startX;
      const distY = cy - drag.startY;
      const distance = Math.sqrt(distX * distX + distY * distY);

      if (drag.state === 'pressed' && distance >= DRAG_THRESHOLD_PX) {
        drag.state = 'dragging';
        if (props.onBringToFront) {
          props.onBringToFront(id);
        }
      }

      if (drag.state === 'dragging') {
        if (rafRef.current === null) {
          rafRef.current = requestAnimationFrame(() => {
            rafRef.current = null;
            const d = dragRef.current;
            const dCx = (e as unknown as { clientX?: number; pageX?: number }).clientX ?? (e as unknown as { pageX?: number }).pageX ?? 0;
            const dCy = (e as unknown as { clientY?: number; pageY?: number }).clientY ?? (e as unknown as { pageY?: number }).pageY ?? 0;
            const newDx = dCx - drag.startX;
            const newDy = dCy - drag.startY;
            const worldDeltaX = newDx / zoom;
            const worldDeltaY = newDy / zoom;
            const newX = d.noteStartX + worldDeltaX;
            const newY = d.noteStartY + worldDeltaY;
            if (props.onMove) {
              props.onMove(id, newX, newY);
            }
          });
        }
      }
    },
    [zoom, id, props.onMove, props.onBringToFront],
  );

  // Pointer up handler
  const handlePointerUp = React.useCallback(() => {
    const drag = dragRef.current;
    if (drag.state === 'dragging') {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      drag.state = 'selected';
    } else if (drag.state === 'pressed') {
      onSelect(id);
    }
    drag.state = 'none';
  }, [id, onSelect]);

  const handleLostPointerCapture = React.useCallback(() => {
    if (dragRef.current.state === 'dragging') {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    }
    dragRef.current.state = 'selected';
  }, []);

  // Double click handler — start editing
  const handleDoubleClick = React.useCallback(
    (_e: React.MouseEvent) => {
      _e.stopPropagation();
      onStartEdit(id);
    },
    [id, onStartEdit],
  );

  // Keyboard handler
  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent) => {
      if (editing) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        onStartEdit(id);
      }
    },
    [editing, id, onStartEdit],
  );

  // Editor change handler
  const handleEditorChange = React.useCallback((next: string) => {
    setEditorValue(next);
    // The Y.Text update is handled by applyTextDiff
    if (ytextRef.current) {
      applyTextDiff(ytextRef.current, next, 'sticky-editor');
    }
  }, []);

  const bgColor = STICKY_COLORS[color as keyof typeof STICKY_COLORS] || DEFAULT_STICKY_COLOR;
  const fontSize = fontFitRef.current ?? STICKY_FONT_MAX_PX;

  return (
    <div
      ref={ref}
      className={`sticky-note${selected ? ' sticky-note--selected' : ''}${editing ? ' sticky-note--editing' : ''}`}
      data-selected={selected}
      role="group"
      aria-label="Sticky note"
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handleLostPointerCapture}
      onLostPointerCapture={handleLostPointerCapture}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
      style={{
        position: 'absolute',
        left: `${x}px`,
        top: `${y}px`,
        width: `${STICKY_SIZE_WORLD}px`,
        height: `${STICKY_SIZE_WORLD}px`,
        backgroundColor: bgColor,
        borderRadius: '4px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        cursor: editing ? 'text' : 'grab',
        transformOrigin: '0 0',
        userSelect: 'none',
        overflow: 'hidden',
      }}
    >
      {/* Visible content layer */}
      {editing ? (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            padding: '16px',
            boxSizing: 'border-box',
            whiteSpace: 'pre-wrap',
            wordWrap: 'break-word',
          }}
        >
          <StickyTextEditor
            value={editorValue}
            fontPx={fontSize}
            overflow={overflowRef.current}
            onChange={handleEditorChange}
            onEnd={onEndEdit}
          />
        </div>
      ) : (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            fontSize: `${fontSize}px`,
            fontFamily: 'system-ui, -apple-system, sans-serif',
            color: '#333',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            padding: '16px',
            boxSizing: 'border-box',
            whiteSpace: 'pre-wrap',
            wordWrap: 'break-word',
            lineHeight: '1.3',
            minHeight: '0',
            maxHeight: '100%',
            ...(overflowRef.current ? {
              overflow: 'hidden',
              maskImage: 'linear-gradient(to bottom, transparent, black 60%)',
              WebkitMaskImage: 'linear-gradient(to bottom, transparent, black 60%)',
            } : {}),
          }}
        >
          {text || '\u00A0'}
        </div>
      )}

      {/* Selection border */}
      {selected && !editing && (
        <div
          style={{
            position: 'absolute',
            inset: '-2px',
            border: '2px solid #1a73e8',
            borderRadius: '6px',
            pointerEvents: 'none',
          }}
          aria-hidden="true"
        />
      )}
    </div>
  );
}
