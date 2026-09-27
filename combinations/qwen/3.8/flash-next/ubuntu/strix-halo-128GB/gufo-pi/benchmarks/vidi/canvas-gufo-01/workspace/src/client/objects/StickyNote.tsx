// One sticky note on the board. Renders its snapshot (position, colour, z,
// text) and owns its interactions: select, threshold-gated drag, double-click
// to edit text. All mutations go through the shared model, so the same code
// paths run for local and remote clients.

import { useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { DRAG_THRESHOLD_PX, STICKY_COLORS, STICKY_SIZE_WORLD } from '../../shared/config';
import { moveObject, type StickySnapshot } from '../../shared/board-model';
import { StickyText } from './StickyText';
import { StickyTextEditor } from './StickyTextEditor';
import { NoteToolbar } from './NoteToolbar';

interface Props {
  note: StickySnapshot;
  yText: Y.Text | undefined;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  onSelect: (id: string, additive: boolean) => void;
}

export function StickyNote({ note, yText, doc, zoom, selected, onSelect }: Props) {
  const [editing, setEditing] = useState(false);
  const drag = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    originX: number;
    originY: number;
    moved: boolean;
  } | null>(null);

  useEffect(() => {
    if (!selected && editing) setEditing(false);
  }, [selected, editing]);

  return (
    <div
      data-object-id={note.id}
      data-note-color={note.color}
      className={`sticky-note${selected ? ' is-selected' : ''}`}
      style={{
        left: `${note.x}px`,
        top: `${note.y}px`,
        width: `${STICKY_SIZE_WORLD}px`,
        height: `${STICKY_SIZE_WORLD}px`,
        background: STICKY_COLORS[note.color],
      }}
      onPointerDown={(event) => {
        if ((event.target as HTMLElement).closest('.sticky-editor')) return;
        event.stopPropagation();
        onSelect(note.id, event.shiftKey || event.metaKey || event.ctrlKey);
        drag.current = {
          pointerId: event.pointerId,
          startClientX: event.clientX,
          startClientY: event.clientY,
          originX: note.x,
          originY: note.y,
          moved: false,
        };
        (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
      }}
      onPointerMove={(event) => {
        const state = drag.current;
        if (!state || state.pointerId !== event.pointerId) return;
        const dxScreen = event.clientX - state.startClientX;
        const dyScreen = event.clientY - state.startClientY;
        if (!state.moved && Math.hypot(dxScreen, dyScreen) < DRAG_THRESHOLD_PX) return;
        state.moved = true;
        moveObject(doc, note.id, state.originX + dxScreen / zoom, state.originY + dyScreen / zoom);
      }}
      onPointerUp={(event) => {
        drag.current = null;
        (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
      }}
      onDoubleClick={(event) => {
        event.stopPropagation();
        if (yText) setEditing(true);
      }}
    >
      {editing && yText ? (
        <StickyTextEditor yText={yText} onBlur={() => setEditing(false)} />
      ) : (
        <StickyText text={note.text} />
      )}
      {selected ? <NoteToolbar doc={doc} note={note} /> : null}
    </div>
  );
}
