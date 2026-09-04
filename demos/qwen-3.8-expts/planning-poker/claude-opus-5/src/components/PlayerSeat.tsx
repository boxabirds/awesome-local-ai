import type { PublicPlayer } from "../../shared/protocol";
import { PlayedCard } from "./Card";

const AVATAR_HUES = [12, 45, 95, 155, 195, 235, 280, 320];

/** Deterministic hue per player, so the same person keeps the same colour. */
function hueFor(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_HUES[hash % AVATAR_HUES.length];
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

interface Props {
  player: PublicPlayer;
  revealed: boolean;
  isYou: boolean;
  /** Set when this player matched the agreed estimate. */
  agreed: boolean;
  canManage: boolean;
  onKick: (playerId: string) => void;
  onPromote: (playerId: string) => void;
}

export function PlayerSeat({
  player,
  revealed,
  isYou,
  agreed,
  canManage,
  onKick,
  onPromote,
}: Props) {
  const hue = hueFor(player.id);
  const waiting = !revealed && !player.hasVoted && player.role === "voter";

  return (
    <div className="group flex w-24 flex-col items-center gap-2 animate-pop-in">
      {player.role === "spectator" ? (
        <div
          className="grid h-20 w-14 place-items-center rounded-[--radius-card] border border-dashed border-ink-700 text-[0.6rem] uppercase tracking-widest text-ink-400"
          aria-label="Spectator, not voting"
        >
          watching
        </div>
      ) : (
        <PlayedCard
          value={player.vote}
          revealed={revealed}
          hasVoted={player.hasVoted}
          highlight={agreed}
        />
      )}

      <div className="flex flex-col items-center gap-1">
        <div className="relative">
          <span
            className={`grid h-8 w-8 place-items-center rounded-full text-xs font-semibold text-ink-950 ${
              waiting ? "animate-pulse-ring" : ""
            } ${player.connected ? "" : "opacity-40 grayscale"}`}
            style={{ background: `hsl(${hue} 70% 62%)` }}
          >
            {initials(player.name)}
          </span>
          {player.isFacilitator && (
            <span
              title="Facilitator"
              aria-label="Facilitator"
              className="absolute -right-1 -top-1 grid h-4 w-4 place-items-center rounded-full bg-amber-brand text-[0.55rem] text-ink-950"
            >
              ★
            </span>
          )}
        </div>

        <span
          className={`max-w-24 truncate text-xs ${
            isYou ? "font-semibold text-ink-100" : "text-ink-300"
          }`}
          title={player.name}
        >
          {player.name}
          {isYou && " (you)"}
        </span>

        {canManage && !isYou && (
          <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            <button
              type="button"
              onClick={() => onPromote(player.id)}
              className="focus-ring rounded px-1 text-[0.6rem] text-ink-400 hover:text-amber-brand"
              title="Hand over facilitation"
            >
              promote
            </button>
            <button
              type="button"
              onClick={() => onKick(player.id)}
              className="focus-ring rounded px-1 text-[0.6rem] text-ink-400 hover:text-rose-brand"
              title="Remove from room"
            >
              remove
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
