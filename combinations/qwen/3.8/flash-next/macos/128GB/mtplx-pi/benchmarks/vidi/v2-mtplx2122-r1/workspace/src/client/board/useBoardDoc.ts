import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import * as Y from 'yjs'
import { initDoc, snapshot, type StickySnapshot } from '../../shared/board-model'
import { connectBoard, type ConnectionState, type ProviderLike } from '../sync/connectBoard'

export interface UseBoardDocResult {
  doc: Y.Doc
  notes: readonly StickySnapshot[]
  /** Live-connection state; `'connected'` when the board is offline-only. */
  connectionState: ConnectionState
}

export interface UseBoardDocOptions {
  /** Test seam: build the sync provider instead of a real `WebsocketProvider`. */
  providerFactory?: (boardId: string, doc: Y.Doc) => ProviderLike
}

export function useBoardDoc(
  boardId?: string,
  options: UseBoardDocOptions = {},
): UseBoardDocResult {
  // Create (or reuse) the one Y.Doc for this component lifetime.
  const docRef = useRef<Y.Doc | null>(null)
  if (docRef.current === null) {
    const d = new Y.Doc()
    initDoc(d)
    docRef.current = d
  }
  const doc = docRef.current

  // ── live connection ────────────────────────────────────────────────────────
  // No board id (component tests, `?offline`) → no provider at all, and the
  // badge stays hidden.
  const [connectionState, setConnectionState] = useState<ConnectionState>(
    boardId ? 'connecting' : 'connected',
  )
  const providerFactory = options.providerFactory
  useEffect(() => {
    if (!boardId) return
    const provider = providerFactory ? providerFactory(boardId, doc) : undefined
    const connection = connectBoard(doc, boardId, setConnectionState, { provider })
    return () => {
      connection.destroy()
    }
  }, [doc, boardId, providerFactory])

  // Snapshot cache — recomputed whenever the objects map fires an event.
  // We use a fresh object wrapper so identity changes exactly when the doc
  // content changes, which is what useSyncExternalStore expects.
  const cacheRef = useRef<{ snap: readonly StickySnapshot[] }>({ snap: snapshot(doc) })
  const listenersRef = useRef<Set<() => void> | null>(null)
  if (listenersRef.current === null) {
    listenersRef.current = new Set()
  }
  const listeners = listenersRef.current

  // Wire up the Yjs observer once, on the very first render.
  const wiredRef = useRef(false)
  if (!wiredRef.current) {
    wiredRef.current = true
    const objectsMap = doc.getMap('objects') as Y.Map<Y.Map<unknown>>
    objectsMap.observeDeep(() => {
      cacheRef.current = { snap: snapshot(doc) }
      listeners.forEach(cb => cb())
    })
  }

  // Stable subscribe — the Set reference never changes.
  const subscribe = (cb: () => void): (() => void) => {
    listeners.add(cb)
    return () => { listeners.delete(cb) }
  }

  const getSnapshot = (): readonly StickySnapshot[] => cacheRef.current.snap

  const notes = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  return { doc, notes, connectionState }
}
