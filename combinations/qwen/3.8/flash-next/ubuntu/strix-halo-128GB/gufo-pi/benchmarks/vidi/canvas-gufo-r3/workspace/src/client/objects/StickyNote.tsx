import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import {
  StickySnapshot,
  bringToFront,
  getStickyText,
  setStickyColor,
  deleteObject,
  objectBounds,
} from '@shared/board-model';
import { STICKY_SIZE_WORLD, STICKY_COLORS, DRAG_THRESHOLD_PX, StickyColor } from '@shared/config';
import { fitFontSize, counterVisible } from './StickyText';
import { STICKY_TEXT_MAX_CHARS } from '@shared/config';
import { StickyTextEditor } from './StickyTextEditor';
import { NoteToolbar } from './NoteToolbar';

export const NOTE_PADDING = 12;
export const NOTE_TOOLBAR_OFFSET = 44;

type NoteInteraction = 'unselected' | 'pressed' | 'selected' | 'dragging' | 'editing';

import type { UndoController } from '@client/board/undo';

export interface StickyNoteProps {
  note: StickySnapshot;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  dragging?: boolean;
  readOnly?: boolean;
  onSelect(id: string): void;
  onToggle?(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
  onObjectPointerDown?(e: React.PointerEvent, id: string): void;
  undoController?: UndoController | null;
}

export function StickyNote({
  note,
  doc,
  zoom,
  selected,
  editing,
  dragging = false,
  readOnly,
  onSelect,
  onToggle,
  onStartEdit,
  onEndEdit,
  onObjectPointerDown,
  undoController,
}: StickyNoteProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const measureRef = useRef<HTMLDivElement | null>(null);
  const [fontPx, setFontPx] = useState<number>(24);
  const [overflow, setOverflow] = useState<boolean>(false);

  const state: NoteInteraction = editing ? 'editing' : dragging ? 'dragging' : selected ? 'selected' : 'unselected';

  const bounds = objectBounds(note);
  const noteWidth = bounds.width;
  const noteHeight = bounds.height;

  // --- text auto-fit (zoom scales world units uniformly, so fit is zoom-independent) ---
  useLayoutEffect(() => {
    const el = measureRef.current;
    if (!el) return;
    const result = fitFontSize(el, noteWidth);
    setFontPx((prev) => (prev === result.fontPx ? prev : result.fontPx));
    setOverflow((prev) => (prev === result.overflow ? prev : result.overflow));
  }, [note.text, noteWidth]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (readOnly) return;
      if (e.button !== 0) return;
      e.stopPropagation();
      if (editing) return;
      e.preventDefault();

      // If shift is held, toggle selection
      if (e.shiftKey && onToggle) {
        onToggle(note.id);
        return;
      }

      // Delegate to transform gesture (handles selection + drag)
      if (onObjectPointerDown) {
        onObjectPointerDown(e, note.id);
      } else {
        onSelect(note.id);
      }
    },
    [editing, note.id, onSelect, onToggle, onObjectPointerDown],
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (readOnly) return;
      e.stopPropagation();
      if (editing) return;
      onSelect(note.id);
      onStartEdit(note.id);
    },
    [editing, note.id, onSelect, onStartEdit],
  );

  const ytext = editing ? getStickyText(doc, note.id) : undefined;

  // Note deleted while editing → end the interaction silently.
  useEffect(() => {
    if (editing && !ytext) onEndEdit('unselected');
  }, [editing, ytext, onEndEdit]);

  const handleColor = useCallback(
    (c: StickyColor) => {
      if (readOnly) return;
      undoController?.boundary();
      setStickyColor(doc, note.id, c);
      undoController?.boundary();
    },
    [doc, note.id, readOnly, undoController],
  );

  const handleDelete = useCallback(() => {
    if (readOnly) return;
    undoController?.boundary();
    deleteObject(doc, note.id);
    undoController?.boundary();
  }, [doc, note.id, readOnly, undoController]);

  const color = STICKY_COLORS[note.color];
  const showToolbar = selected && !editing;

  return (
    <div
      data-testid="sticky-note-wrapper"
      data-note-id={note.id}
      data-x={note.x}
      data-y={note.y}
      data-z={note.z}
      data-width={noteWidth}
      data-height={noteHeight}
      style={{
        position: 'absolute',
        left: note.x,
        top: note.y,
        width: noteWidth,
        height: noteHeight,
        zIndex: note.z,
      }}
    >
      <div
        ref={rootRef}
        role="group"
        aria-label="Sticky note"
        data-testid="sticky-note"
        data-note-id={note.id}
        data-selected={selected ? 'true' : 'false'}
        data-interaction={state}
        tabIndex={0}
        onPointerDown={handlePointerDown}
        onDoubleClick={handleDoubleClick}
        onFocus={() => {
          if (!editing) onSelect(note.id);
        }}
        style={{
          position: 'absolute',
          inset: 0,
          background: color,
          boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
          borderRadius: '2px',
          outline: selected ? '2px solid #1976D2' : 'none',
          cursor: 'grab',
          touchAction: 'none',
          overflow: 'hidden',
        }}
      >
        {/* hidden measuring element for auto-fit */}
        <div
          ref={measureRef}
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: noteWidth,
            visibility: 'hidden',
            pointerEvents: 'none',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            padding: `${NOTE_PADDING}px`,
            lineHeight: 1.3,
            fontFamily: 'inherit',
          }}
        >
          {note.text.length > 0 ? note.text : ' '}
        </div>
        <div
          data-testid="sticky-note-text"
          data-overflow={overflow ? 'true' : 'false'}
          className={overflow ? 'sticky-note-text' : 'sticky-note-text'}
          style={{
            position: 'absolute',
            inset: 0,
            padding: `${NOTE_PADDING}px`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            textAlign: 'center',
            fontSize: `${fontPx}px`,
            lineHeight: 1.3,
            color: '#222',
            userSelect: 'none',
          }}
        >
          {note.text}
        </div>
        {overflow && (
          <div
            data-testid="sticky-note-fade"
            className="sticky-note-fade"
            aria-hidden="true"
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              height: `${Math.max(14, fontPx * 1.4)}px`,
              background: `linear-gradient(to bottom, rgba(255,255,255,0), ${color})`,
              pointerEvents: 'none',
            }}
          />
        )}
        {editing && counterVisible(note.text.length) && (
          <div
            data-testid="sticky-note-counter"
            style={{
              position: 'absolute',
              right: '6px',
              bottom: '4px',
              fontSize: '11px',
              color: 'rgba(0,0,0,0.55)',
              pointerEvents: 'none',
              userSelect: 'none',
            }}
          >
            {note.text.length}/{STICKY_TEXT_MAX_CHARS}
          </div>
        )}
        {editing && ytext && (
          <StickyTextEditor
            key={note.id}
            ytext={ytext}
            fontPx={fontPx}
            padding={NOTE_PADDING}
            onEnd={onEndEdit}
            undoController={undoController}
          />
        )}
      </div>
      {showToolbar && (
        <div
          data-testid="note-toolbar-anchor"
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            transform: `scale(${1 / (zoom > 0 ? zoom : 1)}) translate(0px, ${-NOTE_TOOLBAR_OFFSET}px)`,
            transformOrigin: '0 0',
            zIndex: 10,
          }}
        >
          <NoteToolbar color={note.color} onColor={handleColor} onDelete={handleDelete} />
        </div>
      )}
    </div>
  );
}
