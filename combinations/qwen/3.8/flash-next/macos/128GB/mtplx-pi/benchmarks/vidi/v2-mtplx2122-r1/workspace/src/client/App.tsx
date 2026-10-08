import React, { useCallback, useEffect, useRef, useState } from 'react'
import * as Y from 'yjs'
import { BoardViewport } from './canvas/BoardViewport'
import { ZoomControls } from './canvas/ZoomControls'
import { NavigationHint } from './canvas/NavigationHint'
import { useCamera, type WheelData } from './canvas/useCamera'
import { zoomPercent, canZoomIn, canZoomOut, screenToWorld, worldToScreen } from './canvas/camera'
import { useBoardDoc } from './board/useBoardDoc'
import { useSelection } from './board/useSelection'
import { useTool } from './board/useTool'
import { ConnectionStatus } from './sync/ConnectionStatus'
import type { ProviderLike } from './sync/connectBoard'
import { Toolbar } from './board/Toolbar'
import { StickyNote } from './objects/StickyNote'
import { NoteToolbar } from './objects/NoteToolbar'
import { TextObject } from './objects/TextObject'
import { TextToolbar } from './objects/TextToolbar'
import { useTextBoxSync } from './objects/useTextBoxSync'
import { createCanvasMeasurer, layoutText } from './objects/textLayout'
import { createSticky, deleteObject, setStickyColor, snapshot } from '../shared/board-model'
import { createText, setTextSize } from '../shared/objects/text'
import { STICKY_SIZE_WORLD } from '../shared/config'
import { LOCAL_ORIGIN } from '../shared/board-model'
import type { TextSize } from '../shared/config'
import { createUndo, type UndoController } from './board/undo'
import type { Point } from './canvas/camera'
import type { TextSnapshot } from '../shared/objects/text'

// ── viewport dimensions ───────────────────────────────────────────────────────

const INITIAL_VIEWPORT = { width: 1280, height: 800 }

const TEST_HOOKS = import.meta.env.DEV || import.meta.env.VITE_VIDI6_TEST_HOOKS === '1'

// ── global test hook ──────────────────────────────────────────────────────────

declare global {
  // eslint-disable-next-line no-var
  var __vidi6:
    | {
        setCamera(cam: { x: number; y: number; zoom: number }): void
        createNote(x: number, y: number, color?: string): string
        snapshot(): Array<{ id: string; x: number; y: number; color: string; text: string }>
        readonly connectionState: string
      }
    | undefined
}

// ── App props ─────────────────────────────────────────────────────────────────

export interface AppProps {
  boardId?: string
  providerFactory?: (boardId: string, doc: Y.Doc) => ProviderLike
}

// ── Shared measure and remeasure registry ────────────────────────────────────

type Measurer = ReturnType<typeof createCanvasMeasurer>

// Module-level map: id → remeasureAfterLocalChange fn
// (cleared when App unmounts via useEffect cleanup)
const _remeasureFns = new Map<string, () => void>()

// ── TextObject wrapper ────────────────────────────────────────────────────────

interface TextObjectWrapperProps {
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
  measure: Measurer
}

function TextObjectWrapper({
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
  measure,
}: TextObjectWrapperProps) {
  const { remeasureAfterLocalChange } = useTextBoxSync(doc, textObj.id, measure)

  useEffect(() => {
    _remeasureFns.set(textObj.id, remeasureAfterLocalChange)
    return () => { _remeasureFns.delete(textObj.id) }
  }, [textObj.id, remeasureAfterLocalChange])

  return (
    <TextObject
      textObj={textObj}
      doc={doc}
      zoom={zoom}
      selected={selected}
      editing={editing}
      onSelect={onSelect}
      onStartEdit={onStartEdit}
      onEndEdit={onEndEdit}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      canEdit={canEdit}
      undo={undo}
      remeasureAfterLocalChange={remeasureAfterLocalChange}
    />
  )
}

// ── App ───────────────────────────────────────────────────────────────────────

export function App({ boardId, providerFactory }: AppProps = {}) {
  const [viewportSize, setViewportSize] = useState(INITIAL_VIEWPORT)

  const {
    camera,
    hasNavigated,
    beginPan,
    panMove,
    endPan,
    wheel,
    zoomAtPoint,
    zoomStep,
    reset,
    setCamera,
  } = useCamera(viewportSize)

  // ── doc + objects ─────────────────────────────────────────────────────────
  const { doc, notes, texts, connectionState } = useBoardDoc(boardId, { providerFactory })

  // ── undo controller ─────────────────────────────────────────────────────────
  const undoRef = useRef<UndoController | null>(null)
  if (undoRef.current === null) {
    undoRef.current = createUndo(doc)
  }
  const undo: UndoController = undoRef.current

  // ── canEdit: always true for now (no read-only boards in story 9) ─────────
  const canEdit = true

  // ── selection ───────────────────────────────────────────────────────────────
  const { selectedId, editingId, select, startEdit, endEdit } = useSelection()

  // ── tool mode ────────────────────────────────────────────────────────────────
  const { tool, setTool } = useTool(canEdit)

  // ── canvas measurer ─────────────────────────────────────────────────────────
  const measureRef = useRef<Measurer>(createCanvasMeasurer())
  const measure = measureRef.current

  // ── drag state ────────────────────────────────────────────────────────────
  const [draggingId, setDraggingId] = useState<string | null>(null)

  const handleDragStart = useCallback((id: string) => setDraggingId(id), [])
  const handleDragEnd = useCallback((id: string) =>
    setDraggingId(prev => prev === id ? null : prev),
  [])

  // ── selected lookups ────────────────────────────────────────────────────────
  const selectedText = selectedId ? texts.find(t => t.id === selectedId) : null
  const selectedNote = selectedId ? notes.find(n => n.id === selectedId) : null

  // ── keyboard shortcuts ──────────────────────────────────────────────────────
  const kbRef = useRef({
    selectedId, editingId, doc, select, startEdit, endEdit,
    tool, setTool, canEdit, viewportSize, camera,
  })
  kbRef.current = {
    selectedId, editingId, doc, select, startEdit, endEdit,
    tool, setTool, canEdit, viewportSize, camera,
  }

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const {
        selectedId, editingId, doc, select, startEdit,
        tool: curTool, setTool, canEdit, viewportSize, camera,
      } = kbRef.current

      // Ctrl/Meta zoom shortcuts
      if (e.ctrlKey || e.metaKey) {
        if (e.key === '=' || e.key === '+') {
          e.preventDefault()
          const zoomStepFn = (window as any).__zoomStepIn as (() => void) | undefined
          zoomStepFn?.()
        }
        if (e.key === '-' || e.key === '_') {
          e.preventDefault()
          const zoomStepFn = (window as any).__zoomStepOut as (() => void) | undefined
          zoomStepFn?.()
        }
        if (e.key === '0') {
          e.preventDefault()
          const resetFn = (window as any).__zoomReset as (() => void) | undefined
          resetFn?.()
        }
        return
      }

      // Skip if focus is in a textarea or input
      const ae = document.activeElement
      if (ae && (ae.tagName === 'TEXTAREA' || ae.tagName === 'INPUT')) return

      // Skip while editing (focus should be in editor textarea)
      if (editingId) return

      // T → Text tool
      if ((e.key === 't' || e.key === 'T') && canEdit) {
        e.preventDefault()
        setTool('text')
        return
      }

      // V → Select tool (always works)
      if (e.key === 'v' || e.key === 'V') {
        e.preventDefault()
        setTool('select')
        return
      }

      // N → Create sticky at viewport center
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault()
        const { width, height } = viewportSize
        const worldCenter = screenToWorld(camera, { x: width / 2, y: height / 2 })
        const id = createSticky(doc, worldCenter)
        if (id) { select(id); startEdit(id) }
        return
      }

      // Escape
      if (e.key === 'Escape') {
        if (curTool === 'text') { e.preventDefault(); setTool('select'); return }
        if (selectedId) { e.preventDefault(); select(null) }
        return
      }

      if (e.key === 'Enter' && selectedId) {
        e.preventDefault()
        startEdit(selectedId)
        return
      }

      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        e.preventDefault()
        deleteObject(doc, selectedId)
        select(null)
        return
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // ── Expose zoom functions for keyboard handler ─────────────────────────────
  useEffect(() => {
    ;(window as any).__zoomStepIn = () => zoomStep('in')
    ;(window as any).__zoomStepOut = () => zoomStep('out')
    ;(window as any).__zoomReset = () => reset()
    return () => {
      delete (window as any).__zoomStepIn
      delete (window as any).__zoomStepOut
      delete (window as any).__zoomReset
    }
  }, [zoomStep, reset])

  // ── Test hook ──────────────────────────────────────────────────────────────
  const setCameraRef = useRef(setCamera)
  setCameraRef.current = setCamera
  const docRef = useRef(doc)
  docRef.current = doc
  const connectionStateRef = useRef(connectionState)
  connectionStateRef.current = connectionState

  useEffect(() => {
    if (!TEST_HOOKS) return
    window.__vidi6 = {
      setCamera(cam: { x: number; y: number; zoom: number }) {
        setCameraRef.current(cam)
      },
      createNote(x: number, y: number, color?: string) {
        return createSticky(docRef.current, { x, y }, color as any)
      },
      snapshot() {
        return snapshot(docRef.current).map(n => ({
          id: n.id, x: n.x, y: n.y, color: n.color, text: n.text,
        }))
      },
      get connectionState() {
        return connectionStateRef.current
      },
    }
    return () => { delete window.__vidi6 }
  }, [])

  // ── Viewport size via ResizeObserver ───────────────────────────────────────
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const update = () => {
      const { width, height } = el.getBoundingClientRect()
      if (width > 0 && height > 0) {
        setViewportSize(s => s.width === width && s.height === height ? s : { width, height })
      }
    }
    update()
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(update)
      ro.observe(el)
      return () => ro.disconnect()
    }
  }, [])

  // ── Handlers ───────────────────────────────────────────────────────────────
  const handleBeginPan = useCallback((p: Point) => beginPan(p), [beginPan])
  const handlePanMove = useCallback((p: Point) => panMove(p), [panMove])
  const handleEndPan = useCallback(() => endPan(), [endPan])
  const handleWheel = useCallback((d: WheelData) => wheel(d), [wheel])
  const handleGesture = useCallback((scale: number, point: Point) => {
    zoomAtPoint(point, scale)
  }, [zoomAtPoint])

  // ── Empty-space click ─────────────────────────────────────────────────────
  const emptyClickRef = useRef({ selectedId, editingId, tool, camera, doc })
  emptyClickRef.current = { selectedId, editingId, tool, camera, doc }

  const handleEmptyClick = useCallback((p: Point) => {
    const { editingId, tool: curTool, camera: cam, doc: d } = emptyClickRef.current

    if (curTool === 'text') {
      // Create a text object at the click point.
      const worldPoint = screenToWorld(cam, p)
      const id = createText(d, worldPoint, LOCAL_ORIGIN)
      if (id) {
        selectRef.current(id)
        startEditRef.current(id)
      }
      setToolRef.current('select')
      return
    }

    if (editingId) {
      // If editing a text object and it's empty, delete it.
      const objectsMap = d.getMap('objects') as Y.Map<Y.Map<unknown>>
      const editObj = objectsMap.get(editingId)
      if (editObj && editObj.get('type') === 'text') {
        const ytext = editObj.get('text')
        if (ytext instanceof Y.Text && ytext.length === 0) {
          d.transact(() => {
            objectsMap.delete(editingId)
          }, LOCAL_ORIGIN)
        }
      }
      endEditRef.current('unselected')
    } else if (selectedId) {
      selectRef.current(null)
    }
  }, [])

  const selectRef = useRef(select)
  selectRef.current = select
  const endEditRef = useRef(endEdit)
  endEditRef.current = endEdit
  const startEditRef = useRef(startEdit)
  startEditRef.current = startEdit
  const setToolRef = useRef(setTool)
  setToolRef.current = setTool

  // ── Remote deletes clear stale selection/editing/drag ─────────────────────
  const prevObjectsRef = useRef<{ notes: string[]; texts: string[] }>({ notes: [], texts: [] })
  useEffect(() => {
    const { selectedId: selId } = emptyClickRef.current
    if (!selId) return
    const allIds = [...notes.map(n => n.id), ...texts.map(t => t.id)]
    if (allIds.includes(selId)) return
    setDraggingId(null)
    selectRef.current(null)
  }, [notes, texts])

  // ── Double-click on empty viewport → create sticky (select mode only) ──────
  const cameraRef = useRef(camera)
  cameraRef.current = camera

  const handleViewportDblClick = useCallback((p: Point) => {
    const { tool: curTool } = emptyClickRef.current
    if (curTool === 'text') return
    const cam = cameraRef.current
    const worldPoint = screenToWorld(cam, p)
    const id = createSticky(doc, worldPoint)
    if (id) {
      selectRef.current(id)
      startEditRef.current(id)
    }
  }, [doc])

  // ── Toolbar create button ──────────────────────────────────────────────────
  const viewportSizeRef = useRef(viewportSize)
  viewportSizeRef.current = viewportSize

  const handleToolbarCreate = useCallback(() => {
    const { width, height } = viewportSizeRef.current
    const cam = cameraRef.current
    const worldCenter = screenToWorld(cam, { x: width / 2, y: height / 2 })
    const id = createSticky(doc, worldCenter)
    if (id) {
      selectRef.current(id)
      startEditRef.current(id)
    }
  }, [doc])

  // ── Delete handlers ─────────────────────────────────────────────────────────
  const handleDelete = useCallback((id: string) => {
    deleteObject(doc, id)
    selectRef.current(null)
  }, [doc])

  // ── NoteToolbar pos ─────────────────────────────────────────────────────────
  const noteToolbarPos = selectedNote
    ? (() => {
        const screenTopLeft = worldToScreen(camera, { x: selectedNote.x, y: selectedNote.y })
        const noteScreenW = STICKY_SIZE_WORLD * camera.zoom
        return { left: screenTopLeft.x + noteScreenW / 2, top: screenTopLeft.y - 44 }
      })()
    : null

  // ── TextToolbar pos ─────────────────────────────────────────────────────────
  const textToolbarPos = selectedText && !editingId
    ? (() => {
        const screenTopLeft = worldToScreen(camera, { x: selectedText.x, y: selectedText.y })
        const w = (selectedText.width || 100) * camera.zoom
        return { left: screenTopLeft.x + w / 2, top: screenTopLeft.y - 38 }
      })()
    : null

  // ── Viewport cursor for tool mode ──────────────────────────────────────────
  const viewportCursor = tool === 'text' ? 'text' : undefined

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div
      ref={rootRef}
      data-testid="app-root"
      style={{ width: '100%', height: '100%', position: 'relative' }}
    >
      <BoardViewport
        camera={camera}
        onBeginPan={handleBeginPan}
        onPanMove={handlePanMove}
        onEndPan={handleEndPan}
        onEmptyClick={handleEmptyClick}
        onDoubleClick={handleViewportDblClick}
        onWheel={handleWheel}
        onGesture={handleGesture}
        cursor={viewportCursor}
        toolMode={tool === 'text'}
      >
        {/* Origin crosshair */}
        <div
          data-testid="origin-marker"
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: -6, top: -6, width: 12, height: 12,
            pointerEvents: 'none',
          }}
        >
          <div style={{ position: 'absolute', left: 0, top: 5, width: 12, height: 2, background: 'rgba(255,0,0,0.7)' }} />
          <div style={{ position: 'absolute', left: 5, top: 0, width: 2, height: 12, background: 'rgba(255,0,0,0.7)' }} />
        </div>

        {/* Grid dots */}
        {Array.from({ length: 5 }, (_, k) => (
          <div
            key={k}
            data-testid={`grid-dot-${k}`}
            aria-hidden="true"
            style={{
              position: 'absolute',
              left: (k + 1) * 40 - 3, top: -3,
              width: 6, height: 6,
              borderRadius: '50%',
              background: 'rgba(0,0,255,0.5)',
              pointerEvents: 'none',
            }}
          />
        ))}

        {/* Sticky notes */}
        {notes.map(note => (
          <StickyNote
            key={note.id}
            note={note}
            doc={doc}
            zoom={camera.zoom}
            selected={note.id === selectedId}
            editing={note.id === editingId}
            onSelect={id => selectRef.current(id)}
            onStartEdit={id => startEditRef.current(id)}
            onEndEdit={next => endEditRef.current(next)}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            canEdit={canEdit}
            undo={undo}
          />
        ))}

        {/* Text objects */}
        {texts.map(textObj => (
          <TextObjectWrapper
            key={textObj.id}
            textObj={textObj}
            doc={doc}
            zoom={camera.zoom}
            selected={textObj.id === selectedId}
            editing={textObj.id === editingId}
            onSelect={id => selectRef.current(id)}
            onStartEdit={id => startEditRef.current(id)}
            onEndEdit={next => {
              // Check if text object is now empty → delete it.
              const objectsMap = doc.getMap('objects') as Y.Map<Y.Map<unknown>>
              const ymap = objectsMap.get(textObj.id)
              if (ymap && ymap.get('type') === 'text') {
                const ytext = ymap.get('text')
                if (ytext instanceof Y.Text && ytext.length === 0) {
                  doc.transact(() => { objectsMap.delete(textObj.id) }, LOCAL_ORIGIN)
                }
              }
              endEditRef.current(next)
            }}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            canEdit={canEdit}
            undo={undo}
            measure={measure}
          />
        ))}
      </BoardViewport>

      {/* ── Left toolbar ── */}
      <Toolbar
        tool={tool}
        setTool={setTool}
        canEdit={canEdit}
        onCreateSticky={handleToolbarCreate}
      />

      {/* ── NoteToolbar (stickies) ── */}
      {selectedNote && !editingId && !draggingId && noteToolbarPos && (
        <div
          data-testid="note-toolbar-wrapper"
          style={{
            position: 'absolute',
            left: noteToolbarPos.left,
            top: noteToolbarPos.top,
            transform: 'translateX(-50%)',
            zIndex: 20,
            pointerEvents: 'none',
          }}
        >
          <NoteToolbar
            color={selectedNote.color}
            onColor={c => setStickyColor(doc, selectedNote.id, c)}
            onDelete={() => handleDelete(selectedNote.id)}
          />
        </div>
      )}

      {/* ── TextToolbar (text objects) ── */}
      {selectedText && !editingId && !draggingId && textToolbarPos && (
        <div
          data-testid="text-toolbar-wrapper"
          style={{
            position: 'absolute',
            left: textToolbarPos.left,
            top: textToolbarPos.top,
            transform: 'translateX(-50%)',
            zIndex: 20,
            pointerEvents: 'none',
          }}
        >
          <TextToolbar
            size={selectedText.size}
            onSize={s => {
              setTextSize(doc, selectedText.id, s)
              // Remeasure after size change.
              const remeasure = _remeasureFns.get(selectedText.id)
              if (remeasure) remeasure()
            }}
            onDelete={() => handleDelete(selectedText.id)}
          />
        </div>
      )}

      {/* ── Zoom + Navigation UI ── */}
      <ZoomControls
        zoomPercent={zoomPercent(camera)}
        canZoomIn={canZoomIn(camera)}
        canZoomOut={canZoomOut(camera)}
        onZoomIn={() => zoomStep('in')}
        onZoomOut={() => zoomStep('out')}
        onReset={reset}
      />
      <NavigationHint visible={!hasNavigated} />
      <ConnectionStatus state={connectionState} />
    </div>
  )
}

export default App
