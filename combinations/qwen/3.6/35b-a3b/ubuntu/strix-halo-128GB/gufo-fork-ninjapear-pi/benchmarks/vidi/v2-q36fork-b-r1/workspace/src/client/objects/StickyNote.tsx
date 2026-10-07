import {
  useRef,
  useState,
  useEffect,
  useCallback,
  type CSSProperties,
  type ReactNode,
} from 'react';
import * as Y from 'yjs';
import {
  STICKY_SIZE_WORLD,
  STICKY_COLORS,
  DEFAULT_STICKY_COLOR,
  type StickyColor,
  DRAG_THRESHOLD_PX,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
} from '@/shared/config';
import { fitFontSize } from './StickyText';
import { StickyTextEditor } from './StickyTextEditor';
import { moveObject, bringToFront, deleteObject, setStickyColor } from '@/shared/board-model';
import type { StickySnapshot } from '@/shared/board-model';
import { NoteToolbar } from './NoteToolbar';

interface StickyNoteProps {
  note: StickySnapshot;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  onSelect(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
}

export function StickyNote({
  note,
  doc,
  zoom,
  selected,
  editing,
  onSelect,
  onStartEdit,
  onEndEdit,
}: StickyNoteProps): ReactNode {
  const containerRef = useRef<HTMLDivElement>(null);
  // Interaction state (local, not in Y.Doc)
  const [pointerState, setPointerState] = useState<'up' | 'pressed' | 'dragging'>('up');
  const pressPointRef = useRef<{ x: number; y: number } | null>(null);
  const dragStartWorldRef = useRef<{ x: number; y: number } | null>(null);
  const rafRef = useRef<number | null>(null);
  const movedRef = useRef(false);
  const broughtToFrontRef = useRef(false);

  // Compute font size based on content
  const [fontPx, setFontPx] = useState(STICKY_FONT_MAX_PX);
  const overflowRef = useRef(false);

  // Get Y.Text reference for the note
  const getYText = useCallback((): Y.Text | undefined => {
    try {
      const objectsMap = doc.getMap('objects');
      const noteMap = objectsMap.get(note.id);
      if (!noteMap || !(noteMap instanceof Y.Map)) return undefined;
      const val = noteMap.get('text');
      if (val instanceof Y.Text) return val;
      return undefined;
    } catch {
      return undefined;
    }
  }, [doc, note.id]);

  const ytext = getYText();

  // Compute font size when editing or on mount
  useEffect(() => {
    if (!containerRef.current || !editing) return;
    const el = containerRef.current.querySelector('.sticky-note-text-inner') as HTMLElement;
    if (!el || !ytext) return;

    // Set initial text content for measurement
    el.textContent = ytext.toString() || '\u00A0';
    el.style.fontSize = `${STICKY_FONT_MAX_PX}px`;
    el.style.padding = '8px';

    const result = fitFontSize(el, STICKY_SIZE_WORLD);
    setFontPx(result.fontPx);
    overflowRef.current = result.overflow;
  }, [note.text, editing, note.id, ytext]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.stopPropagation();
      e.preventDefault();
      setPointerState('pressed');
      pressPointRef.current = { x: e.clientX, y: e.clientY };
      dragStartWorldRef.current = { x: note.x, y: note.y };
      movedRef.current = false;
      broughtToFrontRef.current = false;

      const target = e.currentTarget as HTMLElement;
      try {
        target.setPointerCapture(e.pointerId);
      } catch (_err) {
        // Already captured — ignore
      }
    },
    [note.x, note.y],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (pointerState === 'up') return;
      if (!pressPointRef.current || !dragStartWorldRef.current) return;

      const dx = e.clientX - pressPointRef.current.x;
      const dy = e.clientY - pressPointRef.current.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist >= DRAG_THRESHOLD_PX && pointerState === 'pressed') {
        setPointerState('dragging');
        if (!broughtToFrontRef.current) {
          broughtToFrontRef.current = true;
          bringToFront(doc, note.id);
        }
        movedRef.current = true;
      }

      if (pointerState === 'dragging' && movedRef.current) {
        // Convert screen delta to world delta and update position
        const worldDx = dx / zoom;
        const worldDy = dy / zoom;
        const curX = dragStartWorldRef.current!.x;
        const curY = dragStartWorldRef.current!.y;
        moveObject(doc, note.id, curX + worldDx, curY + worldDy);
        dragStartWorldRef.current = { x: curX + worldDx, y: curY + worldDy };
      }
    },
    [pointerState, doc, note.id, zoom],
  );

  const handlePointerUpOrCancel = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    if (movedRef.current) {
      setPointerState('up');
      onSelect(note.id);
    } else if (pointerState === 'pressed') {
      setPointerState('up');
      onSelect(note.id);
    } else {
      setPointerState('up');
    }

    pressPointRef.current = null;
    dragStartWorldRef.current = null;
  }, [movedRef.current, pointerState, note.id, onSelect]);

  const handleLostPointerCapture = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setPointerState('up');
    pressPointRef.current = null;
  }, []);

  const handleDblClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onStartEdit(note.id);
    },
    [note.id, onStartEdit],
  );

  const handleDelete = useCallback(() => {
    deleteObject(doc, note.id);
    onEndEdit('unselected');
  }, [doc, note.id, onEndEdit]);

  const handleColorChange = useCallback(
    (color: StickyColor) => {
      setStickyColor(doc, note.id, color);
    },
    [doc, note.id],
  );

  const style: CSSProperties = {
    position: 'absolute',
    left: 0,
    top: 0,
    width: STICKY_SIZE_WORLD,
    height: STICKY_SIZE_WORLD,
    backgroundColor: STICKY_COLORS[note.color],
    borderRadius: '4px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
    transform: `translate(${note.x}px, ${note.y}px)`,
    cursor: pointerState === 'dragging' ? 'grabbing' : pointerState === 'pressed' ? 'grabbing' : 'grab',
    display: 'flex',
    flexDirection: 'column',
    userSelect: 'none',
    zIndex: note.z,
    ...(!editing && pointerState !== 'dragging'
      ? { outline: selected ? '2px solid #2979ff' : 'none', outlineOffset: '-2px' }
      : {}),
  };

  return (
    <div
      ref={containerRef}
      role="group"
      aria-label="Sticky note"
      data-selected={selected ? 'true' : undefined}
      data-testid={`sticky-${note.id}`}
      style={style}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUpOrCancel}
      onPointerCancel={handlePointerUpOrCancel}
      onLostPointerCapture={handleLostPointerCapture}
      onDoubleClick={handleDblClick}
    >
      {/* Note toolbar – shown above the note when selected and not dragging/editing */}
      {!editing && pointerState !== 'dragging' && selected && (
        <NoteToolbar
          color={note.color}
          onColor={handleColorChange}
          onDelete={handleDelete}
        />
      )}
      {editing && ytext ? (
        <StickyTextEditor
          ytext={ytext}
          fontPx={fontPx}
          onEnd={(next) => onEndEdit(next)}
          overflow={overflowRef.current}
        />
      ) : (
        <div
          className="sticky-note-text-inner"
          style={{
            flex: 1,
            padding: '8px',
            textAlign: 'center',
            fontSize: `${fontPx}px`,
            fontFamily: 'Arial, sans-serif',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            overflow: 'hidden',
            lineHeight: '1.3',
            color: '#000',
          }}
        >
          {note.text}
          {overflowRef.current && note.text.length > 0 && (
            <div
              className="sticky-note-fade"
              style={{
                position: 'absolute',
                bottom: 0,
                left: 0,
                right: 0,
                height: '30px',
                background: `linear-gradient(transparent, ${STICKY_COLORS[note.color]})`,
                pointerEvents: 'none',
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}
