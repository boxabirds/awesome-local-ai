import { useCallback, useRef, useSyncExternalStore } from 'react'

export interface SelectionState {
  selectedId: string | null
  editingId: string | null
}

export interface UseSelectionResult {
  selectedId: string | null
  editingId: string | null
  select(id: string | null): void
  startEdit(id: string): void
  endEdit(next: 'selected' | 'unselected'): void
}

export function useSelection(): UseSelectionResult {
  // ── immutable snapshot so useSyncExternalStore can detect changes ──────────
  const stateRef = useRef<SelectionState>({ selectedId: null, editingId: null })
  const listenersRef = useRef<Set<() => void>>(new Set())

  const emit = useCallback(() => {
    listenersRef.current.forEach(cb => cb())
  }, [])

  const select = useCallback((id: string | null) => {
    const next: SelectionState = { selectedId: id, editingId: null }
    if (stateRef.current.selectedId === next.selectedId &&
        stateRef.current.editingId === next.editingId) return
    stateRef.current = next
    emit()
  }, [emit])

  const startEdit = useCallback((id: string) => {
    const next: SelectionState = { selectedId: id, editingId: id }
    if (stateRef.current.selectedId === next.selectedId &&
        stateRef.current.editingId === next.editingId) return
    stateRef.current = next
    emit()
  }, [emit])

  const endEdit = useCallback((next: 'selected' | 'unselected') => {
    const cur = stateRef.current
    const next2: SelectionState = next === 'selected'
      ? { selectedId: cur.selectedId, editingId: null }
      : { selectedId: null, editingId: null }
    if (cur.selectedId === next2.selectedId && cur.editingId === next2.editingId) return
    stateRef.current = next2
    emit()
  }, [emit])

  // ── stable subscribe (same function identity every render) ─────────────────
  const subscribeRef = useRef((cb: () => void) => {
    listenersRef.current.add(cb)
    return () => { listenersRef.current.delete(cb) }
  })

  const getSnapshotRef = useRef<() => SelectionState>(() => stateRef.current)

  const state = useSyncExternalStore(
    subscribeRef.current,
    getSnapshotRef.current,
    getSnapshotRef.current,
  )

  return { selectedId: state.selectedId, editingId: state.editingId, select, startEdit, endEdit }
}
