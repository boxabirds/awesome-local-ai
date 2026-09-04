import { useEffect, useMemo, useState } from "react";
import type { PlayerRole } from "../../shared/protocol";
import { HandCard } from "../components/Card";
import { IssuesPanel } from "../components/IssuesPanel";
import { JoinGate } from "../components/JoinGate";
import { PokerTable } from "../components/PokerTable";
import { RoomHeader } from "../components/RoomHeader";
import { saveName, saveRole, savedName, savedRole } from "../lib/identity";
import { useRoom } from "../lib/useRoom";

/** Fans the hand out slightly, so a long deck still reads as cards rather than a toolbar. */
const FAN_DEGREES_PER_CARD = 1.1;

interface Props {
  code: string;
}

export function RoomPage({ code }: Props) {
  const [name, setName] = useState(savedName());
  const [role, setRole] = useState<PlayerRole>(savedRole());
  const [joined, setJoined] = useState(savedName().length > 0);

  const { room, youId, status, error, send } = useRoom({ code, name, role, enabled: joined });

  const you = useMemo(
    () => room?.players.find((p) => p.id === youId) ?? null,
    [room, youId],
  );
  const isFacilitator = you?.isFacilitator ?? false;
  const isSpectator = you?.role === "spectator";

  const agreedCard = useMemo(() => {
    if (!room?.revealed || !room.stats) return null;
    const top = [...room.stats.distribution].sort((a, b) => b.count - a.count)[0];
    return top && top.count > 1 ? top.card : null;
  }, [room]);

  // Keyboard shortcuts: number keys play the matching card, R reveals, N starts a round.
  useEffect(() => {
    if (!room || !joined) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;

      if (event.key.toLowerCase() === "r" && isFacilitator && !room.revealed) {
        send({ t: "reveal" });
      } else if (event.key.toLowerCase() === "n" && isFacilitator && room.revealed) {
        send({ t: "newRound" });
      } else {
        const index = Number(event.key) - 1;
        if (Number.isInteger(index) && index >= 0 && index < room.cards.length && !isSpectator) {
          send({ t: "vote", value: room.cards[index] });
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [room, joined, isFacilitator, isSpectator, send]);

  useEffect(() => {
    document.title = room ? `${room.name} · Pointing Poker` : "Pointing Poker";
  }, [room]);

  if (!joined) {
    return (
      <JoinGate
        roomCode={code}
        initialName={name}
        initialRole={role}
        onJoin={(chosenName, chosenRole) => {
          setName(chosenName);
          setRole(chosenRole);
          saveName(chosenName);
          saveRole(chosenRole);
          setJoined(true);
        }}
      />
    );
  }

  if (status === "kicked") {
    return (
      <div className="grid min-h-full place-items-center px-4 text-center">
        <div>
          <h1 className="font-display text-2xl font-semibold">You were removed from this room</h1>
          <p className="mt-2 text-sm text-ink-400">
            The facilitator closed your seat. Ask them for a fresh invite.
          </p>
          <a
            href="/"
            className="focus-ring mt-6 inline-block rounded-lg bg-ink-100 px-4 py-2 text-sm font-semibold text-ink-950"
          >
            Start a new room
          </a>
        </div>
      </div>
    );
  }

  if (!room) {
    return (
      <div className="grid min-h-full place-items-center text-sm text-ink-400">
        Dealing you in…
      </div>
    );
  }

  const activeIssue = room.issues.find((i) => i.id === room.activeIssueId) ?? null;
  const middleCard = (room.cards.length - 1) / 2;

  const toggleRole = () => {
    const next: PlayerRole = isSpectator ? "voter" : "spectator";
    setRole(next);
    saveRole(next);
    send({ t: "setRole", role: next });
  };

  return (
    <div className="flex min-h-full flex-col">
      <RoomHeader
        room={room}
        status={status}
        isFacilitator={isFacilitator}
        isSpectator={isSpectator}
        onRenameRoom={(value) => send({ t: "setRoomName", name: value })}
        onSetDeck={(deckId) => send({ t: "setDeck", deckId })}
        onToggleAutoReveal={(enabled) => send({ t: "setAutoReveal", enabled })}
        onToggleRole={toggleRole}
      />

      {error && (
        <p className="bg-rose-brand/10 px-6 py-2 text-center text-xs text-rose-brand">{error}</p>
      )}

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-5 lg:flex-row lg:px-6">
        <div className="flex flex-1 flex-col gap-6">
          <div className="text-center">
            <p className="text-[0.65rem] uppercase tracking-[0.2em] text-ink-400">
              Round {room.roundNumber} · {room.deckLabel}
            </p>
            <h1 className="mt-1 font-display text-xl font-semibold text-ink-100 sm:text-2xl">
              {activeIssue ? (
                <>
                  {activeIssue.key && (
                    <span className="mr-2 font-mono text-sm text-ink-400">{activeIssue.key}</span>
                  )}
                  {activeIssue.title}
                </>
              ) : (
                "What are we sizing?"
              )}
            </h1>
          </div>

          <PokerTable
            room={room}
            youId={youId}
            isFacilitator={isFacilitator}
            agreedCard={agreedCard}
            onReveal={() => send({ t: "reveal" })}
            onNewRound={() => send({ t: "newRound" })}
            onKick={(playerId) => send({ t: "kick", playerId })}
            onPromote={(playerId) => send({ t: "makeFacilitator", playerId })}
          />

          {isSpectator ? (
            <p className="text-center text-xs text-ink-400">
              You are observing. Switch to estimating whenever you want a card.
            </p>
          ) : (
            <div className="flex items-end justify-center gap-2 overflow-x-auto px-2 pb-3 pt-2">
              {room.cards.map((card, index) => (
                <HandCard
                  key={card}
                  value={card}
                  selected={you?.vote === card}
                  disabled={room.revealed}
                  onSelect={(value) => send({ t: "vote", value })}
                  style={{
                    transform: `rotate(${(index - middleCard) * FAN_DEGREES_PER_CARD}deg)`,
                  }}
                />
              ))}
            </div>
          )}
        </div>

        <IssuesPanel
          issues={room.issues}
          activeIssueId={room.activeIssueId}
          canManage={isFacilitator}
          revealed={room.revealed}
          onAdd={(issues) => send({ t: "addIssues", issues })}
          onRemove={(issueId) => send({ t: "removeIssue", issueId })}
          onSetActive={(issueId) => send({ t: "setActiveIssue", issueId })}
          onCommit={() => send({ t: "commitEstimate" })}
        />
      </main>
    </div>
  );
}
