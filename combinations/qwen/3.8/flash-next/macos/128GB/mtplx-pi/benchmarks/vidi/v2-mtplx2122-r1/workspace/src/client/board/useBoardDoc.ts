import { useRef, useSyncExternalStore } from 'react'
import * as Y from 'yjs'
import { initDoc, snapshot, type StickySnapshot } from '../../shared/board-model'

export interface UseBoardDocResult {
  doc: Y.Doc
  notes: readonly StickySnapshot[]
}

export function useBoardDoc(): UseBoardDocResult {
  // Create (or reuse) the one Y.Doc for this component lifetime.
  const docRef = useRef<Y.Doc | null>(null)
  if (docRef.current === null) {
    const d = new Y.Doc()
    initDoc(d)
    docRef.current = d
  }
  const doc = docRef.current

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

  return { doc, notes }
}
