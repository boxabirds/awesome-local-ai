import React from 'react'
import { STICKY_COLORS } from '../../shared/config'
import type { StickyColor } from '../../shared/config'

export interface NoteToolbarProps {
  color: StickyColor
  onColor(c: StickyColor): void
  onDelete(): void
}

const COLOR_NAMES = Object.keys(STICKY_COLORS) as StickyColor[]

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function NoteToolbar({ color, onColor, onDelete }: NoteToolbarProps) {
  function handlePointerDown(e: React.PointerEvent) {
    // Prevent the viewport from seeing this as a click on empty space.
    e.stopPropagation()
  }

  return (
    <div
      data-testid="note-toolbar"
      role="toolbar"
      aria-label="Note toolbar"
      onPointerDown={handlePointerDown}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '4px 6px',
        background: 'rgba(255,255,255,0.95)',
        border: '1px solid rgba(0,0,0,0.15)',
        borderRadius: 6,
        boxShadow: '0 1px 4px rgba(0,0,0,0.18)',
        pointerEvents: 'auto',
      }}
    >
      {COLOR_NAMES.map(c => {
        const pressed = c === color
        return (
          <button
            key={c}
            data-testid={`color-swatch-${c}`}
            aria-label={`${capitalize(c)} colour`}
            aria-pressed={pressed}
            onClick={() => onColor(c)}
            style={{
              width: 20,
              height: 20,
              borderRadius: '50%',
              border: pressed ? '2px solid #333' : '1px solid rgba(0,0,0,0.2)',
              background: STICKY_COLORS[c],
              cursor: 'pointer',
              padding: 0,
              outline: 'none',
            }}
          />
        )
      })}
      <div style={{ width: 1, height: 20, background: 'rgba(0,0,0,0.15)', margin: '0 2px' }} />
      <button
        data-testid="delete-note-btn"
        aria-label="Delete note"
        onClick={onDelete}
        style={{
          width: 24,
          height: 20,
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          padding: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 14,
          lineHeight: 1,
          color: '#666',
          outline: 'none',
        }}
      >
        🗑
      </button>
    </div>
  )
}
