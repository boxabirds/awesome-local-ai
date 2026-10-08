import React, { useCallback, useEffect, useRef } from 'react'
import * as Y from 'yjs'
import type { TextSnapshot } from '../../shared/objects/text'
import { getTextContent, setTextWidthFixed } from '../../shared/objects/text'
import { TEXT_SIZES, TEXT_LINE_HEIGHT, TEXT_FONT_FAMILY, DRAG_THRESHOLD_PX, TEXT_MIN_WIDTH_WORLD, TEXT_MAX_CHARS } from '../../shared/config'
import type { UndoController } from '../board/undo'
import { LOCAL_ORIGIN } from '../../shared/board-model'
import { applyTextDiff, clampToLimit } from '../../shared/text-edit'

// ── TextEditor ───────────────────────────────────────────────────────────────

export interface TextEditorProps {
  ytext: Y.Text
  maxChars: number
  fontPx: number
  width: number | 'auto'
  /** Called after a local text change has been applied to ytext. */
  onInput(): void
  onEnd(next: 'selected' | 'unselected'): void
  undo: UndoController
}

export function TextEditor({
  ytext,
  maxChars,
  fontPx,
  width,
  onInput,
  onEnd,
  undo,
}: TextEditorProps) {
  const taRef = useRef<HTMLTextAreaElement>(null)
  const composingRef = useRef(false)

  const onEndRef = useRef(onEnd)
  onEndRef.current = onEnd
  const onInputRef = useRef(onInput)
  onInputRef.current = onInput

  useEffect(() => {
    const ta = taRef.current
    if (!ta) return
    const initial = ytext.toString()
    ta.value = initial
    ta.focus()
    ta.setSelectionRange(initial.length, initial.length)
    // Start a new undo capture window at edit start
    undo.boundary()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const applyValue = useCallback(() => {
    const ta = taRef.current
    if (!ta) return
    const raw = ta.value
    const clamped = clampToLimit(raw, maxChars)
    if (clamped !== raw) {
      ta.value = clamped
      ta.setSelectionRange(clamped.length, clamped.length)
    }
    // Apply minimal diff to Y.Text using LOCAL_ORIGIN so undo works.
    applyTextDiff(ytext, clamped, LOCAL_ORIGIN)
    // Signal to caller to remeasure the box.
    onInputRef.current()
  }, [ytext, maxChars])

  const handleInput = useCallback(() => {
    if (composingRef.current) return
    applyValue()
  }, [applyValue])

  const handleCompositionEnd = useCallback(() => {
    composingRef.current = false
    applyValue()
  }, [applyValue])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      applyValue()
      onEndRef.current('selected')
    }
    // Enter inserts a newline in textarea; no special handling.
  }, [applyValue])

  const handleBlur = useCallback((e: React.FocusEvent<HTMLTextAreaElement>) => {
    const related = e.relatedTarget as HTMLElement | null
    if (related && taRef.current?.parentElement?.contains(related)) return
    applyValue()
    onEndRef.current('unselected')
  }, [applyValue])

  const widthStyle = width === 'auto' ? 'auto' : `${width}px`

  return (
    <textarea
      ref={taRef}
      data-testid="text-editor-textarea"
      aria-label="Text object content"
      style={{
        display: 'block',
        width: widthStyle,
        minWidth: widthStyle,
        minHeight: `${fontPx * TEXT_LINE_HEIGHT}px`,
        background: 'transparent',
        border: 'none',
        outline: 'none',
        resize: 'none',
        padding: 0,
        margin: 0,
        fontSize: `${fontPx}px`,
        lineHeight: String(TEXT_LINE_HEIGHT),
        fontFamily: TEXT_FONT_FAMILY,
        overflow: 'hidden',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}
      onInput={handleInput}
      onCompositionStart={() => { composingRef.current = true }}
      onCompositionEnd={handleCompositionEnd}
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
      onPointerDown={e => { e.stopPropagation() }}
    />
  )
}

// ── TextObject ───────────────────────────────────────────────────────────────

export interface TextObjectProps {
  textObj: TextSnapshot
  doc: Y.Doc
  zoom: number
  selected: boolean
  editing: boolean
  onSelect(id: string): void
  onStartEdit(id: string): void
  onEndEdit(next: 'selected' | 'unselected'): void
  onDragStart(id: string): void
  onDragEnd(id: string): void
  canEdit: boolean
  undo: UndoController
  remeasureAfterLocalChange(): void
}

export function TextObject({
  textObj,
  doc,
  zoom,
  selected,
  editing,
  onSelect,
  onStartEdit,
  onEndEdit,
  onDragStart,
  onDragEnd,
  canEdit,
  undo,
  remeasureAfterLocalChange,
}: TextObjectProps) {
  const id = textObj.id
  const fontPx = TEXT_SIZES[textObj.size]
  const displayWidth = textObj.width || undefined

  const cbRef = useRef({ onSelect, onStartEdit, onEndEdit, onDragStart, onDragEnd })
  cbRef.current = { onSelect, onStartEdit, onEndEdit, onDragStart, onDragEnd }

  // ── Drag ref ───────────────────────────────────────────────────────────────
  interface DragState {
    startObjX: number; startObjY: number
    startClientX: number; startClientY: number
    dragging: boolean
    pendingX: number; pendingY: number
    pendingRaf: number | null
  }
  const dragRef = useRef<DragState | null>(null)
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom

  useEffect(() => {
    function onPointerMove(e: PointerEvent) {
      const ds = dragRef.current
      if (!ds) return
      if (!ds.dragging) {
        const dx = Math.abs(e.clientX - ds.startClientX)
        const dy = Math.abs(e.clientY - ds.startClientY)
        if (dx < DRAG_THRESHOLD_PX && dy < DRAG_THRESHOLD_PX) return
        ds.dragging = true
        cbRef.current.onDragStart(id)
      }
      const z = zoomRef.current
      ds.pendingX = ds.startObjX + (e.clientX - ds.startClientX) / z
      ds.pendingY = ds.startObjY + (e.clientY - ds.startClientY) / z
      if (ds.pendingRaf === null) {
        ds.pendingRaf = requestAnimationFrame(() => {
          const d = dragRef.current
          if (!d || !d.dragging) return
          d.pendingRaf = null
          // Use moveObject from board-model
          const objectsMap = doc.getMap('objects') as Y.Map<Y.Map<unknown>>
          const ymap = objectsMap.get(id)
          if (!ymap) { dragRef.current = null; cbRef.current.onDragEnd(id); return }
          doc.transact(() => {
            ymap.set('x', d.pendingX)
            ymap.set('y', d.pendingY)
          }, LOCAL_ORIGIN)
        })
      }
    }

    function endDrag() {
      const ds = dragRef.current
      if (!ds) return
      if (ds.pendingRaf !== null) cancelAnimationFrame(ds.pendingRaf)
      dragRef.current = null
      cbRef.current.onDragEnd(id)
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, doc])

  // ── Side-handle resize ────────────────────────────────────────────────────
  const resizeRef = useRef<{
    startX: number; startWidth: number; side: 'left' | 'right'
  } | null>(null)

  function handleResizeMove(e: React.PointerEvent<HTMLDivElement>) {
    const r = resizeRef.current
    if (!r) return
    const z = zoomRef.current
    const dx = (e.clientX - r.startX) / z
    const newW = r.side === 'right' ? r.startWidth + dx : r.startWidth - dx
    const clamped = Math.max(TEXT_MIN_WIDTH_WORLD, newW)
    if (setTextWidthFixed(doc, id, clamped)) {
      // Remeasure height after rewrap
      remeasureAfterLocalChange()
    }
  }

  function handleResizeUp() {
    resizeRef.current = null
  }

  // ── Main pointer handlers ─────────────────────────────────────────────────
  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (editing) return
    e.stopPropagation()
    cbRef.current.onSelect(id)
    if (!canEdit) return
    dragRef.current = {
      startObjX: textObj.x,
      startObjY: textObj.y,
      startClientX: e.clientX,
      startClientY: e.clientY,
      dragging: false,
      pendingX: textObj.x,
      pendingY: textObj.y,
      pendingRaf: null,
    }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }

  function handleDblClick(e: React.MouseEvent<HTMLDivElement>) {
    e.stopPropagation()
    if (!editing && canEdit) cbRef.current.onStartEdit(id)
  }

  // ── Get Y.Text for editor ─────────────────────────────────────────────────
  const ytext = editing
    ? (doc.getMap('objects').get(id) as Y.Map<unknown> | undefined)?.get('text') as Y.Text | undefined
    : undefined

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div
      data-testid="text-object"
      data-obj-id={id}
      data-selected={selected ? 'true' : undefined}
      role="group"
      aria-label={textObj.text || 'Empty text'}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDblClick}
      style={{
        position: 'absolute',
        left: textObj.x,
        top: textObj.y,
        width: displayWidth,
        minHeight: fontPx * TEXT_LINE_HEIGHT,
        pointerEvents: 'auto',
        cursor: editing ? 'text' : 'default',
        outline: selected ? '2px solid #4285f4' : 'none',
        outlineOffset: 0,
        background: 'transparent',
        border: 'none',
        boxShadow: 'none',
        boxSizing: 'border-box',
      }}
    >
      {editing && ytext ? (
        <TextEditor
          key={id}
          ytext={ytext}
          maxChars={TEXT_MAX_CHARS}
          fontPx={fontPx}
          width={displayWidth ?? 'auto'}
          onInput={remeasureAfterLocalChange}
          onEnd={next => {
            cbRef.current.onEndEdit(next)
            // End undo capture window at edit end
            undo.boundary()
          }}
          undo={undo}
        />
      ) : (
        <div
          data-testid="text-display"
          style={{
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            fontSize: `${fontPx}px`,
            lineHeight: String(TEXT_LINE_HEIGHT),
            fontFamily: TEXT_FONT_FAMILY,
            overflow: 'hidden',
            color: 'inherit',
          }}
        >
          {textObj.text}
        </div>
      )}

      {/* Horizontal resize handles when selected but not editing */}
      {selected && !editing && (
        <>
          {/* Left handle */}
          <div
            data-testid="resize-w"
            onPointerDown={e => {
              e.stopPropagation()
              resizeRef.current = { startX: e.clientX, startWidth: textObj.width, side: 'left' }
            }}
            onPointerMove={handleResizeMove}
            onPointerUp={handleResizeUp}
            style={{
              position: 'absolute',
              left: -4, top: 0, bottom: 0, width: 8,
              cursor: 'ew-resize', pointerEvents: 'auto',
            }}
          />
          {/* Right handle */}
          <div
            data-testid="resize-e"
            onPointerDown={e => {
              e.stopPropagation()
              resizeRef.current = { startX: e.clientX, startWidth: textObj.width, side: 'right' }
            }}
            onPointerMove={handleResizeMove}
            onPointerUp={handleResizeUp}
            style={{
              position: 'absolute',
              right: -4, top: 0, bottom: 0, width: 8,
              cursor: 'ew-resize', pointerEvents: 'auto',
            }}
          />
        </>
      )}
    </div>
  )
}