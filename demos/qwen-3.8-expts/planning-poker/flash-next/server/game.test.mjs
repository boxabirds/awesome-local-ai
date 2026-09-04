import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as game from './game.mjs'

function mkRoom() {
  const room = game.createRoom({ id: 'r1', hostId: 'host', hostName: 'Host', deckId: 'fibonacci' })
  game.joinRoom(room, { id: 'p1', name: 'P1', role: game.ROLE.PLAYER })
  game.joinRoom(room, { id: 'p2', name: 'P2', role: game.ROLE.PLAYER })
  return room
}

test('public view hides other members votes while voting', () => {
  const room = mkRoom()
  game.setVote(room, 'p1', '5')
  const view = game.publicView(room, 'p2')
  const p1 = view.members.find((m) => m.id === 'p1')
  const self = view.members.find((m) => m.id === 'p2')
  assert.equal(p1.vote, null, "other member's vote must be hidden")
  assert.equal(p1.hasVoted, true)
  assert.equal(self.vote, null)
})

test('revealed view exposes all votes and tally', () => {
  const room = mkRoom()
  game.setVote(room, 'host', '3')
  game.setVote(room, 'p1', '5')
  game.setVote(room, 'p2', '5')
  game.revealRound(room)
  const view = game.publicView(room, 'p2')
  assert.equal(view.phase, game.PHASE.REVEALED)
  assert.deepEqual(view.tally, { 3: 1, 5: 2 })
})

test('allVotersReady requires every connected voter to vote', () => {
  const room = mkRoom()
  game.setVote(room, 'host', '3')
  game.setVote(room, 'p1', '3')
  assert.equal(game.allVotersReady(room), false)
  game.setVote(room, 'p2', '3')
  assert.equal(game.allVotersReady(room), true)
})

test('setVote rejects cards not in the active deck', () => {
  const room = mkRoom()
  const res = game.setVote(room, 'p1', '4')
  assert.ok(res.error, '4 is not a Fibonacci card')
})

test('spectators cannot vote', () => {
  const room = game.createRoom({ id: 'r2', hostId: 'host', hostName: 'Host', deckId: 'fibonacci' })
  game.joinRoom(room, { id: 's1', name: 'S1', role: game.ROLE.SPECTATOR })
  const res = game.setVote(room, 's1', '5')
  assert.ok(res.error)
})

test('reset clears votes and reopens voting', () => {
  const room = mkRoom()
  game.setVote(room, 'p1', '5')
  game.revealRound(room)
  game.resetRound(room)
  assert.equal(room.phase, game.PHASE.VOTING)
  assert.equal(room.members.p1.vote, null)
})
