import React, { useRef, useCallback, useEffect, useState } from 'react';
import * as Y from 'yjs';
import type { StickySnapshot } from '@shared/board-model';
import {
  STICKY_SIZE_WORLD,
  STICKY_COLORS,
  STICKY_FONT_MIN_PX,
  STICKY_FONT_MAX_PX,
  STICKY_TEXT_MAX_CHARS,
  STICKY_COUNTER_THRESHOLD_CHARS,
  DRAG_THRESHOLD_PX,
} from '@shared/config';
import { bringToFront, moveObject } from '@shared/board-model';
import { fitFontSize } from './StickyText';

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

type InteractionState = 'unselected' | 'pressed' | 'selected' | 'dragging' | 'editing';

export function StickyNote({
  note,
  doc,
  zoom,
  selected,
  editing,
  onSelect,
  onStartEdit,
  onEndEdit,
}: StickyNoteProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [interaction, setInteraction] = useState<InteractionState>('unselected');

  const pressRef = useRef<{ x: number; y: number } | null>(null);
  const draggingIdRef = useRef<string | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastWorldRef = useRef<{ x: number; y: number } | null>(null);

  const fontPxRef = useRef<number>(STICKY_FONT_MAX_PX);
  const overflowRef = useRef<boolean>(false);
  const measureRef = useRef<HTMLSpanElement>(null);

  // Update font size on mount and text change
  useEffect(() => {
    if (!measureRef.current || !ref.current) return;
    measureRef.current.style.width = `${STICKY_SIZE_WORLD}px`;
    const result = fitFontSize(measureRef.current!, STICKY_SIZE_WORLD);
    fontPxRef.current = result.fontPx;
    overflowRef.current = result.overflow;
    ref.current.style.setProperty('--font-size', `${result.fontPx}px`);
    ref.current.style.setProperty('--overflow', result.overflow ? '1' : '0');
  }, [note.text]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.stopPropagation();
      if (e.button !== 0) return;

      // Verify click target is within this note
      const el = e.currentTarget as HTMLElement;
      if (!el.contains(e.target as Node)) return;

      pressRef.current = { x: e.clientX, y: e.clientY };
      lastWorldRef.current = { x: note.x, y: note.y };
      draggingIdRef.current = note.id;
      setInteraction('pressed');

      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // no-op
      }
    },
    [note.id, note.x, note.y],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (pressRef.current === null || draggingIdRef.current === null) return;

      const dx = e.clientX - pressRef.current.x;
      const dy = e.clientY - pressRef.current.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist >= DRAG_THRESHOLD_PX && interaction !== 'dragging') {
        setInteraction('dragging');
        bringToFront(doc, note.id);
      }

      if (interaction === 'dragging') {
        const worldDeltaX = dx / zoom;
        const worldDeltaY = dy / zoom;
        const newX = (lastWorldRef.current?.x ?? note.x) + worldDeltaX;
        const newY = (lastWorldRef.current?.y ?? note.y) + worldDeltaY;

        if (rafRef.current) return;
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = null;
          if (lastWorldRef.current) {
            moveObject(doc, note.id, newX, newY);
            lastWorldRef.current = { x: newX, y: newY };
          }
        });
      }
    },
    [interaction, doc, note.id, note.x, note.y, zoom],
  );

  const handlePointerUp = useCallback(() => {
    if (interaction === 'pressed') {
      onSelect(note.id);
      setInteraction('selected');
    } else if (interaction === 'dragging') {
      pressRef.current = null;
      draggingIdRef.current = null;
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      lastWorldRef.current = null;
      setInteraction('selected');
    }
  }, [interaction, note.id, onSelect]);

  const handlePointerCancel = useCallback(() => {
    pressRef.current = null;
    draggingIdRef.current = null;
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    lastWorldRef.current = null;
    setInteraction('selected');
  }, []);

  const handleDblClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.stopPropagation();
      onStartEdit(note.id);
      setInteraction('editing');
    },
    [note.id, onStartEdit],
  );

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
        width: `${STICKY_SIZE_WORLD}px`,
        height: `${STICKY_SIZE_WORLD}px`,
        transform: `translate(${note.x}px, ${note.y}px)`,
        background: STICKY_COLORS[note.color],
        borderRadius: 4,
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        border: selected ? '2px solid #2196F3' : 'none',
        outline: 'none',
        zIndex: Math.round(note.z),
        boxSizing: 'border-box',
        cursor: interaction === 'dragging' ? 'grabbing' : 'default',
        overflow: 'hidden',
      }}
      data-selected={selected ? '' : undefined}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onLostPointerCapture={handlePointerCancel}
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
          width: `${STICKY_SIZE_WORLD}px`,
        }}
      >
        {note.text || '\u200B'}
      </span>

      {editing ? (
        <>
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
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
          />
          {/* Character counter visible when within threshold of limit */}
          {(function Counter() {
            const len = note.text.length;
            if (len < STICKY_TEXT_MAX_CHARS - STICKY_COUNTER_THRESHOLD_CHARS) return null;
            return (
              <div
                style={{
                  position: 'absolute',
                  bottom: 2,
                  right: 4,
                  fontSize: '9px',
                  color: '#888',
                  pointerEvents: 'none',
                }}
              >
                {len}/{STICKY_TEXT_MAX_CHARS}
              </div>
            );
          })()}
        </>
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
          {selected && (
            <div
              style={{
                position: 'absolute',
                bottom: -8,
                left: '50%',
                transform: 'translateX(-50%)',
              }}
            >
              <div
                style={{
                  width: 0,
                  height: 0,
                  borderLeft: '6px solid transparent',
                  borderRight: '6px solid transparent',
                  borderBottom: '6px solid #fff',
                }}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
