import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createRoom,
  addPlayer,
  setConnected,
  castVote,
  reveal,
  startRound,
  allVoted,
  voteDistribution,
  PHASE,
} from './game.mjs';

test('createRoom starts in voting with no players', () => {
  const room = createRoom('abc');
  assert.equal(room.phase, PHASE.VOTING);
  assert.equal(room.players.length, 0);
});

test('addPlayer assigns distinct colors and marks connected', () => {
  let room = createRoom('abc');
  room = addPlayer(room, 'p1', 'Ann');
  room = addPlayer(room, 'p2', 'Bob');
  assert.equal(room.players.length, 2);
  assert.notEqual(room.players[0].color, room.players[1].color);
});

test('rejoining same id reconnects instead of duplicating', () => {
  let room = createRoom('abc');
  room = addPlayer(room, 'p1', 'Ann');
  room = setConnected(room, 'p1', false);
  room = addPlayer(room, 'p1', 'Ann');
  assert.equal(room.players.length, 1);
  assert.equal(room.players[0].connected, true);
});

test('castVote only applies during voting with a valid card', () => {
  let room = createRoom('abc');
  room = addPlayer(room, 'p1', 'Ann');
  room = castVote(room, 'p1', '5');
  assert.equal(room.players[0].vote, '5');
  room = castVote(room, 'p1', '999');
  assert.equal(room.players[0].vote, '5');
  room = reveal(room);
  room = castVote(room, 'p1', '8');
  assert.equal(room.players[0].vote, '5');
});

test('allVoted is true only when every connected player voted', () => {
  let room = createRoom('abc');
  room = addPlayer(room, 'p1', 'Ann');
  room = addPlayer(room, 'p2', 'Bob');
  assert.equal(allVoted(room), false);
  room = castVote(room, 'p1', '3');
  assert.equal(allVoted(room), false);
  room = castVote(room, 'p2', '5');
  assert.equal(allVoted(room), true);
});

test('allVoted ignores disconnected players', () => {
  let room = createRoom('abc');
  room = addPlayer(room, 'p1', 'Ann');
  room = addPlayer(room, 'p2', 'Bob');
  room = setConnected(room, 'p2', false);
  room = castVote(room, 'p1', '3');
  assert.equal(allVoted(room), true);
});

test('startRound clears votes, increments round, resets to voting', () => {
  let room = createRoom('abc');
  room = addPlayer(room, 'p1', 'Ann');
  room = castVote(room, 'p1', '8');
  room = reveal(room);
  assert.equal(room.phase, PHASE.REVEALED);
  room = startRound(room);
  assert.equal(room.phase, PHASE.VOTING);
  assert.equal(room.round, 2);
  assert.equal(room.players[0].vote, null);
});

test('voteDistribution counts per deck card and totals', () => {
  let room = createRoom('abc');
  room = addPlayer(room, 'p1', 'Ann');
  room = addPlayer(room, 'p2', 'Bob');
  room = addPlayer(room, 'p3', 'Cid');
  room = castVote(room, 'p1', '5');
  room = castVote(room, 'p2', '5');
  room = castVote(room, 'p3', '8');
  const dist = voteDistribution(room);
  assert.equal(dist.total, 3);
  assert.equal(dist.counts['5'], 2);
  assert.equal(dist.counts['8'], 1);
});
