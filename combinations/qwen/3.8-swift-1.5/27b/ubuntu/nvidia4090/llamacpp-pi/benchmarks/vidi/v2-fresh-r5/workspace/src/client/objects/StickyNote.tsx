import { useCallback, type JSX } from 'react';
import * as Y from 'yjs';
import type { ObjectSnapshot } from '../../shared/board-model';
import { getStickyText } from '../../shared/board-model';
import { STICKY_SIZE_WORLD, STICKY_COLORS, type StickyColor } from '../../shared/config';
import { StickyTextEditor } from './StickyTextEditor';
import type { UndoController } from '../board/undo';

interface StickyNoteProps {
  obj: ObjectSnapshot;
  selected: boolean;
  editing: boolean;
  canEdit: boolean;
  pointerDisabled?: boolean;
  /** Delegate pointerdown to the transform gesture. */
  onPointerDown: (e: React.PointerEvent, id: string) => void;
  /** Double-click handler (e.g. start editing). */
  onDoubleClick: (id: string) => void;
  /** The Y.Doc (needed for text editing). */
  doc?: Y.Doc;
  /** End editing callback. */
  onEndEdit?: (next: 'selected' | 'unselected') => void;
  /** Per-user undo controller (story 8). */
  undo?: UndoController | null;
}

/**
 * A single sticky note on the board. Renders the note and delegates
 * pointer interactions to the generic transform gesture. Text editing
 * is handled internally via the StickyTextEditor.
 */
export function StickyNote(props: StickyNoteProps): JSX.Element {
  const { obj, selected, editing, canEdit, pointerDisabled, onPointerDown, onDoubleClick, doc, onEndEdit, undo } = props;

  const note = obj as ObjectSnapshot & { color: StickyColor; text: string };

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (pointerDisabled) return;
      e.stopPropagation();
      if (!canEdit) return;
      if (editing) return;
      onPointerDown(e, obj.id);
    },
    [canEdit, editing, obj.id, onPointerDown, pointerDisabled],
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.stopPropagation();
      if (!canEdit) return;
      onDoubleClick(obj.id);
    },
    [canEdit, obj.id, onDoubleClick],
  );

  const ytext = doc ? getStickyText(doc, obj.id) : undefined;

  const width = obj.width ?? STICKY_SIZE_WORLD;
  const height = obj.height ?? STICKY_SIZE_WORLD;
  const bg = STICKY_COLORS[note.color] || STICKY_COLORS.yellow;

  return (
    <div
      role="group"
      aria-label="Sticky note"
      data-testid="sticky-note"
      data-selected={selected || undefined}
      data-editing={editing || undefined}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDoubleClick}
      style={{
        position: 'absolute',
        left: `${obj.x}px`,
        top: `${obj.y}px`,
        width: `${width}px`,
        height: `${height}px`,
        background: bg,
        borderRadius: '2px',
        boxShadow: selected
          ? '0 0 0 2px #1a73e8, 0 4px 12px rgba(0,0,0,0.15)'
          : '0 2px 8px rgba(0,0,0,0.12)',
        cursor: 'grab',
        pointerEvents: pointerDisabled ? 'none' : 'auto',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        userSelect: 'none',
      }}
    >
      {editing && ytext ? (
        <StickyTextEditor
          ytext={ytext}
          fontPx={24}
          onEnd={onEndEdit ?? (() => {})}
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
            padding: '12px',
            boxSizing: 'border-box',
            fontSize: '24px',
            fontFamily: 'sans-serif',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            textAlign: 'center',
            overflow: 'hidden',
            color: '#333',
          }}
        >
          {note.text}
        </div>
      )}
    </div>
  );
}
