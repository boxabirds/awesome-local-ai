import { useCallback, useEffect, useRef, useState } from 'react'
import type { ShapeKind } from '../../shared/config'

/**
 * The tool set shared by the whiteboard tools (stories 9-12). Only a subset is
 * implemented today (Select, Sticky, Text, Shape, Connector); the rest are
 * reserved so the shortcut table matches the cross-story convention.
 */
export type ToolId =
  | 'select'
  | 'sticky'
  | 'text'
  | 'shape'
  | 'connector'
  | 'pen'
  | 'image'
  | 'comment'

/** Single-letter shortcuts (lower-case key → tool). */
export const TOOL_SHORTCUTS: Record<string, ToolId> = {
  v: 'select',
  n: 'sticky',
  t: 'text',
  s: 'shape',
  l: 'connector',
  p: 'pen',
  i: 'image',
  c: 'comment',
}

/** Tools that create content and return to Select once they finish. */
export const CREATING_TOOLS: ReadonlySet<ToolId> = new Set<ToolId>([
  'shape',
  'connector',
])

export function isTypingTarget(el: Element | null): boolean {
  if (!el) return false
  const tag = el.tagName
  if (tag === 'TEXTAREA' || tag === 'INPUT') return true
  return (el as HTMLElement).isContentEditable === true
}

export interface ActiveToolState {
  tool: ToolId
  shapeKind: ShapeKind
  setTool(t: ToolId): void
  setShapeKind(k: ShapeKind): void
  /** Record that a creating tool produced `id`: select it and return to Select. */
  toolCreated(id: string): void
  /** Read the current tool without re-subscribing (for event handlers). */
  getTool(): ToolId
  /** Read the current shape kind (for the Shape tool's drag). */
  getShapeKind(): ShapeKind
}

export interface UseActiveToolOptions {
  /** Only these tools may be entered; others are ignored (read-only boards). */
  canEdit?: boolean
  /** Called by {@link ActiveToolState.toolCreated} to select the new object. */
  select?: (id: string | null) => void
  /** Install window keydown listeners (default true). Off in isolated tests
   *  that drive the returned API directly. */
  keyboard?: boolean
}

/**
 * Active-tool state for the board: the current tool + shape kind, keyboard
 * shortcuts (ignored while typing), Escape → Select, and return-to-Select after
 * a creating tool finishes. Nothing here is persisted.
 */
export function useActiveTool(options: UseActiveToolOptions = {}): ActiveToolState {
  const { canEdit = true, select } = options
  const installKeyboard = options.keyboard ?? true

  const [tool, setToolState] = useState<ToolId>('select')
  const [shapeKind, setShapeKindState] = useState<ShapeKind>('rect')

  // Mirror the latest tool so the (mount-once) keydown handler and event
  // callbacks never read a stale value.
  const toolRef = useRef<ToolId>(tool)
  toolRef.current = tool
  const kindRef = useRef<ShapeKind>(shapeKind)
  kindRef.current = shapeKind
  const canEditRef = useRef(canEdit)
  canEditRef.current = canEdit
  const selectRef = useRef(select)
  selectRef.current = select

  const setTool = useCallback((t: ToolId) => {
    // A creating tool must be able to come back to Select even on a read-only
    // board; only *entering* an editing tool is gated.
    if (!canEditRef.current && t !== 'select') return
    if (toolRef.current === t) return
    toolRef.current = t
    setToolState(t)
  }, [])

  const setShapeKind = useCallback((k: ShapeKind) => {
    if (kindRef.current === k) return
    kindRef.current = k
    setShapeKindState(k)
  }, [])

  const getTool = useCallback(() => toolRef.current, [])
  const getShapeKind = useCallback(() => kindRef.current, [])

  const toolCreated = useCallback((id: string) => {
    selectRef.current?.(id)
    toolRef.current = 'select'
    setToolState('select')
  }, [])

  useEffect(() => {
    if (!installKeyboard) return
    const handler = (e: KeyboardEvent) => {
      if (isTypingTarget(document.activeElement)) return

      if (e.key === 'Escape') {
        if (toolRef.current !== 'select') {
          e.preventDefault()
          toolRef.current = 'select'
          setToolState('select')
        }
        return
      }

      const t = TOOL_SHORTCUTS[e.key.toLowerCase()]
      if (!t) return
      // Guard editing-only tools behind canEdit.
      if (t !== 'select' && !canEditRef.current) return
      e.preventDefault()
      setTool(t)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [installKeyboard, setTool])

  return { tool, shapeKind, setTool, setShapeKind, toolCreated, getTool, getShapeKind }
}