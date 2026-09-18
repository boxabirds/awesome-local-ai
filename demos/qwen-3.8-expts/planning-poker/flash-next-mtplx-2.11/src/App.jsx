import { useMemo, useState } from 'react';
import { useRoom } from './useRoom.js';
import { PHASE, chunkByRow, CARDS_PER_ROW, isHost, buildInviteUrl } from './poker.js';
import { PlayerSeat, MyDeck, ResultsBar, ShareBar } from './components.jsx';

function Landing({ onCreate, initialName }) {
  const [name, setName] = useState(initialName || '');
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-6 p-6">
      <h1 className="text-3xl font-black text-sky-300">Planning Poker</h1>
      <p className="max-w-sm text-center text-sm text-slate-400">
        Real-time story estimation. Pick a card, everyone flips at once.
      </p>
      <form
        className="flex w-full max-w-sm flex-col gap-3 rounded-2xl bg-slate-800/70 p-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) onCreate(name.trim());
        }}
      >
        <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Your name
        </label>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Ann"
          className="rounded-lg bg-slate-900 px-3 py-2 text-slate-100 outline-none ring-1 ring-slate-700 focus:ring-sky-500"
        />
        <button
          type="submit"
          className="rounded-lg bg-sky-500 py-2 font-bold text-white transition hover:bg-sky-400"
        >
          Create game
        </button>
      </form>
    </div>
  );
}

function Game({ room, me, send, shareUrl }) {
  const revealed = room?.phase === PHASE.REVEALED;
  const mePlayer = room?.players.find((p) => p.id === me.playerId);
  const host = room && isHost(room, me.playerId);
  const votesIn = (room?.players || []).filter(
    (p) => p.connected && p.vote,
  ).length;
  const totalActive = (room?.players || []).filter((p) => p.connected).length;
  const allReady = votesIn > 0 && votesIn === totalActive;

  const seats = (room?.players || []).map((p, i) => ({ ...p, index: i }));
  const rows = chunkByRow(seats, CARDS_PER_ROW);

  return (
    <div className="flex min-h-full flex-col">
      <header className="space-y-2 border-b border-slate-800 px-5 py-3 text-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="font-bold text-sky-300">Round {room?.round ?? 1}</span>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                revealed
                  ? 'bg-emerald-500/20 text-emerald-300'
                  : 'bg-amber-500/20 text-amber-300'
              }`}
            >
              {revealed ? 'Revealed' : 'Voting'}
            </span>
          </div>
          <div className="text-slate-400">
            {votesIn}/{totalActive} voted
          </div>
        </div>
        <div className="flex items-center justify-between">
          <ShareBar url={shareUrl} />
          <span className="text-xs text-slate-500">
            {room?.players.filter((p) => p.connected).length ?? 0} in the room
          </span>
        </div>
      </header>

      <div className="px-4 py-3 text-center text-sm font-medium text-slate-200">
        {room?.topic}
      </div>

      <main className="flex flex-1 flex-col justify-between gap-6 px-4 pb-4">
        <div className="flex flex-col items-center gap-5 pt-4">
          {rows.map((row, ri) => (
            <div key={ri} className="flex flex-wrap justify-center gap-4">
              {row.map((player) => (
                <PlayerSeat key={player.id} player={player} revealed={revealed} />
              ))}
            </div>
          ))}
        </div>

        <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-4">
          {revealed ? (
            <>
              <ResultsBar room={room} />
              <div className="flex gap-3">
                {host ? (
                  <button
                    type="button"
                    onClick={() => send({ type: 'reset' })}
                    className="rounded-lg bg-sky-500 px-5 py-2 font-bold text-white hover:bg-sky-400"
                  >
                    Next round
                  </button>
                ) : (
                  <span className="text-xs text-slate-400">
                    Waiting for the host to start the next round…
                  </span>
                )}
              </div>
            </>
          ) : (
            <>
              <MyDeck
                selected={mePlayer?.vote}
                disabled={revealed}
                onPick={(card) => {
                  if (mePlayer?.vote !== card) send({ type: 'vote', value: card });
                }}
              />
              <div className="flex items-center gap-3">
                {allReady && (
                  <button
                    type="button"
                    onClick={() => send({ type: 'reveal' })}
                    className="rounded-lg bg-emerald-500 px-5 py-2 font-bold text-white hover:bg-emerald-400"
                  >
                    All ready — reveal!
                  </button>
                )}
                {mePlayer?.vote && (
                  <span className="text-xs text-slate-400">
                    Locked in. Waiting for others…
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

export default function App() {
  const params = useMemo(
    () => new URLSearchParams(window.location.search),
    [],
  );
  const [roomId, setRoomId] = useState(() => {
    const fromUrl = params.get('room');
    if (fromUrl) return fromUrl;
    return sessionStorage.getItem('pp:lastRoom') || null;
  });
  const [name, setName] = useState(() => sessionStorage.getItem('pp:name') || '');
  const playerId = useMemo(
    () => sessionStorage.getItem('pp:me') || crypto.randomUUID(),
    [],
  );

  const [started, setStarted] = useState(Boolean(roomId && name));

  const { room, status, send } = useRoom(
    started ? { roomId, playerId, name } : {},
  );

  function createRoom(n) {
    const code = Math.random().toString(36).slice(2, 8);
    sessionStorage.setItem('pp:name', n);
    sessionStorage.setItem('pp:me', playerId);
    sessionStorage.setItem('pp:lastRoom', code);
    setName(n);
    setRoomId(code);
    setStarted(true);
    window.history.replaceState({}, '', `?room=${code}`);
  }

  if (!started) {
    return <Landing initialName={name} onCreate={createRoom} />;
  }

  if (!room) {
    return (
      <div className="grid min-h-full place-items-center text-slate-400">
        {status === 'error' || status === 'closed'
          ? 'Connection failed — is the server running?'
          : 'Connecting to room…'}
      </div>
    );
  }

  const inviteUrl = buildInviteUrl(
    window.location.origin,
    window.location.pathname,
    roomId,
  );
  return (
    <Game
      room={room}
      me={{ playerId }}
      send={send}
      shareUrl={inviteUrl}
    />
  );
}
