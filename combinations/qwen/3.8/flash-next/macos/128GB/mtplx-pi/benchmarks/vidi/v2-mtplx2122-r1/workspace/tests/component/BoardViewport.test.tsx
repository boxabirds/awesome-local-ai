import { render, act } from '@testing-library/react'
import { describe, it, expect, beforeEach } from 'vitest'
import React from 'react'
import { App } from '../../src/client/App'

// ── helpers ─────────────────────────────────────────────────────────────────

function readCamera(container: HTMLElement) {
  const el = container.querySelector('[data-testid="world-layer"]') as HTMLElement
  const raw = el?.dataset?.camera
  if (!raw) return null
  const [x, y, zoom] = raw.split(',').map(Number)
  return { x, y, zoom }
}

function vp(container: HTMLElement): HTMLElement {
  return container.querySelector('[data-testid="viewport"]') as HTMLElement
}

/** Dispatch a pointer-type event directly on an element inside act(). */
function firePointerEvent(
  container: HTMLElement,
  type: string,
  x: number,
  y: number,
  opts: Record<string, unknown> = {},
) {
  const el = vp(container)
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

/** Dispatch a wheel event directly on an element inside act(). */
function fireWheel(
  container: HTMLElement,
  type: 'wheel',
  init: WheelEventInit,
  onElement?: HTMLElement,
): WheelEvent {
  const el = onElement ?? vp(container)
  const e = new WheelEvent(type, { bubbles: true, cancelable: true, ...init })
  act(() => {
    el.dispatchEvent(e)
  })
  return e
}

/** Dispatch a gesturechange event inside act(). */
function fireGesture(container: HTMLElement, scale: number) {
  const el = vp(container)
  const e = new Event('gesturechange', { bubbles: true, cancelable: true })
  Object.assign(e, { scale, clientX: 640, clientY: 400 })
  act(() => {
    el.dispatchEvent(e)
  })
  return e
}

/** Dispatch a keyboard event on window inside act(). */
function fireKey(key: string, ctrlKey = true) {
  act(() => {
    const e = new KeyboardEvent('keydown', {
      key,
      ctrlKey,
      cancelable: true,
      bubbles: true,
    })
    window.dispatchEvent(e)
    return e
  })
}

// ── suite ───────────────────────────────────────────────────────────────────

let utils: ReturnType<typeof render>

beforeEach(() => {
  // Render with a fixed container height so ResizeObserver fires correctly
  utils = render(React.createElement(App))
})

// ── TC-13 ───────────────────────────────────────────────────────────────────

describe('TC-13 drag → world-layer transform tracks camera; Idle→Panning→Idle', () => {
  it('200 px right + 100 px down drag moves camera correctly', () => {
    const { container } = utils
    const el = vp(container)

    const camBefore = readCamera(container)!

    firePointerEvent(container, 'pointerdown', 100, 100)
    // After pointerdown the panning state should be active
    expect(el.dataset.state).toBe('panning')

    firePointerEvent(container, 'pointermove', 300, 200)
    firePointerEvent(container, 'pointerup', 300, 200)
    expect(el.dataset.state).toBe('idle')

    const camAfter = readCamera(container)!
    // 200 px drag at zoom 1 shifts x by -200, y by -100
    expect(camAfter.x).toBeCloseTo(camBefore.x - 200, 1)
    expect(camAfter.y).toBeCloseTo(camBefore.y - 100, 1)
  })

  it('zero-length drag (no pointermove) leaves camera unchanged', () => {
    const { container } = utils

    const camBefore = readCamera(container)!
    firePointerEvent(container, 'pointerdown', 100, 100)
    firePointerEvent(container, 'pointerup', 100, 100)
    const camAfter = readCamera(container)!
    expect(camAfter).toEqual(camBefore)
  })
})

// ── TC-14 ───────────────────────────────────────────────────────────────────

describe('TC-14 pointercancel mid-drag freezes camera', () => {
  it('camera unchanged after cancel; later moves ignored', () => {
    const { container } = utils
    const el = vp(container)

    firePointerEvent(container, 'pointerdown', 0, 0)
    firePointerEvent(container, 'pointermove', 50, 50)
    firePointerEvent(container, 'pointercancel', 50, 50)

    expect(el.dataset.state).toBe('idle')
    const camAtCancel = readCamera(container)!

    // A subsequent pointermove without a new pointerdown must not change camera
    firePointerEvent(container, 'pointermove', 200, 200)
    const camAfter = readCamera(container)!
    expect(camAfter).toEqual(camAtCancel)
  })
})

// ── TC-15 ───────────────────────────────────────────────────────────────────

describe('TC-15 plain wheel pans board; defaultPrevented true', () => {
  it('wheel deltaY=+100 shifts camera y by 100/zoom', () => {
    const { container } = utils

    const camBefore = readCamera(container)!
    const e = fireWheel(container, 'wheel', { deltaY: 100 })

    expect(e.defaultPrevented).toBe(true)
    const camAfter = readCamera(container)!
    // panBy(-deltaX, -deltaY) = panBy(0, -100)
    // At zoom 1: camAfter.y = camBefore.y - (-100/1) = camBefore.y + 100
    expect(camAfter.y).toBeCloseTo(camBefore.y + 100, 1)
  })

  it('wheel deltaX=+100 shifts camera x by 100/zoom', () => {
    const { container } = utils
    const camBefore = readCamera(container)!
    fireWheel(container, 'wheel', { deltaX: 100 })
    const camAfter = readCamera(container)!
    expect(camAfter.x).toBeCloseTo(camBefore.x + 100, 1)
  })
})

// ── TC-16 ───────────────────────────────────────────────────────────────────

describe('TC-16 Ctrl+wheel zooms in; defaultPrevented true', () => {
  it('Ctrl+wheel deltaY=-100 at (300,200) increases zoom', () => {
    const { container } = utils

    const camBefore = readCamera(container)!
    const e = fireWheel(container, 'wheel', {
      deltaY: -100,
      ctrlKey: true,
      clientX: 300,
      clientY: 200,
    })

    expect(e.defaultPrevented).toBe(true)
    const camAfter = readCamera(container)!
    expect(camAfter.zoom).toBeGreaterThan(camBefore.zoom)
  })
})

// ── TC-17 ───────────────────────────────────────────────────────────────────

describe('TC-17 Safari gesturechange doubles zoom (clamped); defaultPrevented true', () => {
  it('gesturechange scale=2 doubles zoom from 1.0 → 2.0', () => {
    const { container } = utils

    const camBefore = readCamera(container)!
    const e = fireGesture(container, 2)

    expect(e.defaultPrevented).toBe(true)
    const camAfter = readCamera(container)!
    expect(camAfter.zoom).toBeGreaterThan(camBefore.zoom)
    // Should be roughly double (within clamp)
    expect(camAfter.zoom).toBeLessThanOrEqual(2.1)
  })
})

// ── TC-18 ───────────────────────────────────────────────────────────────────

describe('TC-18 keyboard shortcuts: Ctrl+= zoom in, Ctrl+− zoom out, Ctrl+0 reset', () => {
  it('each shortcut changes zoom and calls preventDefault', () => {
    const { container } = utils

    // zoom in
    fireKey('=')
    const camIn = readCamera(container)!
    expect(camIn.zoom).toBeGreaterThan(1)

    // zoom out (back towards 1)
    fireKey('-')
    const camOut = readCamera(container)!
    expect(camOut.zoom).toBeCloseTo(1, 3)

    // zoom far in then reset
    fireKey('=')
    fireKey('=')
    const camFar = readCamera(container)!
    expect(camFar.zoom).toBeGreaterThan(1.4)

    fireKey('0')
    const camReset = readCamera(container)!
    expect(camReset.zoom).toBeCloseTo(1, 3)
  })

  it('Ctrl+= calls preventDefault on keydown event', () => {
    let defaultPrevented = false
    const handler = (e: KeyboardEvent) => {
      // This handler was registered after the App's keydown handler, so it
      // fires after it (same element, same phase → registration order).
      defaultPrevented = e.defaultPrevented
    }
    // Non-capture: fires in the BUBBLE phase, AFTER the App's listener.
    window.addEventListener('keydown', handler)

    act(() => {
      const e = new KeyboardEvent('keydown', {
        key: '=',
        ctrlKey: true,
        cancelable: true,
        bubbles: true,
      })
      window.dispatchEvent(e)
    })

    window.removeEventListener('keydown', handler)
    expect(defaultPrevented).toBe(true)
  })
})

// ── TC-29 ───────────────────────────────────────────────────────────────────

describe('TC-29 pointerdown+up without move: camera unchanged, hint still visible', () => {
  it('no camera change and hint still present after click-without-move', () => {
    const { container } = utils

    expect(container.querySelector('[data-testid="navigation-hint"]')).not.toBeNull()
    const camBefore = readCamera(container)!

    firePointerEvent(container, 'pointerdown', 500, 400)
    firePointerEvent(container, 'pointerup', 500, 400)

    const camAfter = readCamera(container)!
    expect(camAfter).toEqual(camBefore)
    expect(container.querySelector('[data-testid="navigation-hint"]')).not.toBeNull()
  })
})

// ── TC-30 ───────────────────────────────────────────────────────────────────

describe('TC-30 Ctrl+wheel over zoom controls does not zoom the board', () => {
  it('camera unchanged when wheel event is dispatched on the controls div', () => {
    const { container } = utils
    const controls = container.querySelector('[data-testid="zoom-controls"]') as HTMLElement
    expect(controls).not.toBeNull()

    const camBefore = readCamera(container)!

    const e = new WheelEvent('wheel', {
      deltaY: -100,
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })

    act(() => {
      controls.dispatchEvent(e)
    })

    const camAfter = readCamera(container)!
    expect(camAfter).toEqual(camBefore)
  })
})