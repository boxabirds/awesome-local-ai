// src/client/objects/StickyNote.tsx
// Sticky note component (story 7: delegates drag to transform gesture).

import { useCallback, useRef, useEffect, useState } from 'react';
import type { ReactElement, PointerEvent as ReactPointerEvent } from 'react';
import * as Y from 'yjs';
import type { StickySnapshot } from '../../shared/board-model';
import { getStickyText } from '../../shared/board-model';
import { STICKY_SIZE_WORLD, STICKY_COLORS, STICKY_FONT_MAX_PX } from '../../shared/config';
import { fitFontSize } from './StickyText';
import { StickyTextEditor } from './StickyTextEditor';
import { _registerStickyComponent } from './registerSticky';
import type { UndoController } from '../board/undo';

export interface StickyNoteProps {
  note: StickySnapshot;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  onPointerDown: (e: ReactPointerEvent, id: string) => void;
  onDblClick: (e: React.MouseEvent, id: string) => void;
  onEndEdit: (next: 'selected' | 'unselected') => void;
  /** Per-client undo controller (story 8). */
  undo?: UndoController;
}

export function StickyNote(props: StickyNoteProps): ReactElement {
  const { note, doc, selected, editing, onPointerDown, onDblClick, onEndEdit, undo } = props;
  const elRef = useRef<HTMLDivElement>(null);
  const [fontPx, setFontPx] = useState(STICKY_FONT_MAX_PX);
  const [overflow, setOverflow] = useState(false);

  const width = note.width ?? STICKY_SIZE_WORLD;
  const height = note.height ?? STICKY_SIZE_WORLD;

  // Fit font size when text changes
  useEffect(() => {
    const el = elRef.current?.querySelector('[data-sticky-text]');
    if (el && !editing) {
      const result = fitFontSize(el as HTMLElement, width);
      setFontPx(result.fontPx);
      setOverflow(result.overflow);
    }
  }, [note.text, editing, width]);

  const handlePointerDown = useCallback((e: ReactPointerEvent) => {
    if (editing) return;
    onPointerDown(e, note.id);
  }, [editing, note.id, onPointerDown]);

  const handleDblClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (!editing) {
      onDblClick(e, note.id);
    }
  }, [editing, note.id, onDblClick]);

  // Get the Y.Text for this note
  const ytext = getStickyText(doc, note.id);

  return (
    <div
      ref={elRef}
      role="group"
      aria-label="Sticky note"
      data-selected={selected || undefined}
      data-testid={`sticky-note-${note.id}`}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDblClick}
      style={{
        position: 'absolute',
        left: note.x,
        top: note.y,
        width,
        height,
        background: STICKY_COLORS[note.color],
        borderRadius: 2,
        boxShadow: '2px 2px 8px rgba(0,0,0,0.2)',
        outline: selected ? '2px solid #2196F3' : 'none',
        outlineOffset: 2,
        cursor: 'grab',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        userSelect: 'none',
      }}
    >
      {editing && ytext ? (
        <StickyTextEditor
          ytext={ytext}
          fontPx={fontPx}
          onEnd={onEndEdit}
          undo={undo}
        />
      ) : (
        <div
          data-sticky-text
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 12,
            fontSize: fontPx,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            textAlign: 'center',
            overflow: 'hidden',
            position: 'relative',
            borderRadius: 2,
          }}
        >
          {note.text}
          {overflow && (
            <div
              className="sticky-fade"
              data-testid="sticky-fade"
              style={{
                position: 'absolute',
                bottom: 0,
                left: 0,
                right: 0,
                height: 30,
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

// Register this component with the sticky type
_registerStickyComponent(StickyNote);
