import type { PublicPlayer, RoomSnapshot } from "../../shared/protocol";
import { PlayerSeat } from "./PlayerSeat";
import { Results } from "./Results";

interface Props {
  room: RoomSnapshot;
  youId: string | null;
  isFacilitator: boolean;
  agreedCard: string | null;
  onReveal: () => void;
  onNewRound: () => void;
  onKick: (playerId: string) => void;
  onPromote: (playerId: string) => void;
}

/** Seats the players around the felt, alternating so both rows fill evenly. */
function splitSeats(players: PublicPlayer[]): [PublicPlayer[], PublicPlayer[]] {
  const top: PublicPlayer[] = [];
  const bottom: PublicPlayer[] = [];
  players.forEach((player, index) => (index % 2 === 0 ? top : bottom).push(player));
  return [top, bottom];
}

export function PokerTable({
  room,
  youId,
  isFacilitator,
  agreedCard,
  onReveal,
  onNewRound,
  onKick,
  onPromote,
}: Props) {
  const [topRow, bottomRow] = splitSeats(room.players);
  const voters = room.players.filter((p) => p.role === "voter" && p.connected);
  const votedCount = voters.filter((p) => p.hasVoted).length;
  const everyoneIn = voters.length > 0 && votedCount === voters.length;

  const seatRow = (players: PublicPlayer[]) => (
    <div className="flex flex-wrap items-end justify-center gap-4">
      {players.map((player) => (
        <PlayerSeat
          key={player.id}
          player={player}
          revealed={room.revealed}
          isYou={player.id === youId}
          agreed={room.revealed && agreedCard !== null && player.vote === agreedCard}
          canManage={isFacilitator}
          onKick={onKick}
          onPromote={onPromote}
        />
      ))}
    </div>
  );

  return (
    <div className="flex flex-col items-center gap-5">
      {seatRow(topRow)}

      <div className="relative w-full max-w-2xl">
        <div className="rounded-[2.5rem] border border-felt-700/60 bg-linear-to-b from-felt-800 to-felt-900 px-6 py-7 shadow-[inset_0_2px_40px_rgba(0,0,0,0.45)]">
          <div className="flex min-h-32 flex-col items-center justify-center gap-4">
            {room.revealed ? (
              <>
                <Results stats={room.stats} />
                {isFacilitator && (
                  <button
                    type="button"
                    onClick={onNewRound}
                    className="focus-ring rounded-full bg-ink-100 px-6 py-2.5 text-sm font-semibold text-ink-950 transition hover:bg-white"
                  >
                    Next round
                  </button>
                )}
              </>
            ) : (
              <>
                <p className="text-sm text-ink-300">
                  {voters.length === 0
                    ? "Waiting for someone to take a seat"
                    : everyoneIn
                      ? "Everyone has played"
                      : `${votedCount} of ${voters.length} have played`}
                </p>
                {isFacilitator ? (
                  <button
                    type="button"
                    onClick={onReveal}
                    disabled={votedCount === 0}
                    className={`focus-ring rounded-full px-7 py-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
                      everyoneIn
                        ? "bg-amber-brand text-ink-950 shadow-[0_12px_36px_-10px_rgba(242,163,60,0.8)] hover:bg-amber-deep"
                        : "bg-ink-800 text-ink-100 hover:bg-ink-700"
                    }`}
                  >
                    Reveal cards
                  </button>
                ) : (
                  <p className="text-xs text-ink-400">
                    {everyoneIn
                      ? "Waiting for the facilitator to reveal"
                      : "Play a card when you have one in mind"}
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {seatRow(bottomRow)}
    </div>
  );
}
