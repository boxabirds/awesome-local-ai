import React, { useRef, useEffect, useCallback } from 'react';
import * as Y from 'yjs';
import type { TextSnapshot } from '@shared/objects/text';
import { TEXT_SIZES } from '@shared/config';
import { TextEditor } from './TextEditor';
import type { Handle } from '@shared/geometry';
import type { Point } from '../canvas/camera';

interface TextObjectProps {
  note: TextSnapshot;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  onSelect(id: string, shiftKey?: boolean): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
  onObjectPointerDown?(e: PointerEvent, id: string): void;
  onHandlePointerDown?(e: PointerEvent, handle: Handle): void;
  onSizeChange?(id: string, size: string): void;
  onDelete?(id: string): void;
  onUndoBoundary?(): void;
  onUndo?(): boolean;
  onRedo?(): boolean;
}

export function TextObject({
  note,
  doc,
  zoom,
  selected,
  editing,
  onSelect,
  onStartEdit,
  onEndEdit,
  onObjectPointerDown,
  onHandlePointerDown,
}: TextObjectProps) {
  const ref = useRef<HTMLDivElement>(null);
  const ytextRef = useRef<Y.Text | undefined>(undefined);

  // Get the Y.Text for this text object's content
  useEffect(() => {
    try {
      const objects = (doc as any).getMap('objects');
      const dataMap = objects.get(note.id);
      if (dataMap instanceof Y.Map) {
        const val = dataMap.get('text');
        ytextRef.current = val instanceof Y.Text ? val : undefined;
      }
    } catch { /* ignore */ }
  }, [doc, note.id]);

  const fontPx = TEXT_SIZES[note.size] * zoom;

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (e.button !== 0) return;

    if (onObjectPointerDown && !editing) {
      onObjectPointerDown(e.nativeEvent, note.id);
      return;
    }

    onSelect(note.id, !!e.nativeEvent.shiftKey);
  };

  const handleDblClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.stopPropagation();
      onStartEdit(note.id);
    },
    [note.id, onStartEdit],
  );

  const w = note.width ?? 90;
  const h = note.height ?? 26;

  return (
    <div
      data-text-id={note.id}
      ref={ref}
      role="group"
      aria-label={`Text: ${note.text || '(empty)'}`}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: `${w}px`,
        height: `${h}px`,
        transform: `translate(${note.x}px, ${note.y}px)`,
        background: 'transparent',
        border: selected ? '1px solid #2196F3' : 'none',
        outline: 'none',
        zIndex: Math.round(note.z),
        boxSizing: 'border-box',
        overflow: 'hidden',
        pointerEvents: 'auto',
        cursor: editing ? 'text' : 'default',
      }}
      data-selected={selected ? '' : undefined}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDblClick}
    >
      {editing && ytextRef.current ? (
        <TextEditor
          ytext={ytextRef.current}
          fontPx={fontPx}
          width={w}
          onInput={() => {}}
          onEnd={onEndEdit}
          onUndoBoundary={() => {}}
          onUndo={() => false}
          onRedo={() => false}
        />
      ) : (
        <div
          style={{
            width: '100%',
            height: '100%',
            fontSize: `${TEXT_SIZES[note.size]}px`,
            fontFamily: 'Inter, system-ui, sans-serif',
            lineHeight: '1.3',
            color: '#222',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            padding: 4,
            boxSizing: 'border-box',
            pointerEvents: 'none',
            userSelect: 'none',
          }}
        >
          {note.text || '\u200B'}
        </div>
      )}
    </div>
  );
}
