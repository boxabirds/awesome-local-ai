import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import * as Y from 'yjs'
import { initDoc, snapshot, type StickySnapshot } from '../../shared/board-model'
import { snapshotText, type TextSnapshot } from '../../shared/objects/text'
import { connectBoard, type ConnectionState, type ProviderLike } from '../sync/connectBoard'

export interface UseBoardDocResult {
  doc: Y.Doc
  notes: readonly StickySnapshot[]
  texts: readonly TextSnapshot[]
  /** Live-connection state; `'connected'` when the board is offline-only. */
  connectionState: ConnectionState
}

export interface UseBoardDocOptions {
  /** Test seam: build the sync provider instead of a real `WebsocketProvider`. */
  providerFactory?: (boardId: string, doc: Y.Doc) => ProviderLike
}

interface BoardSnap {
  notes: readonly StickySnapshot[]
  texts: readonly TextSnapshot[]
}

export function useBoardDoc(
  boardId?: string,
  options: UseBoardDocOptions = {},
): UseBoardDocResult {
  const docRef = useRef<Y.Doc | null>(null)
  if (docRef.current === null) {
    const d = new Y.Doc()
    initDoc(d)
    docRef.current = d
  }
  const doc = docRef.current

  const [connectionState, setConnectionState] = useState<ConnectionState>(
    boardId ? 'connecting' : 'connected',
  )
  const providerFactory = options.providerFactory
  useEffect(() => {
    if (!boardId) return
    const provider = providerFactory ? providerFactory(boardId, doc) : undefined
    const connection = connectBoard(doc, boardId, setConnectionState, { provider })
    return () => { connection.destroy() }
  }, [doc, boardId, providerFactory])

  // ── Snapshot cache (both notes and texts) ─────────────────────────────────
  const cacheRef = useRef<BoardSnap>({ notes: snapshot(doc), texts: snapshotText(doc) })
  const listenersRef = useRef<Set<() => void> | null>(null)
  if (listenersRef.current === null) {
    listenersRef.current = new Set()
  }
  const listeners = listenersRef.current

  const wiredRef = useRef(false)
  if (!wiredRef.current) {
    wiredRef.current = true
    const objectsMap = doc.getMap('objects') as Y.Map<Y.Map<unknown>>
    objectsMap.observeDeep(() => {
      cacheRef.current = { notes: snapshot(doc), texts: snapshotText(doc) }
      listeners.forEach(cb => cb())
    })
  }

  const subscribe = (cb: () => void): (() => void) => {
    listeners.add(cb)
    return () => { listeners.delete(cb) }
  }

  const getSnapshot = (): BoardSnap => cacheRef.current

  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  return { doc, notes: snap.notes, texts: snap.texts, connectionState }
}