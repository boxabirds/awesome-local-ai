import React, { useRef, useEffect, useCallback } from 'react';
import * as Y from 'yjs';
import type { StickySnapshot } from '@shared/board-model';
import {
  STICKY_SIZE_WORLD,
  STICKY_COLORS,
  STICKY_FONT_MIN_PX,
  STICKY_FONT_MAX_PX,
  STICKY_TEXT_MAX_CHARS,
  STICKY_COUNTER_THRESHOLD_CHARS,
} from '@shared/config';
import { fitFontSize } from './StickyText';
import { getObjectType } from '../objects/registry';
import { StickyTextEditor } from './StickyTextEditor';
import type { Handle } from '@shared/geometry';
import type { Point } from '../canvas/camera';
import { objectBounds } from '@shared/board-model';

interface StickyNoteProps {
  note: StickySnapshot;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  onSelect(id: string, shiftKey?: boolean): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
  onObjectPointerDown?(e: PointerEvent, id: string): void;
  onHandlePointerDown?(e: PointerEvent, handle: Handle): void;
  // Story 8: undo integration
  onUndoBoundary?(): void;
  onUndo?(): boolean;
  onRedo?(): boolean;
  onColorChange?(id: string, color: string): void;
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
  onObjectPointerDown,
  onHandlePointerDown,
  onUndoBoundary,
  onUndo,
  onRedo,
  onColorChange,
}: StickyNoteProps) {
  const ref = useRef<HTMLDivElement>(null);

  const fontPxRef = useRef<number>(STICKY_FONT_MAX_PX);
  const overflowRef = useRef<boolean>(false);
  const measureRef = useRef<HTMLSpanElement>(null);

  // Get width/height for rendering
  const w = note.width ?? STICKY_SIZE_WORLD;
  const h = note.height ?? STICKY_SIZE_WORLD;

  // Update font size on mount and text change
  useEffect(() => {
    if (!measureRef.current || !ref.current) return;
    measureRef.current.style.width = `${w}px`;
    const result = fitFontSize(measureRef.current!, w);
    fontPxRef.current = result.fontPx;
    overflowRef.current = result.overflow;
    ref.current.style.setProperty('--font-size', `${result.fontPx}px`);
    ref.current.style.setProperty('--overflow', result.overflow ? '1' : '0');
  }, [note.text, w]);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    
    // Let the transform gesture handle this if callback is provided
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

  // Get the Y.Text for this sticky's content
  const ytext = (() => {
    try {
      const objects = (doc as any).getMap('objects');
      const dataMap = objects.get(note.id);
      if (dataMap instanceof Y.Map) {
        const val = dataMap.get('text');
        return val instanceof Y.Text ? val : undefined;
      }
    } catch { /* ignore */ }
    return undefined;
  })();

  return (
    <div
      data-sticky-id={note.id}
      ref={ref}
      role="group"
      aria-label="Sticky note"
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: `${w}px`,
        height: `${h}px`,
        transform: `translate(${note.x}px, ${note.y}px)`,
        background: STICKY_COLORS[note.color],
        borderRadius: 4,
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
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
      {/* Measurement element */}
      <span
        ref={measureRef}
        style={{
          position: 'absolute',
          visibility: 'hidden',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          padding: '16px',
          fontFamily: 'sans-serif',
          lineHeight: 1.25,
          width: `${w}px`,
        }}
      >
        {note.text || '\u200B'}
      </span>

      {editing && ytext ? (
        <StickyTextEditor
          ytext={ytext}
          fontPx={fontPxRef.current}
          onEnd={onEndEdit}
          onUndoBoundary={onUndoBoundary ?? (() => {})}
          onUndo={() => { onUndo?.(); return true; }}
          onRedo={() => { onRedo?.(); return true; }}
        />
      ) : editing ? (
        // Fallback: Y.Text not available — render raw textarea
        <textarea
          style={{
            width: '100%',
            height: '100%',
            border: 'none',
            outline: 'none',
            resize: 'none',
            background: 'transparent',
            fontFamily: 'sans-serif',
            fontSize: `${fontPxRef.current}px`,
            lineHeight: 1.25,
            padding: '16px',
            textAlign: 'center',
            color: '#333',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            overflow: 'hidden',
            cursor: 'text',
            userSelect: 'text',
            boxSizing: 'border-box',
          }}
          defaultValue={note.text}
          autoFocus
          onBlur={() => onEndEdit('selected')}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
        />
      ) : (
        <>
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '16px',
              boxSizing: 'border-box',
              fontSize: `var(--font-size, ${STICKY_FONT_MAX_PX}px)`,
              fontFamily: 'sans-serif',
              lineHeight: 1.25,
              color: '#333',
              textAlign: 'center',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              overflow: 'hidden',
              position: 'relative',
            }}
          >
            {note.text}
            {overflowRef.current && (
              <div
                style={{
                  position: 'absolute',
                  bottom: 0,
                  left: 0,
                  right: 0,
                  height: '40px',
                  background:
                    'linear-gradient(transparent, transparent 50%, rgba(0,0,0,0.08) 100%)',
                  pointerEvents: 'none',
                }}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}
