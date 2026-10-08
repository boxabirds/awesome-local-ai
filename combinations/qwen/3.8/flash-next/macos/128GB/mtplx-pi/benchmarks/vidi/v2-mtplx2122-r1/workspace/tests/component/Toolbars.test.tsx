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

function notes(): HTMLElement[] {
  return Array.from(container().querySelectorAll('[data-testid="sticky-note"]'))
}

function noteById(id: string): HTMLElement | undefined {
  return notes().find(n => n.getAttribute('data-note-id') === id)
}

function createNote(x: number, y: number, color?: string): string {
  let id = ''
  act(() => {
    id = window.__vidi6!.createNote(x, y, color)
  })
  return id
}

function firePointer(
  el: HTMLElement,
  type: string,
  x: number,
  y: number,
) {
  act(() => {
    const e = new PointerEvent(type, {
      bubbles: true, cancelable: true, clientX: x, clientY: y,
      pointerId: 1, pointerType: 'mouse', isPrimary: true,
    })
    el.dispatchEvent(e)
  })
}

function fireWindowPointer(type: string, x: number, y: number) {
  act(() => {
    const e = new PointerEvent(type, {
      bubbles: true, cancelable: true, clientX: x, clientY: y,
      pointerId: 1, pointerType: 'mouse', isPrimary: true,
    })
    window.dispatchEvent(e)
  })
}

function fireKey(key: string) {
  act(() => {
    const e = new KeyboardEvent('keydown', { key, cancelable: true, bubbles: true })
    window.dispatchEvent(e)
  })
}

function selectNote(id: string) {
  const el = noteById(id)!
  firePointer(el, 'pointerdown', 100, 100)
  fireWindowPointer('pointerup', 100, 100)
}

function selectAndEdit(id: string) {
  selectNote(id)
  fireKey('Enter')
}

function getTextarea(): HTMLTextAreaElement | null {
  return container().querySelector('[data-testid="sticky-textarea"]') as HTMLTextAreaElement | null
}

// ── TC-27: Pink swatch → model colour pink, selection kept ──────────────────

describe('TC-27 colour swatch changes colour and keeps selection', () => {
  it('clicking Pink swatch changes the note background', () => {
    const id = createNote(0, 0)
    selectNote(id)

    // NoteToolbar should be visible
    const toolbar = container().querySelector('[data-testid="note-toolbar"]')
    expect(toolbar).not.toBeNull()

    // Find the pink swatch button
    const pinkBtn = container().querySelector('[data-testid="color-swatch-pink"]') as HTMLButtonElement
    expect(pinkBtn).not.toBeNull()

    // Click it
    act(() => {
      pinkBtn.click()
    })

    // The note should still be present (selection kept)
    expect(notes().length).toBe(1)

    // The background colour should have changed (no longer yellow)
    const el = noteById(id)!
    expect(el.style.backgroundColor).not.toBe('rgb(255, 245, 157)')
  })

  it('swatch click does not clear selection (toolbar stays)', () => {
    const id = createNote(0, 0)
    selectNote(id)

    const pinkBtn = container().querySelector('[data-testid="color-swatch-pink"]') as HTMLButtonElement
    act(() => {
      pinkBtn.click()
    })

    // Toolbar still visible (selection kept)
    expect(container().querySelector('[data-testid="note-toolbar"]')).not.toBeNull()
  })

  it('Blue swatch works too', () => {
    const id = createNote(0, 0)
    selectNote(id)

    const blueBtn = container().querySelector('[data-testid="color-swatch-blue"]') as HTMLButtonElement
    expect(blueBtn).not.toBeNull()
    act(() => {
      blueBtn.click()
    })

    const el = noteById(id)!
    expect(el.style.backgroundColor).toBe('rgb(144, 202, 249)')
  })
})

// ── TC-28: Sticky note button → one note centred, Editing ──────────────────

describe('TC-28 Sticky note button creates a note in editing mode', () => {
  it('clicking the create button adds a note and enters edit mode', () => {
    expect(notes().length).toBe(0)

    const createBtn = container().querySelector('[data-testid="create-sticky-btn"]') as HTMLButtonElement
    expect(createBtn).not.toBeNull()

    act(() => {
      createBtn.click()
    })

    // One note created
    expect(notes().length).toBe(1)
    // In editing mode
    expect(getTextarea()).not.toBeNull()
  })
})

// ── TC-29: bin button → note removed, selection cleared ─────────────────────

describe('TC-29 Delete button on NoteToolbar removes the note', () => {
  it('clicking bin button removes the selected note', () => {
    const id = createNote(0, 0)
    selectNote(id)

    // Toolbar is shown
    const toolbar = container().querySelector('[data-testid="note-toolbar"]')
    expect(toolbar).not.toBeNull()

    // Click delete
    const deleteBtn = container().querySelector('[data-testid="delete-note-btn"]') as HTMLButtonElement
    expect(deleteBtn).not.toBeNull()
    act(() => {
      deleteBtn.click()
    })

    // Note gone
    expect(notes().length).toBe(0)
    // Toolbar gone
    expect(container().querySelector('[data-testid="note-toolbar"]')).toBeNull()
  })
})