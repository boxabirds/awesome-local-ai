export const DECKS = {
  fibonacci: { id: 'fibonacci', name: 'Fibonacci', cards: ['0', '1', '2', '3', '5', '8', '13', '21', '34', '55', '89', '?'] },
  tshirt: { id: 'tshirt', name: 'T-Shirt Sizes', cards: ['XS', 'S', 'M', 'L', 'XL', 'XXL', '?'] },
  powers: { id: 'powers', name: 'Powers of 2', cards: ['1', '2', '4', '8', '16', '32', '64', '128', '?'] },
  custom: { id: 'custom', name: 'Custom', cards: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '?'] },
}

export const PHASE = {
  VOTING: 'voting',
  REVEALED: 'revealed',
}

export const ROLE = {
  FACILITATOR: 'facilitator',
  PLAYER: 'player',
  SPECTATOR: 'spectator',
}

export function getDeck(room) {
  return DECKS[room.deckId] || DECKS.fibonacci
}

export function createRoom({ id, hostId, hostName, deckId }) {
  const resolvedDeck = DECKS[deckId] ? deckId : 'fibonacci'
  const room = {
    id,
    deckId: resolvedDeck,
    issues: [],
    currentIssueIndex: 0,
    phase: PHASE.VOTING,
    roundCounter: 1,
    members: {},
    hostId,
    createdAt: Date.now(),
  }
  return addMemberInternal(room, { id: hostId, name: hostName, role: ROLE.FACILITATOR })
}

function addMemberInternal(room, member) {
  room.members[member.id] = {
    id: member.id,
    name: member.name,
    role: member.role,
    connected: true,
    vote: null,
  }
  return room
}

export function joinRoom(room, member) {
  const existing = room.members[member.id]
  if (existing) {
    existing.connected = true
    if (room.phase === PHASE.REVEALED) existing.vote = null
    return room
  }
  room.members[member.id] = {
    id: member.id,
    name: member.name,
    role: member.role,
    connected: true,
    vote: null,
  }
  return room
}

export function setConnected(room, memberId, connected) {
  const m = room.members[memberId]
  if (m) m.connected = connected
  return room
}

export function setVote(room, memberId, card) {
  const m = room.members[memberId]
  if (!m) return { room, error: 'unknown member' }
  if (m.role === ROLE.SPECTATOR) return { room, error: 'spectators cannot vote' }
  if (room.phase !== PHASE.VOTING) return { room, error: 'voting is closed' }
  const deck = getDeck(room)
  if (card !== null && !deck.cards.includes(card)) {
    return { room, error: 'card not in deck' }
  }
  m.vote = card
  return { room }
}

export function resetRound(room) {
  for (const id of Object.keys(room.members)) {
    room.members[id].vote = null
  }
  room.phase = PHASE.VOTING
  return room
}

export function revealRound(room) {
  room.phase = PHASE.REVEALED
  return room
}

export function readyToReveal(room) {
  return Object.values(room.members).some(
    (m) => m.connected && m.role !== ROLE.SPECTATOR && m.vote !== null,
  )
}

export function connectedVoters(room) {
  return Object.values(room.members).filter(
    (m) => m.connected && m.role !== ROLE.SPECTATOR,
  )
}

export function allVotersReady(room) {
  const voters = connectedVoters(room)
  if (voters.length === 0) return false
  return voters.every((m) => m.vote !== null)
}

export function currentIssue(room) {
  return room.issues[room.currentIssueIndex] || null
}

export function advanceIssue(room) {
  if (room.currentIssueIndex < room.issues.length - 1) {
    room.currentIssueIndex += 1
  } else {
    room.currentIssueIndex = -1
  }
  resetRound(room)
  room.roundCounter += 1
  return room
}

export function addIssue(room, title) {
  const clean = (title || '').trim()
  if (!clean) return { room, error: 'issue title required' }
  room.issues.push({ id: `issue-${room.issues.length + 1}-${Date.now()}`, title: clean })
  if (room.currentIssueIndex === -1) room.currentIssueIndex = room.issues.length - 1
  return { room }
}

export function tally(room) {
  const counts = {}
  for (const m of Object.values(room.members)) {
    if (m.connected && m.vote !== null) {
      counts[m.vote] = (counts[m.vote] || 0) + 1
    }
  }
  return counts
}

export function publicView(room, forMemberId) {
  const revealed = room.phase === PHASE.REVEALED
  const members = Object.values(room.members).map((m) => ({
    id: m.id,
    name: m.name,
    role: m.role,
    connected: m.connected,
    vote: revealed ? m.vote : (m.id === forMemberId ? m.vote : null),
    hasVoted: m.vote !== null,
  }))
  return {
    id: room.id,
    deckId: room.deckId,
    cards: getDeck(room).cards,
    issues: room.issues.map((i) => ({ id: i.id, title: i.title })),
    currentIssueIndex: room.currentIssueIndex,
    phase: room.phase,
    roundCounter: room.roundCounter,
    members,
    tally: revealed ? tally(room) : null,
    readyToReveal: readyToReveal(room),
    allVotersReady: allVotersReady(room),
    currentUserId: forMemberId,
  }
}
