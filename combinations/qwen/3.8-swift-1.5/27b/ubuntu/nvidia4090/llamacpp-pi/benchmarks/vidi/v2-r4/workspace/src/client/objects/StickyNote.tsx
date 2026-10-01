import { useRef, type JSX } from 'react';
import { STICKY_SIZE_WORLD, STICKY_COLORS, STICKY_FONT_MAX_PX } from '../../shared/config';
import { getStickyText, type StickySnapshot } from '../../shared/board-model';
import { StickyTextEditor } from './StickyTextEditor';
import type { ObjectProps } from './registry';

export function StickyNoteComponent(props: ObjectProps): JSX.Element {
  const { obj, doc, selected, editing, editable, onPointerDown, onStartEdit, onEndEdit, undo } = props;
  const elRef = useRef<HTMLDivElement>(null);

  const note = obj as StickySnapshot;
  const color = STICKY_COLORS[note.color] || STICKY_COLORS.yellow;
  const ytext = getStickyText(doc, note.id);
  const width = note.width ?? STICKY_SIZE_WORLD;
  const height = note.height ?? STICKY_SIZE_WORLD;

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!editable) return;
    onStartEdit(note.id);
  };

  return (
    <div
      ref={elRef}
      role="group"
      aria-label="Sticky note"
      data-testid="sticky-note"
      data-selected={selected || undefined}
      data-note-id={note.id}
      tabIndex={0}
      onPointerDown={(e) => {
        if (editing) return;
        if (!editable) {
          e.stopPropagation();
          return;
        }
        onPointerDown(e, note.id);
      }}
      onDoubleClick={handleDoubleClick}
      style={{
        position: 'absolute',
        left: note.x,
        top: note.y,
        width,
        height,
        backgroundColor: color,
        borderRadius: 4,
        boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
        outline: selected ? '3px solid #2196F3' : 'none',
        outlineOffset: 2,
        cursor: editing ? 'text' : 'grab',
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {editing && ytext ? (
        <StickyTextEditor
          ytext={ytext}
          fontPx={STICKY_FONT_MAX_PX}
          onEnd={onEndEdit}
          undo={undo}
        />
      ) : (
        <div
          data-testid="sticky-text-display"
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 12,
            boxSizing: 'border-box',
            fontSize: `${STICKY_FONT_MAX_PX}px`,
            fontFamily: 'system-ui, sans-serif',
            textAlign: 'center',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            overflow: 'hidden',
            pointerEvents: 'none',
          }}
        >
          {note.text}
        </div>
      )}
    </div>
  );
}

// Keep the old export name for backwards compatibility
export { StickyNoteComponent as StickyNote };
