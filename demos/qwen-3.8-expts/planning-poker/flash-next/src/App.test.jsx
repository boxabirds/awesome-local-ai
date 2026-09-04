import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import App from './App.jsx'

let sockets = []
let initialState = null

class FakeWebSocket {
  constructor(url) {
    this.url = url
    this.readyState = 1 // OPEN
    this.sent = []
    const seed = initialState
    sockets.push(this)
    setTimeout(() => {
      this.onopen && this.onopen()
      if (this.onmessage && seed) {
        this.onmessage({ data: JSON.stringify({ type: 'state', state: seed }) })
      }
    }, 0)
  }
    send(msg) { this.sent.push(JSON.parse(msg)) }
  close() { this.readyState = 3 }
}
FakeWebSocket.OPEN = 1

function baseState(overrides) {
  return {
    id: 'r1',
    deckId: 'fibonacci',
    cards: ['1', '2', '3'],
    issues: [{ id: 'i1', title: 'Issue 1' }],
    currentIssueIndex: 0,
    roundCounter: 1,
    tally: null,
    readyToReveal: true,
    allVotersReady: false,
    members: [
      { id: 'me1', name: 'Host', role: 'facilitator', connected: true, vote: null, hasVoted: false },
      { id: 'p1', name: 'P1', role: 'player', connected: true, vote: null, hasVoted: false },
    ],
    ...overrides,
  }
}

function gameSocket() { return sockets[sockets.length - 1] }

function startGame(state) {
  initialState = state
  render(<App />)
  fireEvent.click(screen.getByRole('button', { name: 'Start new game' }))
}

beforeEach(() => {
  sockets = []
  vi.stubGlobal('WebSocket', FakeWebSocket)
  vi.stubGlobal('crypto', { randomUUID: () => 'r1' })
  localStorage.clear()
  localStorage.setItem('flash-next-member', JSON.stringify({ id: 'me1', name: 'Host' }))
})

afterEach(() => { vi.unstubAllGlobals() })

describe('facilitator actions reach the server', () => {
  it('sends a reveal when "Reveal cards" is clicked', async () => {
    startGame(baseState({ phase: 'voting' }))
    fireEvent.click(await screen.findByText('Reveal cards', {}, { timeout: 2000 }))
    expect(gameSocket().sent).toEqual(expect.arrayContaining([{ type: 'reveal' }]))
  })

  it('sends reset and nextIssue when "Vote again" / "Next issue" are clicked', async () => {
    startGame(baseState({ phase: 'revealed', tally: { '2': 1 } }))
    fireEvent.click(await screen.findByText('Vote again', {}, { timeout: 2000 }))
    fireEvent.click(await screen.findByText('Next issue', {}, { timeout: 2000 }))
    expect(gameSocket().sent).toEqual(expect.arrayContaining([{ type: 'reset' }, { type: 'nextIssue' }]))
  })
})
