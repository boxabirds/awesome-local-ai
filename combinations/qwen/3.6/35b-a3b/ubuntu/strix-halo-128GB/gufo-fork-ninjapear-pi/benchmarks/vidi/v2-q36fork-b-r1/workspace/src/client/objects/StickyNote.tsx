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
  STICKY_MIN_SIZE_WORLD,
  type StickyColor,
  DRAG_THRESHOLD_PX,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
} from '@/shared/config';
import { fitFontSize } from './StickyText';
import { StickyTextEditor } from './StickyTextEditor';
import { getStickyText, setStickyColor as setStickyColorModel, deleteObject as deleteObjModel } from '@/shared/board-model';
import type { ObjectSnapshot } from './registry';
import { NoteToolbar } from './NoteToolbar';
import type { UndoController } from '@/client/board/undo';

interface StickyNoteProps {
  note: ObjectSnapshot;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  isSelectedOnly: boolean;
  onSelect(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
  onObjectPointerDown(e: PointerEvent, id: string): void;
  /** Optional undo controller for per-user undo history. */
  undoController?: UndoController | null;
}

export function StickyNote({
  note,
  doc,
  zoom,
  selected,
  editing,
  isSelectedOnly,
  onSelect,
  onStartEdit,
  onEndEdit,
  onObjectPointerDown,
  undoController,
}: StickyNoteProps): ReactNode {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pointerState, setPointerState] = useState<'up' | 'pressed' | 'dragging'>('up');
  const dragStartWorldRef = useRef<{ x: number; y: number } | null>(null);
  const broughtToFrontRef = useRef(false);

  // Compute dimensions
  const width = (note.width as number) ?? STICKY_SIZE_WORLD;
  const height = (note.height as number) ?? STICKY_SIZE_WORLD;

  // Compute font size based on content
  const [fontPx, setFontPx] = useState(STICKY_FONT_MAX_PX);
  const overflowRef = useRef(false);

  // Get Y.Text reference for the note
  const ytext = getStickyText(doc, note.id);

  // Compute font size when editing or on mount
  useEffect(() => {
    if (!containerRef.current || !editing) return;
    const el = containerRef.current.querySelector('.sticky-note-text-inner') as HTMLElement;
    if (!el || !ytext) return;

    el.textContent = ytext.toString() || '\u00A0';
    el.style.fontSize = `${STICKY_FONT_MAX_PX}px`;
    el.style.padding = '8px';

    const result = fitFontSize(el, Math.min(width, height));
    setFontPx(result.fontPx);
    overflowRef.current = result.overflow;
  }, [note.text, editing, note.id, ytext, width, height]);

  // Pointer handlers delegated to gesture system
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.stopPropagation();
      e.preventDefault();
      setPointerState('pressed');
      dragStartWorldRef.current = { x: note.x, y: note.y };
      broughtToFrontRef.current = false;

      // Call the external gesture handler which manages dragging/resizing
      onObjectPointerDown(e.nativeEvent, note.id);
    },
    [note.id, note.x, note.y, onObjectPointerDown],
  );

  const handleDblClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onStartEdit(note.id);
    },
    [note.id, onStartEdit],
  );

  // Handle losing pointer capture
  const handleLostPointerCapture = useCallback(() => {
    setPointerState('up');
  }, []);

  // Delete handler for single-note toolbar (calls boundary first)
  const handleDelete = useCallback(() => {
    undoController?.boundary();
    deleteObjModel(doc, note.id);
    onEndEdit('unselected');
  }, [doc, note.id, onEndEdit, undoController]);

  // Colour change handler for single-note toolbar (calls boundary first)
  const handleColorChange = useCallback(
    (color: StickyColor) => {
      undoController?.boundary();
      setStickyColorModel(doc, note.id, color);
    },
    [doc, note.id, undoController],
  );

  const style: CSSProperties = {
    position: 'absolute',
    left: 0,
    top: 0,
    width: width,
    height: height,
    backgroundColor: note.color ? STICKY_COLORS[note.color as StickyColor] : STICKY_COLORS.yellow,
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
      onLostPointerCapture={handleLostPointerCapture}
      onDoubleClick={handleDblClick}
    >
      {/* Single-note toolbar — shown above the note when exactly one is selected */}
      {!editing && pointerState !== 'dragging' && selected && isSelectedOnly && (
        <NoteToolbar
          color={(note.color as StickyColor) ?? 'yellow'}
          onColor={handleColorChange}
          onDelete={handleDelete}
          undoBoundary={undoController?.boundary ?? null}
        />
      )}
      {editing && ytext ? (
        <StickyTextEditor
          ytext={ytext}
          fontPx={fontPx}
          onEnd={(next) => onEndEdit(next)}
          overflow={overflowRef.current}
          undoController={undoController}
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
          {(typeof note.text === 'string' ? note.text : String(note.text ?? ''))}
          {overflowRef.current && typeof note.text === 'string' && note.text!.length > 0 && (
            <div
              className="sticky-note-fade"
              style={{
                position: 'absolute',
                bottom: 0,
                left: 0,
                right: 0,
                height: '30px',
                background: `linear-gradient(transparent, ${(note.color as StickyColor) ? STICKY_COLORS[(note.color as StickyColor)] : STICKY_COLORS.yellow})`,
                pointerEvents: 'none',
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}
