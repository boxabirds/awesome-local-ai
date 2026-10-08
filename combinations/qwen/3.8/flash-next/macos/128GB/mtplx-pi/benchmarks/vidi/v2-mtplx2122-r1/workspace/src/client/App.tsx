import React, { useCallback, useEffect, useRef, useState } from 'react'
import { BoardViewport } from './canvas/BoardViewport'
import { ZoomControls } from './canvas/ZoomControls'
import { NavigationHint } from './canvas/NavigationHint'
import { useCamera, type WheelData } from './canvas/useCamera'
import { zoomPercent, canZoomIn, canZoomOut, screenToWorld, worldToScreen } from './canvas/camera'
import { useBoardDoc } from './board/useBoardDoc'
import { useSelection } from './board/useSelection'
import { ConnectionStatus } from './sync/ConnectionStatus'
import type { ProviderLike } from './sync/connectBoard'
import { Toolbar } from './board/Toolbar'
import { StickyNote } from './objects/StickyNote'
import { NoteToolbar } from './objects/NoteToolbar'
import { createSticky, deleteObject, setStickyColor, snapshot } from '../shared/board-model'
import { STICKY_SIZE_WORLD } from '../shared/config'
import type { StickyColor } from '../shared/config'
import type { Point } from './canvas/camera'

// ── viewport dimensions ───────────────────────────────────────────────────────

const INITIAL_VIEWPORT = { width: 1280, height: 800 }

/**
 * `window.__vidi6` is exposed in dev and in the e2e "test build"
 * (`VITE_VIDI6_TEST_HOOKS=1 npm run build`), never in a normal production
 * build.
 */
const TEST_HOOKS = import.meta.env.DEV || import.meta.env.VITE_VIDI6_TEST_HOOKS === '1'

// ── global test hook ──────────────────────────────────────────────────────────

declare global {
  // eslint-disable-next-line no-var
  var __vidi6:
    | {
        setCamera(cam: { x: number; y: number; zoom: number }): void
        /** Test helper: add a note at world (x, y) directly, bypassing UI. */
        createNote(x: number, y: number, color?: string): string
        /** Full board snapshot (id, position, colour, text) of this page. */
        snapshot(): Array<{ id: string; x: number; y: number; color: string; text: string }>
        /** Live-connection state of this page (story 3 e2e/nightly hooks). */
        readonly connectionState: string
      }
    | undefined
}

// ── App ───────────────────────────────────────────────────────────────────────

export interface AppProps {
  /** Board to sync with; `undefined` = local-only board (component tests). */
  boardId?: string
  /** Test seam for the sync provider. */
  providerFactory?: (boardId: string, doc: import('yjs').Doc) => ProviderLike
}

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

  // ── doc + notes ─────────────────────────────────────────────────────────────
  const { doc, notes, connectionState } = useBoardDoc(boardId, { providerFactory })

  // ── selection ───────────────────────────────────────────────────────────────
  const { selectedId, editingId, select, startEdit, endEdit } = useSelection()

  // ── drag state (which note is being dragged; null = none) ─────────────────
  const [draggingId, setDraggingId] = useState<string | null>(null)

  const handleDragStart = useCallback((id: string) => setDraggingId(id), [])
  const handleDragEnd  = useCallback((id: string) =>
    setDraggingId(prev => prev === id ? null : prev),
  [])

  // ── keyboard shortcuts on window ──────────────────────────────────────────
  const kbRef = useRef({ selectedId, editingId, doc, select, startEdit, endEdit })
  kbRef.current = { selectedId, editingId, doc, select, startEdit, endEdit }

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const { selectedId, editingId, doc, select, startEdit } = kbRef.current

      // Zoom shortcuts (ctrl/meta) – existing behaviour, unchanged.
      if (e.ctrlKey || e.metaKey) {
        if (e.key === '=' || e.key === '+') { e.preventDefault(); kbRef.current && (window as any).__zoomIn?.() }
        if (e.key === '-' || e.key === '_') { e.preventDefault(); (window as any).__zoomOut?.() }
        if (e.key === '0') { e.preventDefault(); (window as any).__zoomReset?.() }
        return
      }

      // Skip if focus is in a form element (textarea or input).
      const ae = document.activeElement
      if (ae && (ae.tagName === 'TEXTAREA' || ae.tagName === 'INPUT')) return

      // Skip while editing – keys go to the textarea.
      if (editingId) return

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
  }, []) // stable – uses kbRef

  // ── keyboard zoom (wired via effect so the window handler can reach zoomStep)
  const zoomStepRef = useRef(zoomStep)
  zoomStepRef.current = zoomStep
  const resetRef = useRef(reset)
  resetRef.current = reset

  useEffect(() => {
    const zoomIn = () => zoomStepRef.current('in')
    const zoomOut = () => zoomStepRef.current('out')
    const zoomReset = () => resetRef.current()
    ;(window as any).__zoomIn = zoomIn
    ;(window as any).__zoomOut = zoomOut
    ;(window as any).__zoomReset = zoomReset
    return () => {
      delete (window as any).__zoomIn
      delete (window as any).__zoomOut
      delete (window as any).__zoomReset
    }
  }, [])

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
          id: n.id,
          x: n.x,
          y: n.y,
          color: n.color,
          text: n.text,
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
  const handlePanMove  = useCallback((p: Point) => panMove(p), [panMove])
  const handleEndPan   = useCallback(() => endPan(), [endPan])
  const handleWheel    = useCallback((d: WheelData) => wheel(d), [wheel])
  const handleGesture  = useCallback((scale: number, point: Point) => {
    zoomAtPoint(point, scale)
  }, [zoomAtPoint])

  // ── Empty-space click → clear selection / end editing ─────────────────────
  // Keep latest selection state in a ref so the stable handler sees the right values.
  const selRef = useRef({ selectedId, editingId })
  selRef.current = { selectedId, editingId }
  const endEditRef = useRef(endEdit)
  endEditRef.current = endEdit
  const selectRef = useRef(select)
  selectRef.current = select

  const handleEmptyClick = useCallback((_p: Point) => {
    const { selectedId, editingId } = selRef.current
    if (editingId) {
      endEditRef.current('unselected')
    } else if (selectedId) {
      selectRef.current(null)
    }
  }, [])

  // ── Remote deletes clear stale selection / editing / drag ─────────────────
  // When somebody else deletes the note this screen has selected (or is
  // editing / dragging), the id is gone from the doc: drop the selection, close
  // the editor and end the drag instead of rendering a phantom note.
  useEffect(() => {
    const current = selRef.current
    if (!current.selectedId) return
    if (notes.some(n => n.id === current.selectedId)) return
    setDraggingId(null)
    selectRef.current(null)
  }, [notes])

  // ── Double-click on empty viewport → create a new sticky ──────────────────
  // Camera is needed to convert viewport-space point → world-space point.
  const cameraRef = useRef(camera)
  cameraRef.current = camera

  const startEditRef = useRef(startEdit)
  startEditRef.current = startEdit

  const handleViewportDblClick = useCallback((p: Point) => {
    const cam = cameraRef.current
    const worldPoint = screenToWorld(cam, p)
    const id = createSticky(doc, worldPoint)
    if (id) {
      selectRef.current(id)
      startEditRef.current(id)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc])

  // ── Toolbar create button ──────────────────────────────────────────────────
  const viewportSizeRef = useRef(viewportSize)
  viewportSizeRef.current = viewportSize

  const handleToolbarCreate = useCallback(() => {
    const { width, height } = viewportSizeRef.current
    const cam = cameraRef.current
    // World centre of the visible board area.
    const worldCenter = screenToWorld(cam, { x: width / 2, y: height / 2 })
    const id = createSticky(doc, worldCenter)
    if (id) {
      selectRef.current(id)
      startEditRef.current(id)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc])

  // ── NoteToolbar actions ─────────────────────────────────────────────────────
  const docForToolbar = doc

  const handleDelete = useCallback((id: string) => {
    deleteObject(doc, id)
    selectRef.current(null)
  }, [doc])

  // ── selected note lookup ────────────────────────────────────────────────────
  const selectedNote = selectedId ? notes.find(n => n.id === selectedId) : null

  // ── NoteToolbar screen position ─────────────────────────────────────────────
  const noteToolbarPos = selectedNote
    ? (() => {
        const screenTopLeft = worldToScreen(camera, { x: selectedNote.x, y: selectedNote.y })
        const noteScreenW = STICKY_SIZE_WORLD * camera.zoom
        return {
          left: screenTopLeft.x + noteScreenW / 2,
          top: screenTopLeft.y - 44,
        }
      })()
    : null

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
      >
        {/* Origin crosshair at world (0,0) – from story 1 */}
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

        {/* Grid dot landmarks – from story 1 */}
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
          />
        ))}
      </BoardViewport>

      {/* ── Left toolbar ── */}
      <Toolbar onCreateSticky={handleToolbarCreate} />

      {/* ── NoteToolbar: shown when a note is selected, not editing, not dragging ── */}
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
