import { useMemo, useState } from 'react'
import { useRoom } from './useRoom.js'

const DECK_OPTIONS = [
  { id: 'fibonacci', name: 'Fibonacci' },
  { id: 'tshirt', name: 'T-Shirt Sizes' },
  { id: 'powers', name: 'Powers of 2' },
  { id: 'custom', name: 'Custom 1-10' },
]

const STORAGE_KEY = 'flash-next-member'

function loadMember() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  const member = { id: crypto.randomUUID(), name: '' }
  return member
}

export default function App() {
  const [member, setMember] = useState(loadMember)
  const [config, setConfig] = useState(null)

  const setName = (name) => setMember((m) => ({ ...m, name }))

  if (!config) {
    return <Lobby member={member} setName={setName} onStart={setConfig} />
  }
  return <Game member={member} config={config} onExit={() => setConfig(null)} />
}

function initialMode() {
  const join = new URLSearchParams(location.search).get('join')
  return join ? { mode: 'join', code: join } : { mode: 'create', code: '' }
}

function Lobby({ member, setName, onStart }) {
  const initial = useMemo(initialMode, [])
  const [mode, setMode] = useState(initial.mode)
  const [code, setCode] = useState(initial.code)
  const [role, setRole] = useState('player')
  const [deck, setDeck] = useState('fibonacci')

  const canSubmit = member.name.trim().length > 0 && (mode === 'create' || code.trim().length > 0)

  function start() {
    if (!canSubmit) return
    if (mode === 'create') {
      onStart({ roomId: crypto.randomUUID(), name: member.name, role: 'facilitator', isHost: true, deck })
    } else {
      onStart({ roomId: code.trim(), name: member.name, role, isHost: false, deck })
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-slate-200 p-8">
        <h1 className="text-2xl font-bold text-slate-800">Planning Poker</h1>
        <p className="text-sm text-slate-500 mb-6">Agile estimation for your team.</p>

        <label className="block text-sm font-medium text-slate-700 mb-1">Your name</label>
        <input
          value={member.name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Julia"
          className="w-full mb-4 px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />

        <div className="flex gap-2 mb-4">
          <TabButton active={mode === 'create'} onClick={() => setMode('create')}>New game</TabButton>
          <TabButton active={mode === 'join'} onClick={() => setMode('join')}>Join game</TabButton>
        </div>

        {mode === 'create' ? (
          <label className="block mb-4">
            <span className="text-sm font-medium text-slate-700">Deck</span>
            <select
              value={deck}
              onChange={(e) => setDeck(e.target.value)}
              className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300"
            >
              {DECK_OPTIONS.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </label>
        ) : (
          <>
            <label className="block mb-3">
              <span className="text-sm font-medium text-slate-700">Game code</span>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="paste game code / url"
                className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300"
              />
            </label>
            <label className="block mb-4">
              <span className="text-sm font-medium text-slate-700">Role</span>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300"
              >
                <option value="player">Player (can vote)</option>
                <option value="spectator">Spectator (watch only)</option>
              </select>
            </label>
          </>
        )}

        <button
          onClick={start}
          disabled={!canSubmit}
          className="w-full py-2.5 rounded-lg bg-indigo-600 text-white font-medium disabled:opacity-40 hover:bg-indigo-700 transition"
        >
          {mode === 'create' ? 'Start new game' : 'Join game'}
        </button>
      </div>
    </div>
  )
}

function TabButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 py-2 rounded-lg text-sm font-medium border transition ${
        active ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-300'
      }`}
    >
      {children}
    </button>
  )
}

function Game({ member, config, onExit }) {
  const { state, status, send } = useRoom({
    roomId: config.roomId,
    memberId: member.id,
    name: member.name,
    role: config.role,
    isHost: config.isHost,
    deck: config.deck,
  })

  const me = useMemo(() => state?.members.find((m) => m.id === member.id), [state, member.id])
  const isFacilitator = me?.role === 'facilitator'

  if (status === 'error' || status === 'closed') {
    return <Notice text={`Connection ${status}. The game may not exist.`} onExit={onExit} />
  }
  if (!state) return <Notice text="Connecting to game…" onExit={onExit} />

  const myVote = me?.vote ?? null
  const revealed = state.phase === 'revealed'
  const currentIssue = state.currentIssueIndex >= 0 ? state.issues[state.currentIssueIndex] : null

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-6">
      <header className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div>
          <h1 className="text-lg font-bold text-slate-800">{currentIssue ? currentIssue.title : 'No active issue'}</h1>
          <p className="text-xs text-slate-500">
            Game <code className="bg-slate-200 px-1 rounded">{state.id}</code> · Round {state.roundCounter} · {state.deckId}
          </p>
        </div>
        <CopyLink code={state.id} />
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr_260px] gap-4 max-w-6xl mx-auto">
        <IssuesPanel state={state} isFacilitator={isFacilitator} send={send} />
        <VoteArea state={state} myVote={myVote} canVote={me?.role === 'player' || isFacilitator} send={send} />
        <PlayersPanel state={state} me={me} isFacilitator={isFacilitator} revealed={revealed} send={send} />
      </div>
    </div>
  )
}

function IssuesPanel({ state, isFacilitator, send }) {
  const [title, setTitle] = useState('')
  return (
    <aside className="bg-white rounded-xl border border-slate-200 p-4 h-fit">
      <h2 className="text-sm font-semibold text-slate-700 mb-2">Issues</h2>
      <ul className="space-y-1 mb-3 max-h-72 overflow-auto">
        {state.issues.length === 0 && <li className="text-sm text-slate-400">No issues yet.</li>}
        {state.issues.map((issue, i) => (
          <li key={issue.id}>
            <button
              disabled={!isFacilitator}
              onClick={() => send({ type: 'selectIssue', index: i })}
              className={`w-full text-left text-sm px-2 py-1.5 rounded ${
                i === state.currentIssueIndex ? 'bg-indigo-50 text-indigo-700 font-medium' : 'hover:bg-slate-50'
              } disabled:cursor-default`}
            >
              {issue.title}
            </button>
          </li>
        ))}
      </ul>
      {isFacilitator && (
        <form
          onSubmit={(e) => { e.preventDefault(); if (title.trim()) { send({ type: 'addIssue', title }); setTitle('') } }}
          className="flex gap-1"
        >
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Add issue…"
            className="flex-1 px-2 py-1 text-sm rounded border border-slate-300"
          />
          <button className="px-2 py-1 text-sm rounded bg-slate-800 text-white">Add</button>
        </form>
      )}
    </aside>
  )
}

function VoteArea({ state, myVote, canVote, send }) {
  const revealed = state.phase === 'revealed'
  return (
    <section className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="flex justify-between items-center mb-3">
        <h2 className="text-sm font-semibold text-slate-700">{revealed ? 'Results' : 'Pick your card'}</h2>
        {state.readyToReveal && !revealed && <span className="text-xs text-emerald-600">Ready to reveal</span>}
      </div>

      {revealed ? (
        <ResultsView state={state} />
      ) : (
        <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
          {state.cards.map((card) => (
            <button
              key={card}
              disabled={!canVote}
              onClick={() => send({ type: 'setVote', card: myVote === card ? null : card })}
              className={`aspect-[3/4] rounded-lg border font-semibold text-lg transition disabled:opacity-50 ${
                myVote === card
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-white border-slate-300 text-slate-700 hover:border-indigo-400'
              }`}
            >
              {card}
            </button>
          ))}
        </div>
      )}

      <div className="flex gap-2 mt-4 flex-wrap">
        {state.phase === 'revealed' && state.allVotersReady && <span className="text-xs text-slate-500 self-center">Consensus reached on the cards shown.</span>}
      </div>
    </section>
  )
}

function ResultsView({ state }) {
  const entries = Object.entries(state.tally || {})
  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-4">
        {entries.length === 0 && <p className="text-sm text-slate-400">No votes cast.</p>}
        {entries.map(([card, count]) => (
          <div key={card} className="px-3 py-2 rounded-lg bg-slate-100 text-slate-700 text-sm">
            <span className="font-bold text-base">{card}</span> × {count}
          </div>
        ))}
      </div>
      <ul className="grid grid-cols-2 gap-1">
        {state.members.filter((m) => m.connected && m.vote !== null).map((m) => (
          <li key={m.id} className="text-sm text-slate-600 flex justify-between px-2 py-1 bg-slate-50 rounded">
            <span>{m.name}</span><span className="font-semibold">{m.vote}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function PlayersPanel({ state, me, isFacilitator, revealed, send }) {
  const others = state.members.filter((m) => m.id !== me.id && m.connected)
  return (
    <aside className="bg-white rounded-xl border border-slate-200 p-4 h-fit">
      <div className="flex justify-between items-center mb-2">
        <h2 className="text-sm font-semibold text-slate-700">Players</h2>
        <span className="text-xs text-slate-400">{state.members.filter((m) => m.connected).length} online</span>
      </div>
      <ul className="space-y-1 mb-4">
        {state.members.filter((m) => m.connected).map((m) => (
          <li key={m.id} className="flex justify-between items-center text-sm px-2 py-1.5 rounded bg-slate-50">
            <span className="text-slate-700">
              {m.name}
              {m.role !== 'player' && <span className="ml-1 text-xs text-slate-400">({m.role})</span>}
              {m.id === me.id && <span className="ml-1 text-xs text-indigo-500">you</span>}
            </span>
            <span className="font-semibold text-slate-600">
              {revealed ? m.vote ?? '—' : m.hasVoted ? '✓' : '···'}
            </span>
          </li>
        ))}
      </ul>
      {isFacilitator && (
        <div className="flex flex-col gap-2">
          {state.phase === 'voting' ? (
            <ActionBtn onClick={() => send({ type: 'reveal' })} disabled={!state.readyToReveal}>Reveal cards</ActionBtn>
          ) : (
            <>
              <ActionBtn onClick={() => send({ type: 'reset' })}>Vote again</ActionBtn>
              <ActionBtn variant="ghost" onClick={() => send({ type: 'nextIssue' })}>Next issue</ActionBtn>
            </>
          )}
        </div>
      )}
    </aside>
  )
}

function ActionBtn({ children, onClick, disabled, variant = 'primary' }) {
  const styles = variant === 'primary'
    ? 'bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40'
    : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50'
  return (
    <button onClick={onClick} disabled={disabled} className={`w-full py-2 rounded-lg text-sm font-medium transition ${styles}`}>
      {children}
    </button>
  )
}

function CopyLink({ code }) {
  const [copied, setCopied] = useState(false)
  const url = `${location.origin}${location.pathname}?join=${code}`
  return (
    <button
      onClick={() => { navigator.clipboard?.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
      className="text-xs px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-100"
    >
      {copied ? 'Copied!' : 'Copy invite link'}
    </button>
  )
}

function Notice({ text, onExit }) {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center max-w-sm">
        <p className="text-slate-600 mb-4">{text}</p>
        <button onClick={onExit} className="px-4 py-2 rounded-lg bg-slate-800 text-white text-sm">Back to lobby</button>
      </div>
    </div>
  )
}
