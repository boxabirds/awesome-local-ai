import { useState } from "react";
import { DECKS, DEFAULT_DECK_ID } from "../../shared/decks";
import { LIMITS } from "../../shared/protocol";

const ROOM_CODE_INPUT_PATTERN = /[^a-z0-9-]/g;

export function Landing() {
  const [name, setName] = useState("");
  const [deckId, setDeckId] = useState(DEFAULT_DECK_ID);
  const [joinCode, setJoinCode] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createRoom = async () => {
    setCreating(true);
    setError(null);
    try {
      const response = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, deckId }),
      });
      if (!response.ok) throw new Error(`Server said ${response.status}`);
      const room = (await response.json()) as { code: string };
      location.assign(`/room/${room.code}`);
    } catch (cause) {
      setError(`Could not open a room (${String(cause)})`);
      setCreating(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col px-5 py-6">
      <header className="flex items-center justify-between">
        <span className="font-display text-base font-semibold">
          Pointing<span className="text-amber-brand">Poker</span>
        </span>
        <a
          href="https://en.wikipedia.org/wiki/Planning_poker"
          target="_blank"
          rel="noreferrer"
          className="focus-ring text-xs text-ink-400 hover:text-ink-100"
        >
          What is planning poker?
        </a>
      </header>

      <main className="flex flex-1 flex-col justify-center gap-12 py-12 lg:flex-row lg:items-center lg:gap-16">
        <section className="max-w-md">
          <h1 className="font-display text-4xl font-semibold leading-tight sm:text-5xl">
            Estimate together,
            <br />
            <span className="text-amber-brand">decide faster.</span>
          </h1>
          <p className="mt-5 text-sm leading-relaxed text-ink-300">
            Everyone plays a card at the same time, nobody sees anyone else&rsquo;s number until
            the reveal, and the loudest voice in the room stops setting the estimate. Share a link
            — no accounts, no installs.
          </p>

          <ul className="mt-8 flex flex-col gap-3 text-sm text-ink-300">
            {[
              "Hidden votes, revealed in one flip",
              "Fibonacci, T-shirts, powers of two, or your own deck",
              "Walk a backlog ticket by ticket and export the results",
              "Reconnects cleanly when someone's train goes into a tunnel",
            ].map((line) => (
              <li key={line} className="flex gap-3">
                <span aria-hidden className="mt-1 text-amber-brand">
                  ◆
                </span>
                {line}
              </li>
            ))}
          </ul>
        </section>

        <section className="w-full max-w-sm rounded-2xl border border-ink-800 bg-ink-900/70 p-6 shadow-2xl shadow-black/40">
          <h2 className="font-display text-lg font-semibold">Open a room</h2>

          <label className="mt-5 block text-xs font-medium text-ink-300" htmlFor="room-name">
            Session name
          </label>
          <input
            id="room-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={LIMITS.MAX_ROOM_NAME_LENGTH}
            placeholder="Sprint 42 refinement"
            className="focus-ring mt-1.5 w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-2.5 text-sm placeholder:text-ink-600"
          />

          <label className="mt-4 block text-xs font-medium text-ink-300" htmlFor="room-deck">
            Deck
          </label>
          <select
            id="room-deck"
            value={deckId}
            onChange={(e) => setDeckId(e.target.value)}
            className="focus-ring mt-1.5 w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-2.5 text-sm"
          >
            {DECKS.map((deck) => (
              <option key={deck.id} value={deck.id}>
                {deck.label} — {deck.values.slice(0, 5).join(" ")}…
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={createRoom}
            disabled={creating}
            className="focus-ring mt-6 w-full rounded-lg bg-amber-brand px-4 py-3 text-sm font-semibold text-ink-950 transition hover:bg-amber-deep disabled:opacity-50"
          >
            {creating ? "Shuffling…" : "Deal me in"}
          </button>

          {error && <p className="mt-3 text-xs text-rose-brand">{error}</p>}

          <div className="my-6 flex items-center gap-3 text-[0.65rem] uppercase tracking-widest text-ink-600">
            <span className="h-px flex-1 bg-ink-800" />
            or join
            <span className="h-px flex-1 bg-ink-800" />
          </div>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (joinCode) location.assign(`/room/${joinCode}`);
            }}
            className="flex gap-2"
          >
            <input
              value={joinCode}
              onChange={(e) =>
                setJoinCode(e.target.value.toLowerCase().replace(ROOM_CODE_INPUT_PATTERN, ""))
              }
              placeholder="abc-def-ghi"
              aria-label="Room code"
              className="focus-ring w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-2.5 font-mono text-sm placeholder:text-ink-600"
            />
            <button
              type="submit"
              className="focus-ring shrink-0 rounded-lg border border-ink-700 px-4 text-sm text-ink-300 transition hover:border-ink-600 hover:text-ink-100"
            >
              Go
            </button>
          </form>
        </section>
      </main>

      <footer className="border-t border-ink-850 pt-4 text-[0.7rem] text-ink-600">
        Rooms are ephemeral. Anyone with the link can join, so treat a room code like a meeting
        link.
      </footer>
    </div>
  );
}
