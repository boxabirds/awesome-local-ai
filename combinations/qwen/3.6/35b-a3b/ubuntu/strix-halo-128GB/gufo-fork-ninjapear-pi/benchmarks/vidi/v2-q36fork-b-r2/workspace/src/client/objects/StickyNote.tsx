import * as React from 'react';
import {
  STICKY_SIZE_WORLD,
  STICKY_COLORS,
  DEFAULT_STICKY_COLOR,
  DRAG_THRESHOLD_PX,
  STICKY_FONT_MAX_PX,
} from '../../shared/config';
import type { ObjectSnapshot } from '../../shared/board-model';
import type { Doc } from 'yjs';
import { fitFontSize, getStickyText, applyTextDiff } from '../../shared/board-model';
import { StickyTextEditor } from './StickyTextEditor';
import { NoteToolbar } from './NoteToolbar';
import type { Camera } from '../canvas/camera';
import { registerObjectType } from './registry';
import { objectBounds } from '../../shared/geometry';


// --- Registry registration ---
// This module-level code registers the sticky type when imported
registerObjectType('sticky', {
  Component: StickyNote,
  resizable: true,
  aspectLocked: true,
  minSize: 50,
  editableText: true,
  hitTest: (obj: any, worldPoint: { x: number; y: number }) => {
    const bounds = objectBounds(obj);
    return (
      worldPoint.x >= bounds.x &&
      worldPoint.y >= bounds.y &&
      worldPoint.x <= bounds.x + bounds.width &&
      worldPoint.y <= bounds.y + bounds.height
    );
  },
});

export interface StickyNoteProps {
  obj: ObjectSnapshot;
  zoom: number;
  selected: boolean;
  editing: boolean;
  camera: Camera;
  onSelect?: (id: string) => void;
  onStartEdit?: (id: string) => void;
  onEndEdit: (next: 'selected' | 'unselected') => void;
  onMove?: (id: string, x: number, y: number) => boolean;
  onBringToFront?: (id: string) => boolean;
  onPointerDown?: (e: PointerEvent, id: string) => void;
}

/** @deprecated Use `obj` prop instead of `note` — this component now uses generic ObjectSnapshot */
interface LegacyStickyNoteProps {
  note: ObjectSnapshot;
  doc?: Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  camera: Camera;
  onSelect?: (id: string) => void;
  onStartEdit?: (id: string) => void;
  onEndEdit: (next: 'selected' | 'unselected') => void;
  onDelete?: (id: string) => void;
  onMove?: (id: string, x: number, y: number) => boolean;
  onBringToFront?: (id: string) => boolean;
  onObjectPointerDown?: (e: PointerEvent, id: string) => void;
}

export function StickyNote(props: LegacyStickyNoteProps | StickyNoteProps): React.JSX.Element {
  const legacy = ('note' in props);
  const note = legacy ? props.note : (props.obj as any);
  const onObjectPointerDown = legacy 
    ? ((props as LegacyStickyNoteProps).onObjectPointerDown ?? (() => {}))
    : ((props as StickyNoteProps).onPointerDown ?? (() => {}));
  
  const {
    zoom,
    selected,
    editing,
    camera,
    onSelect,
    onStartEdit,
    onEndEdit,
    onBringToFront,
  } = legacy ? props : props;

  const x = note.x;
  const y = note.y;
  const color = note.color || DEFAULT_STICKY_COLOR;
  const text = typeof note.text === 'string' ? note.text : String(note.text || '');
  const id = note.id;

  // Width/height with fallback for legacy notes without explicit size
  const w = (note.width !== undefined && Number.isFinite(note.width)) 
    ? note.width 
    : STICKY_SIZE_WORLD;
  const h = (note.height !== undefined && Number.isFinite(note.height)) 
    ? note.height 
    : STICKY_SIZE_WORLD;

  const ref = React.useRef<HTMLDivElement>(null);
  const fontFitRef = React.useRef<number | null>(null);
  const overflowRef = React.useRef<boolean>(false);

  // Compute font size on mount and when text changes
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    try {
      const result = fitFontSize(el, Math.min(w, h));
      fontFitRef.current = result.fontPx;
      overflowRef.current = result.overflow;
    } catch {
      fontFitRef.current = STICKY_FONT_MAX_PX;
    }
  }, [text, w, h]);

  const bgColor = STICKY_COLORS[color as keyof typeof STICKY_COLORS] || DEFAULT_STICKY_COLOR;
  const fontSize = fontFitRef.current ?? STICKY_FONT_MAX_PX;

  // Pointer down handler — delegate to external gesture system
  const handlePointerDown = React.useCallback(
    (e: React.PointerEvent) => {
      e.stopPropagation();
      onObjectPointerDown(e.nativeEvent, id);
    },
    [id, onObjectPointerDown],
  );

  // Double click to edit
  const handleDoubleClick = React.useCallback(
    (_e: React.MouseEvent) => {
      _e.stopPropagation();
      if (onStartEdit) onStartEdit(id);
    },
    [id, onStartEdit],
  );

  return (
    <div
      ref={ref}
      className={`sticky-note${selected ? ' sticky-note--selected' : ''}${editing ? ' sticky-note--editing' : ''}`}
      data-selected={selected}
      data-object-id={id}
      role="group"
      aria-label="Sticky note"
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDoubleClick}
      style={{
        position: 'absolute',
        left: `${x}px`,
        top: `${y}px`,
        width: `${w}px`,
        height: `${h}px`,
        backgroundColor: bgColor,
        borderRadius: '4px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        cursor: editing ? 'text' : 'grab',
        transformOrigin: '0 0',
        userSelect: 'none',
        overflow: 'hidden',
      }}
    >
      {/* Content layer */}
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
          {typeof note.doc !== 'undefined' && (
            <StickyTextEditor
              value={text}
              fontPx={fontSize}
              overflow={overflowRef.current}
              onChange={() => {}}
              onEnd={onEndEdit}
            />
          )}
          <span style={{ fontSize: `${fontSize}px`, fontFamily: 'system-ui, sans-serif', color: '#333' }}>
            {text || '\u00A0'}
          </span>
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
