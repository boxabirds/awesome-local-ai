import { useState } from "react";
import type { PlayerRole } from "../../shared/protocol";
import { LIMITS } from "../../shared/protocol";

interface Props {
  roomCode: string;
  initialName: string;
  initialRole: PlayerRole;
  onJoin: (name: string, role: PlayerRole) => void;
}

/** Nothing connects until the player says who they are — no anonymous ghosts on the table. */
export function JoinGate({ roomCode, initialName, initialRole, onJoin }: Props) {
  const [name, setName] = useState(initialName);
  const [role, setRole] = useState<PlayerRole>(initialRole);

  const trimmed = name.trim();

  return (
    <div className="grid min-h-full place-items-center px-4 py-16">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (trimmed) onJoin(trimmed, role);
        }}
        className="w-full max-w-sm rounded-2xl border border-ink-800 bg-ink-900/80 p-6 shadow-2xl shadow-black/40"
      >
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-ink-400">
          Room {roomCode}
        </p>
        <h1 className="mt-2 font-display text-2xl font-semibold">Take a seat</h1>

        <label className="mt-6 block text-xs font-medium text-ink-300" htmlFor="join-name">
          What should the room call you?
        </label>
        <input
          id="join-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={LIMITS.MAX_NAME_LENGTH}
          autoFocus
          autoComplete="nickname"
          placeholder="Sam"
          className="focus-ring mt-1.5 w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-2.5 text-sm text-ink-100 placeholder:text-ink-600"
        />

        <fieldset className="mt-5">
          <legend className="text-xs font-medium text-ink-300">Joining as</legend>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {(["voter", "spectator"] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setRole(option)}
                aria-pressed={role === option}
                className={`focus-ring rounded-lg border px-3 py-2 text-xs font-medium transition ${
                  role === option
                    ? "border-amber-brand bg-amber-brand/10 text-amber-brand"
                    : "border-ink-700 text-ink-300 hover:border-ink-600"
                }`}
              >
                {option === "voter" ? "Estimator" : "Observer"}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[0.7rem] leading-relaxed text-ink-400">
            {role === "voter"
              ? "You play a card each round and count towards the reveal."
              : "You watch the table but never hold up a number."}
          </p>
        </fieldset>

        <button
          type="submit"
          disabled={!trimmed}
          className="focus-ring mt-6 w-full rounded-lg bg-amber-brand px-4 py-2.5 text-sm font-semibold text-ink-950 transition hover:bg-amber-deep disabled:cursor-not-allowed disabled:opacity-40"
        >
          Join the room
        </button>
      </form>
    </div>
  );
}
