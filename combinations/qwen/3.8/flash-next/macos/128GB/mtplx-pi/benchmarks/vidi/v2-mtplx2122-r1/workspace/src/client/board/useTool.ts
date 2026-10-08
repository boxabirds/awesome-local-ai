import { useCallback, useRef, useSyncExternalStore } from 'react'

/**
 * Active tool. Stories 10-12 will add their own tools.
 */
export type Tool = 'select' | 'text'

export interface UseToolResult {
  tool: Tool
  setTool(t: Tool): void
}

/**
 * Per-client tool mode (not persisted in Y.Doc).
 *
 * `canEdit` gates whether the Text tool can be activated; if `canEdit`
 * becomes false while Text is active, the tool reverts to Select.
 */
export function useTool(canEdit: boolean): UseToolResult {
  const toolRef = useRef<Tool>('select')
  const listenersRef = useRef<Set<() => void>>(new Set())

  const emit = useCallback(() => {
    listenersRef.current.forEach(cb => cb())
  }, [])

  const setTool = useCallback((t: Tool) => {
    if (t === 'text' && !canEdit) return
    if (toolRef.current === t) return
    toolRef.current = t
    emit()
  }, [emit, canEdit])

  // Stable subscribe
  const subscribeRef = useRef((cb: () => void) => {
    listenersRef.current.add(cb)
    return () => { listenersRef.current.delete(cb) }
  })

  const getSnapshotRef = useRef<() => Tool>(() => toolRef.current)

  const tool = useSyncExternalStore(
    subscribeRef.current,
    getSnapshotRef.current,
    getSnapshotRef.current,
  )

  return { tool, setTool }
}