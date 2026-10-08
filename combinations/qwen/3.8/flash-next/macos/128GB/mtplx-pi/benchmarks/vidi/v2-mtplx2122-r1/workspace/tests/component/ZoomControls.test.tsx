import { render, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { ZoomControls } from '../../src/client/canvas/ZoomControls'
import { ZOOM_MIN, ZOOM_MAX } from '../../src/shared/config'

describe('ZoomControls', () => {
  // TC-19: at ZOOM_MIN zoom-out is disabled, label 10%
  it('TC-19 at ZOOM_MIN: Zoom out disabled, Zoom in enabled, label 10%', () => {
    const { container } = render(
      React.createElement(ZoomControls, {
        zoomPercent: Math.round(ZOOM_MIN * 100),
        canZoomIn: true,
        canZoomOut: false,
        onZoomIn: vi.fn(),
        onZoomOut: vi.fn(),
        onReset: vi.fn(),
      }),
    )

    const outBtn = container.querySelector('[aria-label="Zoom out"]') as HTMLButtonElement
    const inBtn = container.querySelector('[aria-label="Zoom in"]') as HTMLButtonElement
    const label = container.querySelector('[data-testid="zoom-label"]')!

    expect(outBtn.disabled).toBe(true)
    expect(inBtn.disabled).toBe(false)
    expect(label.textContent).toBe('10%')
  })

  // TC-20: at ZOOM_MAX zoom-in is disabled, label 400%
  it('TC-20 at ZOOM_MAX: Zoom in disabled, label 400%', () => {
    const { container } = render(
      React.createElement(ZoomControls, {
        zoomPercent: Math.round(ZOOM_MAX * 100),
        canZoomIn: false,
        canZoomOut: true,
        onZoomIn: vi.fn(),
        onZoomOut: vi.fn(),
        onReset: vi.fn(),
      }),
    )

    const inBtn = container.querySelector('[aria-label="Zoom in"]') as HTMLButtonElement
    const label = container.querySelector('[data-testid="zoom-label"]')!

    expect(inBtn.disabled).toBe(true)
    expect(label.textContent).toBe('400%')
  })

  // TC-21: zoom 1.5625 → label "156%" (rounded)
  it('TC-21 zoom 1.5625 → label 156%', () => {
    const { container } = render(
      React.createElement(ZoomControls, {
        zoomPercent: Math.round(1.5625 * 100),
        canZoomIn: true,
        canZoomOut: true,
        onZoomIn: vi.fn(),
        onZoomOut: vi.fn(),
        onReset: vi.fn(),
      }),
    )

    const label = container.querySelector('[data-testid="zoom-label"]')!
    expect(label.textContent).toBe('156%')
  })

  // TC-32: clicking a disabled button does not call its callback
  it('TC-32 clicking disabled button does not call callback', () => {
    const onZoomIn = vi.fn()
    const onZoomOut = vi.fn()

    const { container } = render(
      React.createElement(ZoomControls, {
        zoomPercent: Math.round(ZOOM_MAX * 100),
        canZoomIn: false,
        canZoomOut: true,
        onZoomIn,
        onZoomOut,
        onReset: vi.fn(),
      }),
    )

    const inBtn = container.querySelector('[aria-label="Zoom in"]') as HTMLButtonElement
    expect(inBtn.disabled).toBe(true)

    // In React a disabled button does not call onClick, so dispatch click via
    // Testing Library and verify the handler is not called.
    fireEvent.click(inBtn)
    expect(onZoomIn).not.toHaveBeenCalled()
  })

  it('enabled buttons call callbacks on click', () => {
    const onZoomIn = vi.fn()
    const onZoomOut = vi.fn()
    const onReset = vi.fn()

    const { container } = render(
      React.createElement(ZoomControls, {
        zoomPercent: 100,
        canZoomIn: true,
        canZoomOut: true,
        onZoomIn,
        onZoomOut,
        onReset,
      }),
    )

    fireEvent.click(container.querySelector('[aria-label="Zoom in"]')!)
    expect(onZoomIn).toHaveBeenCalledTimes(1)

    fireEvent.click(container.querySelector('[aria-label="Zoom out"]')!)
    expect(onZoomOut).toHaveBeenCalledTimes(1)

    fireEvent.click(container.querySelector('[aria-label="Reset view"]')!)
    expect(onReset).toHaveBeenCalledTimes(1)
  })

  it('zoom label has aria-live="polite" and is an <output> element', () => {
    const { container } = render(
      React.createElement(ZoomControls, {
        zoomPercent: 125,
        canZoomIn: true,
        canZoomOut: true,
        onZoomIn: vi.fn(),
        onZoomOut: vi.fn(),
        onReset: vi.fn(),
      }),
    )

    const label = container.querySelector('[data-testid="zoom-label"]')!
    expect(label.getAttribute('aria-live')).toBe('polite')
    expect(label.tagName.toLowerCase()).toBe('output')
    expect(label.textContent).toBe('125%')
  })

  // TC-30: the stopPropagation handler on the controls container prevents
  // wheel events from bubbling further.  We verify the handler is wired by
  // checking that a wheel event on the container is NOT prevented (the component
  // calls stopPropagation, not preventDefault) and that it does not propagate
  // when React has processed it.
  //
  // Because Testing Library renders into a container that is a sibling of the
  // viewport (not a descendant), TC-30 is effectively tested at the App level in
  // BoardViewport.test.tsx.  Here we confirm the handler contract: the controls
  // container does NOT call preventDefault (so the browser default is not
  // "suppressed" over the controls, per the design).
  it('TC-30 wheel events over controls do not have preventDefault called (browser default not suppressed)', () => {
    const { container } = render(
      React.createElement(ZoomControls, {
        zoomPercent: 100,
        canZoomIn: true,
        canZoomOut: true,
        onZoomIn: vi.fn(),
        onZoomOut: vi.fn(),
        onReset: vi.fn(),
      }),
    )

    const controls = container.querySelector('[data-testid="zoom-controls"]') as HTMLElement
    const e = new WheelEvent('wheel', {
      deltaY: -100,
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })

    // Dispatch directly on the controls element – React processes the event via
    // its delegated listener and the stopPropagation handler runs.
    // The key assertion: defaultPrevented stays false (we stop propagation, not
    // prevent the default).
    controls.dispatchEvent(e)
    expect(e.defaultPrevented).toBe(false)
  })
})