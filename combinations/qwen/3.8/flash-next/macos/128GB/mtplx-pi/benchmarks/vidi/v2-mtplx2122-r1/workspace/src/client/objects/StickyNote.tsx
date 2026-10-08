import React, { useLayoutEffect, useRef } from 'react'
import * as Y from 'yjs'
import type { StickySnapshot } from '../../shared/board-model'
import { bringToFront, moveObject } from '../../shared/board-model'
import { STICKY_SIZE_WORLD, STICKY_COLORS, STICKY_FONT_MAX_PX, DRAG_THRESHOLD_PX } from '../../shared/config'
import { fitFontSize } from './StickyText'
import { StickyTextEditor } from './StickyTextEditor'

// ── props ─────────────────────────────────────────────────────────────────────

export interface StickyNoteProps {
  note: StickySnapshot
  doc: Y.Doc
  zoom: number
  selected: boolean
  editing: boolean
  onSelect(id: string): void
  onStartEdit(id: string): void
  onEndEdit(next: 'selected' | 'unselected'): void
  onDragStart(id: string): void
  onDragEnd(id: string): void
}

// ── internal drag state shape ─────────────────────────────────────────────────

interface DragState {
  startNoteX: number
  startNoteY: number
  startClientX: number
  startClientY: number
  dragging: boolean
  pendingX: number
  pendingY: number
  pendingRaf: number | null
}

// ── helper: euclidean distance ────────────────────────────────────────────────

function dist(x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1
  const dy = y2 - y1
  return Math.sqrt(dx * dx + dy * dy)
}

// ── component ─────────────────────────────────────────────────────────────────

export function StickyNote(props: StickyNoteProps) {
  const { note, doc, selected, editing } = props
  const noteId = note.id
  const box = STICKY_SIZE_WORLD - 16 // inner padding area

  // Keep latest values in refs so stable window-level listeners stay fresh
  // without needing to re-register on every render.
  const zoomRef = useRef(props.zoom)
  zoomRef.current = props.zoom

  const cbRef = useRef(props)
  cbRef.current = props

  // ── drag ref ────────────────────────────────────────────────────────────────

  const dragRef = useRef<DragState | null>(null)

  // ── font sizing + overflow ──────────────────────────────────────────────────

  const [fontPx, setFontPx] = React.useState(STICKY_FONT_MAX_PX)
  const [overflow, setOverflow] = React.useState(false)
  const measRef = useRef<HTMLDivElement>(null)

  // Re-measure whenever the display-mode text changes (not during editing,
  // which is handled inside StickyTextEditor).
  useLayoutEffect(() => {
    if (editing) return
    const el = measRef.current
    if (!el) return
    const { fontPx: fp, overflow: of } = fitFontSize(el, box)
    setFontPx(prev => prev === fp ? prev : fp)
    setOverflow(prev => prev === of ? prev : of)
  }, [note.text, editing, box])

  // ── window-level drag listeners (mounted once per note) ───────────────────

  React.useEffect(() => {
    function onPointerMove(e: PointerEvent) {
      const ds = dragRef.current
      if (!ds) return

      if (!ds.dragging) {
        if (dist(ds.startClientX, ds.startClientY, e.clientX, e.clientY) < DRAG_THRESHOLD_PX) return
        // Crossed threshold: enter Dragging.
        ds.dragging = true
        bringToFront(doc, noteId)
        cbRef.current.onDragStart(noteId)
      }

      const z = zoomRef.current
      ds.pendingX = ds.startNoteX + (e.clientX - ds.startClientX) / z
      ds.pendingY = ds.startNoteY + (e.clientY - ds.startClientY) / z

      if (ds.pendingRaf === null) {
        ds.pendingRaf = requestAnimationFrame(() => {
          const d = dragRef.current
          if (!d || !d.dragging) return
          d.pendingRaf = null
          const ok = moveObject(doc, noteId, d.pendingX, d.pendingY)
          if (!ok) {
            // Note deleted mid-drag: end interaction silently.
            dragRef.current = null
            cbRef.current.onDragEnd(noteId)
          }
        })
      }
    }

    function endDrag() {
      const ds = dragRef.current
      if (!ds) return
      if (ds.pendingRaf !== null) {
        cancelAnimationFrame(ds.pendingRaf)
        ds.pendingRaf = null
      }
      dragRef.current = null
      cbRef.current.onDragEnd(noteId)
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', endDrag)
    window.addEventListener('pointercancel', endDrag)
    window.addEventListener('lostpointercapture', endDrag)

    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', endDrag)
      window.removeEventListener('pointercancel', endDrag)
      window.removeEventListener('lostpointercapture', endDrag)
    }
  // Stable for the lifetime of a note: noteId and doc never change for the same key.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId, doc])

  // ── pointer handlers on the note itself ────────────────────────────────────

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    // While editing, let pointer events reach the textarea for text selection.
    if (editing) return

    // Stop propagation so the viewport never sees this pointer event
    // (prevents it from starting a pan).
    e.stopPropagation()

    // Select this note.
    cbRef.current.onSelect(noteId)

    // Initialize drag tracking.
    dragRef.current = {
      startNoteX: note.x,
      startNoteY: note.y,
      startClientX: e.clientX,
      startClientY: e.clientY,
      dragging: false,
      pendingX: note.x,
      pendingY: note.y,
      pendingRaf: null,
    }

    // Pointer capture (no-op in jsdom).  In a real browser it redirects
    // subsequent pointermove/pointerup events to this element.
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }

  function handleDblClick(e: React.MouseEvent<HTMLDivElement>) {
    e.stopPropagation()
    if (!editing) {
      cbRef.current.onStartEdit(noteId)
    }
  }

  // ── get Y.Text for the editor ──────────────────────────────────────────────

  const ytext = editing
    ? (doc.getMap('objects').get(noteId) as Y.Map<unknown> | undefined)?.get('text') as Y.Text | undefined
    : undefined

  const bgColor = STICKY_COLORS[note.color] ?? STICKY_COLORS['yellow']

  return (
    <div
      data-testid="sticky-note"
      data-note-id={note.id}
      data-selected={selected ? 'true' : undefined}
      role="group"
      aria-label="Sticky note"
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDblClick}
      style={{
        position: 'absolute',
        left: note.x,
        top: note.y,
        width: STICKY_SIZE_WORLD,
        height: STICKY_SIZE_WORLD,
        backgroundColor: bgColor,
        padding: 8,
        boxSizing: 'border-box',
        overflow: 'hidden',
        pointerEvents: 'auto',
        cursor: editing ? 'text' : 'default',
        outline: selected ? '2px solid #4285f4' : 'none',
        outlineOffset: 0,
      }}
    >
      {editing && ytext ? (
        <StickyTextEditor
          key={noteId}
          ytext={ytext}
          fontPx={fontPx}
          box={box}
          onEnd={next => cbRef.current.onEndEdit(next)}
        />
      ) : (
        <div
          data-testid="sticky-text-display"
          style={{
            width: '100%',
            height: '100%',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            fontSize: fontPx + 'px',
            lineHeight: 1.25,
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          {/* Hidden measurement div so fitFontSize can read scrollHeight
              without constraining the visible layout height. */}
          <div
            ref={measRef}
            aria-hidden="true"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '1000px',
              overflow: 'hidden',
              visibility: 'hidden',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              fontSize: fontPx + 'px',
              lineHeight: 1.25,
              pointerEvents: 'none',
            }}
          >
            {note.text || '\u00A0'}
          </div>
          {/* Visible text */}
          {note.text}
          {overflow && (
            <div
              data-testid="overflow-fade"
              style={{
                position: 'absolute',
                bottom: 0,
                left: 0,
                right: 0,
                height: 20,
                background: `linear-gradient(to bottom, transparent, ${bgColor})`,
                pointerEvents: 'none',
              }}
            />
          )}
        </div>
      )}
    </div>
  )
}
