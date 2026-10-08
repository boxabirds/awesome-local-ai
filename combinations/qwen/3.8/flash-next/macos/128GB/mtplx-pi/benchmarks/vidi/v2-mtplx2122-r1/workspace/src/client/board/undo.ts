import * as Y from 'yjs'
import { LOCAL_ORIGIN } from '../../shared/board-model'
import { UNDO_CAPTURE_TIMEOUT_MS, UNDO_MAX_STEPS } from '../../shared/config'

/**
 * Per-person undo history for one board document.
 *
 * Wraps a `Y.UndoManager` scoped to the objects map that tracks only this
 * tab's own transactions (`LOCAL_ORIGIN`).  Remote updates (applied with the
 * provider origin) and story 4 load updates (applied with the LOAD origin) are
 * never captured, so undoing here only ever reverses this person's own changes.
 */
export interface UndoController {
  /** Reverse the last own step; `false` when the undo stack is empty. */
  undo(): boolean
  /** Re-apply the last undone step; `false` when the redo stack is empty. */
  redo(): boolean
  /** Close the current capture window (a new step starts after this). */
  boundary(): void
  canUndo(): boolean
  canRedo(): boolean
  /** Extend the tracked scope (story 16 adds `comments` here). */
  addScope(type: Y.AbstractType<unknown>): void
  /** Subscribe to stack-state changes; returns an unsubscribe function. */
  onChange(cb: () => void): () => void
  /** Tear the manager down; a fresh controller afterwards starts empty. */
  destroy(): void

  // ── test seams (used by the undo unit/component tests) ──────────────────
  /** Live length of the undo stack (for history-length boundary tests). */
  undoStackLength(): number
  /** Live length of the redo stack. */
  redoStackLength(): number
}

export interface CreateUndoOptions {
  captureTimeoutMs?: number
  maxSteps?: number
}

/**
 * Build a {@link UndoController} over `doc`'s objects map.
 *
 * @param doc the board document
 * @param opts.captureTimeoutMs merge window for typing bursts (default
 *   {@link UNDO_CAPTURE_TIMEOUT_MS}); transactions inside one window collapse
 *   into a single undo step.
 * @param opts.maxSteps most recent undo steps kept (default
 *   {@link UNDO_MAX_STEPS}); older steps are dropped from the front.
 */
export function createUndo(
  doc: Y.Doc,
  opts: CreateUndoOptions = {},
): UndoController {
  const captureTimeout = opts.captureTimeoutMs ?? UNDO_CAPTURE_TIMEOUT_MS
  const maxSteps = opts.maxSteps ?? UNDO_MAX_STEPS

  const objects = doc.getMap('objects') as Y.Map<Y.Map<unknown>>

  // Only this tab's own transactions enter the stacks. The UndoManager adds
  // itself to `trackedOrigins` internally so its own inverse transactions
  // route to the redo stack instead of being re-captured.
  const manager = new Y.UndoManager(objects, {
    trackedOrigins: new Set<unknown>([LOCAL_ORIGIN]),
    captureTimeout,
  })

  const listeners = new Set<() => void>()
  const emit = () => listeners.forEach(cb => cb())

  // Trim the undo stack from the front whenever a new step is pushed past the
  // limit (undo.limit). `stack-item-added` only fires for a brand-new stack
  // item, not for merges into the current window, which is exactly what we
  // want: a burst of typing counts as one step and trims only once.
  const handleStackChanged = () => {
    while (manager.undoStack.length > maxSteps) {
      manager.undoStack.shift()
    }
    emit()
  }

  const STACK_EVENTS = [
    'stack-item-added',
    'stack-item-popped',
    'stack-item-updated',
    'stack-cleared',
  ] as const
  STACK_EVENTS.forEach(evt => manager.on(evt, handleStackChanged))

  return {
    undo() {
      return manager.undo() != null
    },
    redo() {
      return manager.redo() != null
    },
    boundary() {
      manager.stopCapturing()
    },
    canUndo() {
      return manager.canUndo()
    },
    canRedo() {
      return manager.canRedo()
    },
    addScope(type: Y.AbstractType<unknown>) {
      manager.addToScope(type as Y.AbstractType<any>)
    },
    onChange(cb: () => void) {
      listeners.add(cb)
      return () => {
        listeners.delete(cb)
      }
    },
    destroy() {
      listeners.clear()
      manager.destroy()
    },
    undoStackLength() {
      return manager.undoStack.length
    },
    redoStackLength() {
      return manager.redoStack.length
    },
  }
}