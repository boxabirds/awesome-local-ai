import { useState } from 'react';
import {
  DECK,
  distribution,
  averageEstimate,
  cardWeight,
  maxWeight,
} from './poker.js';

const REVEAL_STAGGER = 90;

export function ShareBar({ url }) {
  const [copied, setCopied] = useState(false);

  function copy() {
    const done = () => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url).then(done, () => legacyCopy(url, done));
    } else {
      legacyCopy(url, done);
    }
  }

  return (
    <div className="flex items-center gap-2 text-xs">
      <input
        readOnly
        value={url}
        aria-label="Invite link"
        onFocus={(e) => e.currentTarget.select()}
        className="w-56 truncate rounded-md bg-slate-900 px-2 py-1 text-slate-300 outline-none ring-1 ring-slate-700 sm:w-72"
      />
      <button
        type="button"
        onClick={copy}
        className="rounded-md bg-sky-500 px-3 py-1 font-semibold text-white transition hover:bg-sky-400"
      >
        {copied ? 'Copied!' : 'Copy link'}
      </button>
    </div>
  );
}

function legacyCopy(text, done) {
  const el = document.createElement('textarea');
  el.value = text;
  el.style.position = 'fixed';
  el.style.opacity = '0';
  document.body.appendChild(el);
  el.select();
  try {
    document.execCommand('copy');
    done();
  } catch {
    /* clipboard unavailable; the input is still selectable */
  }
  document.body.removeChild(el);
}

export function FlipCard({ player, revealed }) {
  const flipped = revealed && player.vote;
  return (
    <div className="card-scene h-28 w-20 shrink-0 sm:h-32 sm:w-24">
      <div
        className={`card-inner ${flipped ? 'is-flipped' : ''}`}
        style={{ transitionDelay: `${(player.index ?? 0) * REVEAL_STAGGER}ms` }}
      >
        <div className="card-face back bg-slate-700 text-slate-400 text-3xl font-black">
          ?
        </div>
        <div
          className="card-face front text-2xl font-black text-slate-900"
          style={{ background: player.color }}
        >
          {player.vote || '?'}
        </div>
      </div>
    </div>
  );
}

export function PlayerSeat({ player, revealed }) {
  const active = player.connected;
  return (
    <div
      className={`flex flex-col items-center gap-1.5 transition-opacity ${
        active ? '' : 'opacity-30'
      }`}
    >
      <div className="flex items-center gap-1.5 text-xs">
        <span
          className="inline-block h-2.5 w-2.5 rounded-full"
          style={{ background: player.color }}
        />
        <span className="max-w-[7rem] truncate font-medium text-slate-200">
          {player.name}
        </span>
        {player.vote && !revealed && (
          <span
            className="voted-dot inline-block h-2 w-2 rounded-full bg-emerald-400"
            title="locked in"
          />
        )}
      </div>
      <FlipCard player={player} revealed={revealed} />
    </div>
  );
}

export function MyDeck({ selected, disabled, onPick }) {
  return (
    <div className="flex flex-wrap items-end justify-center gap-1.5 sm:gap-2.5">
      {DECK.map((card, i) => (
        <button
          key={card}
          type="button"
          disabled={disabled}
          data-card={card}
          data-selected={selected === card}
          onClick={() => onPick(card)}
          className={`deck-card fan-in grid h-20 w-14 place-items-center rounded-xl bg-white text-xl font-black text-slate-900 shadow-lg sm:h-24 sm:w-16 disabled:cursor-not-allowed disabled:opacity-40`}
          style={{ animationDelay: `${i * 45}ms` }}
        >
          {card}
        </button>
      ))}
    </div>
  );
}

export function ResultsBar({ room }) {
  const counts = distribution(room);
  const avg = averageEstimate(room);
  const max = maxWeight();
  return (
    <div className="w-full space-y-2 rounded-2xl bg-slate-800/60 p-4">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-slate-300">Results</h3>
        <span className="text-xs text-slate-400">
          average {avg ?? '—'}
        </span>
      </div>
      <div className="flex items-end gap-1.5">
        {DECK.filter((c) => counts[c] > 0).map((card) => {
          const h = 30 + (cardWeight(card) / max) * 60;
          return (
            <div key={card} className="flex flex-1 flex-col items-center gap-1">
              <span className="text-[10px] text-slate-300">{counts[card]}</span>
              <div
                className="w-full rounded-t bg-sky-400/80"
                style={{ height: `${h}px` }}
              />
              <span className="text-[10px] font-bold text-slate-200">
                {card}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
