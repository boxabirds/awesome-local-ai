import { useState } from "react";
import { DECKS } from "../../shared/decks";
import type { RoomSnapshot } from "../../shared/protocol";
import { LIMITS } from "../../shared/protocol";
import type { ConnectionStatus } from "../lib/useRoom";

const COPY_FEEDBACK_MS = 1600;

interface Props {
  room: RoomSnapshot;
  status: ConnectionStatus;
  isFacilitator: boolean;
  isSpectator: boolean;
  onRenameRoom: (name: string) => void;
  onSetDeck: (deckId: string) => void;
  onToggleAutoReveal: (enabled: boolean) => void;
  onToggleRole: () => void;
}

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connecting: "Connecting",
  open: "Live",
  reconnecting: "Reconnecting",
  kicked: "Removed",
  closed: "Offline",
};

export function RoomHeader({
  room,
  status,
  isFacilitator,
  isSpectator,
  onRenameRoom,
  onSetDeck,
  onToggleAutoReveal,
  onToggleRole,
}: Props) {
  const [copied, setCopied] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState(room.name);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), COPY_FEEDBACK_MS);
    } catch {
      // Clipboard blocked; the URL bar still holds the link.
    }
  };

  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-850 px-4 py-3 sm:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <a href="/" className="focus-ring font-display text-sm font-semibold text-ink-100">
          Pointing<span className="text-amber-brand">Poker</span>
        </a>

        <span className="h-4 w-px bg-ink-700" />

        {editingName && isFacilitator ? (
          <input
            value={draftName}
            autoFocus
            maxLength={LIMITS.MAX_ROOM_NAME_LENGTH}
            onChange={(e) => setDraftName(e.target.value)}
            onBlur={() => {
              onRenameRoom(draftName);
              setEditingName(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") {
                setDraftName(room.name);
                setEditingName(false);
              }
            }}
            className="focus-ring rounded border border-ink-700 bg-ink-950 px-2 py-1 text-sm"
          />
        ) : (
          <button
            type="button"
            disabled={!isFacilitator}
            onClick={() => {
              setDraftName(room.name);
              setEditingName(true);
            }}
            className="focus-ring truncate text-sm text-ink-300 disabled:cursor-default hover:text-ink-100"
            title={isFacilitator ? "Rename this room" : undefined}
          >
            {room.name}
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.7rem] ${
            status === "open" ? "text-ink-400" : "bg-rose-brand/10 text-rose-brand"
          }`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              status === "open" ? "bg-teal-brand" : "bg-rose-brand"
            }`}
          />
          {STATUS_LABEL[status]}
        </span>

        {isFacilitator && (
          <>
            <select
              value={room.deckId}
              onChange={(e) => onSetDeck(e.target.value)}
              className="focus-ring rounded-lg border border-ink-700 bg-ink-900 px-2.5 py-1.5 text-xs text-ink-100"
              aria-label="Card deck"
            >
              {DECKS.map((deck) => (
                <option key={deck.id} value={deck.id}>
                  {deck.label}
                </option>
              ))}
              {room.deckId === "custom" && <option value="custom">Custom</option>}
            </select>

            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-ink-300">
              <input
                type="checkbox"
                checked={room.autoReveal}
                onChange={(e) => onToggleAutoReveal(e.target.checked)}
                className="focus-ring accent-amber-brand"
              />
              Auto-reveal
            </label>
          </>
        )}

        <button
          type="button"
          onClick={onToggleRole}
          className="focus-ring rounded-lg border border-ink-700 px-2.5 py-1.5 text-xs text-ink-300 transition hover:border-ink-600 hover:text-ink-100"
        >
          {isSpectator ? "Start estimating" : "Just watch"}
        </button>

        <button
          type="button"
          onClick={copyLink}
          className="focus-ring rounded-lg bg-ink-100 px-3 py-1.5 text-xs font-semibold text-ink-950 transition hover:bg-white"
        >
          {copied ? "Link copied" : "Invite"}
        </button>
      </div>
    </header>
  );
}
