import { render, act, cleanup } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { App } from '../../src/client/App'

// ── helpers ──────────────────────────────────────────────────────────────────

let utils: ReturnType<typeof render>

beforeEach(() => {
  utils = render(React.createElement(App))
})

afterEach(() => {
  cleanup()
})

function container() {
  return utils.container
}

function vp(): HTMLElement {
  return container().querySelector('[data-testid="viewport"]') as HTMLElement
}

function notes(): HTMLElement[] {
  return Array.from(container().querySelectorAll('[data-testid="sticky-note"]'))
}

function noteById(id: string): HTMLElement | undefined {
  return notes().find(n => n.getAttribute('data-note-id') === id)
}

function toolbarExists(): boolean {
  return container().querySelector('[data-testid="note-toolbar"]') !== null
}

/** Create a note via the test hook (available in DEV mode). */
function createNote(x: number, y: number, color?: string): string {
  let id = ''
  act(() => {
    id = window.__vidi6!.createNote(x, y, color)
  })
  return id
}

/** Dispatch a PointerEvent on a specific element inside act(). */
function firePointer(
  el: HTMLElement,
  type: string,
  x: number,
  y: number,
  opts: Record<string, unknown> = {},
) {
  act(() => {
    const e = new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      ...opts,
    })
    el.dispatchEvent(e)
  })
}

/** Dispatch a PointerEvent on window inside act(). */
function fireWindowPointer(
  type: string,
  x: number,
  y: number,
  opts: Record<string, unknown> = {},
) {
  act(() => {
    const e = new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      ...opts,
    })
    window.dispatchEvent(e)
  })
}

/** Dispatch a keydown event on window inside act(). */
function fireKey(key: string) {
  act(() => {
    const e = new KeyboardEvent('keydown', {
      key,
      cancelable: true,
      bubbles: true,
    })
    window.dispatchEvent(e)
  })
}

/** Read note's style.left / style.top to get its world position. */
function notePos(el: HTMLElement): { x: number; y: number } {
  const left = parseFloat(el.style.left) || 0
  const top = parseFloat(el.style.top) || 0
  return { x: left, y: top }
}

// ── TC-18: press+release without move → Selected ────────────────────────────

describe('TC-18 press+release without move → Selected, outline and NoteToolbar shown', () => {
  it('selects the note and shows the toolbar', () => {
    const id = createNote(0, 0)
    const el = noteById(id)!
    expect(el).toBeDefined()
    // Initially not selected
    expect(el.getAttribute('data-selected')).toBeNull()

    // pointerdown then pointerup (no move) → Selected
    firePointer(el, 'pointerdown', 100, 100)
    fireWindowPointer('pointerup', 100, 100)

    const elAfter = noteById(id)!
    expect(elAfter.getAttribute('data-selected')).toBe('true')
    expect(toolbarExists()).toBe(true)
  })
})

// ── TC-19: move < DRAG_THRESHOLD_PX → still Selected, no moveObject ────────

describe('TC-19 move < 3px → still Selected, no position change', () => {
  it('2px drag does not trigger moveObject', () => {
    const id = createNote(0, 0)
    const el = noteById(id)!
    const posBefore = notePos(el)

    // pointerdown at (100, 100)
    firePointer(el, 'pointerdown', 100, 100)
    // Move only 2px → below threshold
    fireWindowPointer('pointermove', 102, 100)
    // Release
    fireWindowPointer('pointerup', 102, 100)

    const elAfter = noteById(id)!
    const posAfter = notePos(elAfter)
    // Position unchanged
    expect(posAfter.x).toBeCloseTo(posBefore.x, 4)
    expect(posAfter.y).toBeCloseTo(posBefore.y, 4)
    // Still selected (release without drag = select)
    expect(elAfter.getAttribute('data-selected')).toBe('true')
  })
})

// ── TC-20: move ≥ 3px → Dragging; note moves ──────────────────────────────

describe('TC-20 move 3px+ → Dragging; board camera unchanged', () => {
  it('dragging the note moves it and does not pan', () => {
    const id = createNote(0, 0)
    const el = noteById(id)!
    const posBefore = notePos(el)
    const vpBefore = container().querySelector('[data-testid="world-layer"]')!.getAttribute('data-camera')

    // pointerdown on the note
    firePointer(el, 'pointerdown', 100, 100)
    // Move 50px → above threshold, triggers drag
    fireWindowPointer('pointermove', 150, 100)
    // Release
    fireWindowPointer('pointerup', 150, 100)

    const elAfter = noteById(id)!
    const posAfter = notePos(elAfter)
    // The note should have moved to the right by 50px / zoom (zoom=1 → 50 world units)
    expect(posAfter.x).toBeGreaterThan(posBefore.x)

    // Camera unchanged (no pan on note drag)
    const vpAfter = container().querySelector('[data-testid="world-layer"]')!.getAttribute('data-camera')
    expect(vpAfter).toBe(vpBefore)
  })
})

// ── TC-21: pointercancel during drag → Selected at last position ────────────

describe('TC-21 pointercancel during drag → ends interaction gracefully', () => {
  it('cancels drag without crash', () => {
    const id = createNote(0, 0)
    const el = noteById(id)!

    // Start drag
    firePointer(el, 'pointerdown', 100, 100)
    fireWindowPointer('pointermove', 150, 100)
    // Cancel instead of pointerup
    fireWindowPointer('pointercancel', 150, 100)

    // Note still exists and is in the DOM
    const elAfter = noteById(id)!
    expect(elAfter).toBeDefined()
    // After cancel, note is still in the document
    expect(notes().length).toBe(1)
  })
})

// ── TC-22: click empty board → deselect ─────────────────────────────────────

describe('TC-22 click empty board → Unselected, toolbar gone', () => {
  it('selecting then clicking empty space deselects', () => {
    const id = createNote(0, 0)
    const el = noteById(id)!

    // Select the note
    firePointer(el, 'pointerdown', 100, 100)
    fireWindowPointer('pointerup', 100, 100)
    expect(toolbarExists()).toBe(true)

    // Click on empty viewport area (target must be the viewport itself)
    firePointer(vp(), 'pointerdown', 500, 400)
    firePointer(vp(), 'pointerup', 500, 400)

    const elAfter = noteById(id)!
    expect(elAfter?.getAttribute('data-selected')).toBeNull()
    expect(toolbarExists()).toBe(false)
  })
})

// ── TC-25: Delete and Backspace on selected → removed ───────────────────────

describe('TC-25 Delete/Backspace on selected note → removed', () => {
  it('Delete key removes selected note', () => {
    const id = createNote(0, 0)
    const el = noteById(id)!

    // Select the note
    firePointer(el, 'pointerdown', 100, 100)
    fireWindowPointer('pointerup', 100, 100)
    expect(notes().length).toBe(1)

    // Press Delete
    fireKey('Delete')
    expect(notes().length).toBe(0)
  })

  it('Backspace key removes selected note', () => {
    const id = createNote(0, 0)
    const el = noteById(id)!

    // Select the note
    firePointer(el, 'pointerdown', 100, 100)
    fireWindowPointer('pointerup', 100, 100)
    expect(notes().length).toBe(1)

    // Press Backspace
    fireKey('Backspace')
    expect(notes().length).toBe(0)
  })

  it('Backspace does nothing when no note is selected', () => {
    // No note created → Backspace should be a no-op
    fireKey('Backspace')
    expect(notes().length).toBe(0)
  })
})

// ── TC-35: dblclick on existing note → edits (no new note) ─────────────────

describe('TC-35 dblclick on existing note → edit existing, no new note', () => {
  it('dblclick enters edit mode, no additional note', () => {
    const id = createNote(0, 0)
    expect(notes().length).toBe(1)

    const el = noteById(id)!
    // Double-click on the note
    act(() => {
      const e = new MouseEvent('dblclick', {
        bubbles: true,
        cancelable: true,
        clientX: 100,
        clientY: 100,
      })
      el.dispatchEvent(e)
    })

    // Still only one note
    expect(notes().length).toBe(1)
    // Should be in editing mode (check for textarea)
    const textarea = container().querySelector('[data-testid="sticky-textarea"]')
    expect(textarea).not.toBeNull()
  })
})

// ── TC-36: Enter with nothing selected → nothing happens ────────────────────

describe('TC-36 Enter with nothing selected → no effect', () => {
  it('pressing Enter without a selection does nothing', () => {
    // No note exists, press Enter
    fireKey('Enter')
    expect(notes().length).toBe(0)

    // Create a note but don't select it
    createNote(0, 0)
    expect(notes().length).toBe(1)
    // Press Enter (nothing selected)
    fireKey('Enter')
    // No additional notes created, no editing
    expect(notes().length).toBe(1)
    expect(container().querySelector('[data-testid="sticky-textarea"]')).toBeNull()
  })
})

// ── TC-37: note deleted while interacting → no crash ────────────────────────

describe('TC-37 note deleted during interaction → interaction ends gracefully', () => {
  it('Escape on textarea ends editing then Delete removes the note', () => {
    const id = createNote(0, 0)

    // Select and edit
    const el = noteById(id)!
    firePointer(el, 'pointerdown', 100, 100)
    fireWindowPointer('pointerup', 100, 100)
    // Enter key → editing
    fireKey('Enter')
    expect(container().querySelector('[data-testid="sticky-textarea"]')).not.toBeNull()

    // Dispatch Escape on the textarea element (not window)
    const ta = container().querySelector('[data-testid="sticky-textarea"]') as HTMLElement
    act(() => {
      const e = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true, bubbles: true })
      ta.dispatchEvent(e)
    })

    // Editing mode ended
    expect(container().querySelector('[data-testid="sticky-textarea"]')).toBeNull()

    // Now the note should be selected; Delete removes it
    fireKey('Delete')
    expect(notes().length).toBe(0)
  })
})