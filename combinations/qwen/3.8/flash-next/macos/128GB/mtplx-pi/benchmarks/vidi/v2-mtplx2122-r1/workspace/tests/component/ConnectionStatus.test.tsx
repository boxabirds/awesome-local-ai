/**
 * Component tests for the connection status badge (story 3, `sync.client`).
 *
 * The provider is a fake emitter: no sockets, no timers other than the ones
 * the test advances, so the badge timing (CONNECTED_CONFIRMATION_MS) is
 * deterministic.
 */
import { render, act, cleanup } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import React from 'react'
import { App } from '../../src/client/App'
import { ConnectionStatus } from '../../src/client/sync/ConnectionStatus'
import type { ProviderLike } from '../../src/client/sync/connectBoard'
import { CONNECTED_CONFIRMATION_MS } from '../../src/shared/config'

const BOARD_ID = 'Ab3-_9xxxxxxxxxxxxxxxx' // 22 chars, valid base64url

// ── fake provider ────────────────────────────────────────────────────────────

class FakeProvider implements ProviderLike {
  synced = false
  destroyed = false
  private handlers = new Map<string, Set<(...args: unknown[]) => void>>()

  on(event: string, handler: (...args: unknown[]) => void): void {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set())
    this.handlers.get(event)!.add(handler)
  }

  off(event: string, handler: (...args: unknown[]) => void): void {
    this.handlers.get(event)?.delete(handler)
  }

  /** Emit one provider event, exactly like `WebsocketProvider` would. */
  emit(event: string, ...args: unknown[]): void {
    this.handlers.get(event)?.forEach(handler => handler(...args))
  }

  /** What y-websocket does when a connection drops after a successful sync. */
  drop(): void {
    this.synced = false
    this.emit('status', { status: 'disconnected' })
    this.emit('sync', false)
  }

  /** What y-websocket does when a new connection finishes syncing. */
  restore(): void {
    this.emit('status', { status: 'connected' })
    this.synced = true
    this.emit('sync', true)
  }

  destroy(): void {
    this.destroyed = true
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

let utils: ReturnType<typeof render>
let provider: FakeProvider

function renderBoard(): void {
  provider = new FakeProvider()
  utils = render(<App boardId={BOARD_ID} providerFactory={() => provider} />)
}

function badge(): HTMLElement | null {
  return utils.container.querySelector('[data-testid="connection-status"]')
}

function badgeText(): string | null {
  return badge()?.textContent ?? null
}

function statusRole(): HTMLElement | null {
  return utils.container.querySelector('[role="status"]')
}

beforeEach(() => {
  vi.useFakeTimers()
  renderBoard()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

// ── TC-19 connecting → connected ────────────────────────────────────────────

describe('TC-19 first load: "Connecting…" then hidden', () => {
  it('shows the badge before the first sync and hides it after', () => {
    expect(badgeText()).toBe('Connecting…')
    expect(badge()?.getAttribute('data-state')).toBe('connecting')

    act(() => {
      provider.restore()
    })

    expect(badge()).toBeNull()
  })

  it('renders nothing for the plain "connected" state', () => {
    expect(ConnectionStatus({ state: 'connected' })).toBeNull()
  })
})

// ── TC-20 outage and confirmation window ────────────────────────────────────

describe('TC-20 connected → disconnected → connected', () => {
  it('Reconnecting… → Connected, hidden exactly at CONNECTED_CONFIRMATION_MS', () => {
    act(() => {
      provider.restore()
    })
    expect(badge()).toBeNull()

    act(() => {
      provider.drop()
    })
    expect(badgeText()).toBe('Reconnecting…')
    expect(badge()?.getAttribute('data-state')).toBe('reconnecting')

    act(() => {
      provider.restore()
    })
    expect(badgeText()).toBe('Connected')
    expect(badge()?.getAttribute('data-state')).toBe('confirmed')

    // Boundary: still visible one millisecond before the window closes …
    act(() => {
      vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS - 1)
    })
    expect(badgeText()).toBe('Connected')

    // … and hidden at exactly CONNECTED_CONFIRMATION_MS.
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(badge()).toBeNull()
  })
})

// ── TC-21 disconnect during the confirmation window ─────────────────────────

describe('TC-21 disconnect again during confirmation', () => {
  it('goes straight back to "Reconnecting…" and restarts the window', () => {
    act(() => {
      provider.restore()
      provider.drop()
      provider.restore()
    })
    expect(badgeText()).toBe('Connected')

    act(() => {
      vi.advanceTimersByTime(500)
      provider.drop()
    })
    expect(badgeText()).toBe('Reconnecting…')

    // A later reconnection gets a fresh, full confirmation window.
    act(() => {
      provider.restore()
    })
    expect(badgeText()).toBe('Connected')
    act(() => {
      vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS - 1)
    })
    expect(badgeText()).toBe('Connected')
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(badge()).toBeNull()
  })
})

// ── role=status and no lock-out while reconnecting ──────────────────────────

describe('badge semantics', () => {
  it('exposes the badge as a live region (role="status")', () => {
    const status = statusRole()
    expect(status).not.toBeNull()
    expect(status?.getAttribute('data-testid')).toBe('connection-status')
    expect(status?.textContent).toBe('Connecting…')
  })

  it('keeps the board editable in every state', () => {
    const states = ['connecting', 'reconnecting', 'confirmed', 'connected'] as const
    for (const state of states) {
      // Move the fake provider into the state under test.
      act(() => {
        if (state !== 'connecting') provider.restore()
        if (state === 'reconnecting' || state === 'confirmed') provider.drop()
        if (state === 'confirmed') provider.restore()
        vi.advanceTimersByTime(0)
      })

      const before = utils.container.querySelectorAll('[data-testid="sticky-note"]').length
      act(() => {
        window.__vidi6!.createNote(40 + before * 260, 0)
      })
      const notes = utils.container.querySelectorAll('[data-testid="sticky-note"]')
      expect(notes.length).toBe(before + 1)

      // Selection still works: pointer press + release selects the new note.
      const note = notes[notes.length - 1] as HTMLElement
      const id = note.getAttribute('data-note-id')!
      act(() => {
        note.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10, pointerId: 1, pointerType: 'mouse', isPrimary: true }))
        window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 10, clientY: 10, pointerId: 1, pointerType: 'mouse', isPrimary: true }))
      })
      expect(utils.container.querySelector('[data-testid="note-toolbar"]')).not.toBeNull()
      expect(note.getAttribute('data-selected')).toBe('true')

      // Recolouring the selected note still changes the doc.
      act(() => {
        const swatch = utils.container.querySelector('[data-testid="color-swatch-blue"]') as HTMLElement
        swatch.click()
      })
      expect((utils.container.querySelector(`[data-note-id="${id}"]`) as HTMLElement).style.backgroundColor).toBe(
        'rgb(144, 202, 249)',
      )
    }
  })
})
