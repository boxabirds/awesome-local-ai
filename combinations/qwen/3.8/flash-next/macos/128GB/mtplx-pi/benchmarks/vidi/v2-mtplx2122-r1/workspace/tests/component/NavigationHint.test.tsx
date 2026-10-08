import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import React from 'react'
import { NavigationHint, NAVIGATION_HINT_TEXT } from '../../src/client/canvas/NavigationHint'

describe('NavigationHint', () => {
  it('TC-22 visible=true renders the hint', () => {
    const { container } = render(
      React.createElement(NavigationHint, { visible: true }),
    )
    const hint = container.querySelector('[data-testid="navigation-hint"]')
    expect(hint).not.toBeNull()
    expect(hint!.textContent).toBe(NAVIGATION_HINT_TEXT)
  })

  it('TC-22 visible=false renders nothing', () => {
    const { container } = render(
      React.createElement(NavigationHint, { visible: false }),
    )
    const hint = container.querySelector('[data-testid="navigation-hint"]')
    expect(hint).toBeNull()
  })

  it('hint text matches the exact string from PRD', () => {
    expect(NAVIGATION_HINT_TEXT).toBe(
      'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom',
    )
  })

  it('TC-22 visible → hidden after first navigation', () => {
    const { rerender, container } = render(
      React.createElement(NavigationHint, { visible: true }),
    )
    expect(container.querySelector('[data-testid="navigation-hint"]')).not.toBeNull()

    rerender(React.createElement(NavigationHint, { visible: false }))
    expect(container.querySelector('[data-testid="navigation-hint"]')).toBeNull()

    // stays hidden
    rerender(React.createElement(NavigationHint, { visible: false }))
    expect(container.querySelector('[data-testid="navigation-hint"]')).toBeNull()
  })
})
