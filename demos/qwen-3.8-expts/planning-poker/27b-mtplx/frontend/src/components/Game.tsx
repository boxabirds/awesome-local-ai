import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { GameClient } from "../api";
import type { GameState, Issue } from "../../../src/types";
import CardDeck from "./CardDeck";
import IssuesPanel from "./IssuesPanel";
import RevealGrid from "./RevealGrid";
import Results from "./Results";

const nameKey = (gameId: string) => `pp-name-${gameId}`;
const playerKey = (gameId: string) => `pp-player-${gameId}`;

export default function Game() {
  const { id = "" } = useParams();
  const [state, setState] = useState<GameState | null>(null);
  const [selfId, setSelfId] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [autoJoin, setAutoJoin] = useState(false);
  const [name, setName] = useState(() => sessionStorage.getItem(nameKey(id)) ?? "");
  const [error, setError] = useState<string | null>(null);
  const clientRef = useRef<GameClient | null>(null);
  const errorTimer = useRef<number | null>(null);

  const show = useCallback((message: string) => {
    setError(message);
    if (errorTimer.current) window.clearTimeout(errorTimer.current);
    errorTimer.current = window.setTimeout(() => setError(null), 4000);
  }, []);

  useEffect(() => {
    const client = new GameClient(id, {
      onState: (s) => setState(s),
      onJoined: (pid) => {
        sessionStorage.setItem(playerKey(id), pid);
        setSelfId(pid);
        setAutoJoin(false);
      },
      onJoinFailed: (message) => {
        setAutoJoin(false);
        show(message);
      },
      onError: (message) => show(message),
      onOpen: () => setConnected(true),
      onClose: () => setConnected(false),
    });
    clientRef.current = client;
    const savedName = sessionStorage.getItem(nameKey(id));
    const savedPlayer = sessionStorage.getItem(playerKey(id));
    if (savedName) {
      setAutoJoin(true);
      client.join(savedName, savedPlayer);
    } else {
      client.connect();
    }
    return () => {
      client.close();
      clientRef.current = null;
    };
  }, [id, show]);

  const send = useCallback((action: Record<string, unknown>) => {
    clientRef.current?.send(action);
  }, []);

  function join() {
    const trimmed = name.trim();
    if (!trimmed) return;
    sessionStorage.setItem(nameKey(id), trimmed);
    clientRef.current?.join(trimmed, sessionStorage.getItem(playerKey(id)));
  }

  if (!selfId) {
    if (autoJoin) {
      return <div className="center">{connected ? "Rejoining…" : "Connecting…"}</div>;
    }
    return (
      <div className="center">
        <div className="join-card">
          <h1>Join game</h1>
          <p className="subtitle">
            {connected ? "Connected. Enter your name to take your seat." : "Connecting to game…"}
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              join();
            }}
          >
            <label className="field">
              <span>Your name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Ada"
                maxLength={40}
                autoFocus
              />
            </label>
            <button className="btn btn-primary" type="submit" disabled={!name.trim()}>
              Join
            </button>
          </form>
          {error && <div className="banner banner-error">{error}</div>}
        </div>
      </div>
    );
  }

  if (!state) {
    return <div className="center">{connected ? "Loading…" : "Connecting…"}</div>;
  }

  const isFacilitator = state.facilitatorId === selfId;
  const currentIssue: Issue | null = state.issues.find((i) => i.id === state.currentIssueId) ?? null;
  const players = Object.values(state.players);
  const myVote = state.players[selfId]?.vote ?? null;
  const votedCount = players.filter((p) => p.vote !== null).length;

  return (
    <div className="game">
      <header className="topbar">
        <div className="brand">
          <span className="brand-suit" aria-hidden>♠</span> Planning Poker
        </div>
        <div className="topbar-right">
          {!connected && <span className="reconnecting">Reconnecting…</span>}
          <span className="pill">
            {players.length} player{players.length === 1 ? "" : "s"}
          </span>
          {isFacilitator && <span className="pill pill-gold">Facilitator</span>}
          <CopyButton gameId={id} />
        </div>
      </header>

      <div className="layout">
        <IssuesPanel
          state={state}
          isFacilitator={isFacilitator}
          onStart={(issueId) => send({ type: "startRound", issueId })}
          onAdd={(title, description) => send({ type: "addIssue", title, description })}
          onRemove={(issueId) => send({ type: "removeIssue", issueId })}
        />

        <main className="stage panel">
          {currentIssue && state.phase === "voting" ? (
            <>
              <IssueHeader issue={currentIssue} round={state.round} />
              <CardDeck selected={myVote} onSelect={(value) => send({ type: "vote", value })} />
              <p className="hint">
                {votedCount}/{players.length} voted — cards reveal when everyone has voted
              </p>
            </>
          ) : currentIssue && state.phase === "revealed" ? (
            <>
              <IssueHeader issue={currentIssue} round={state.round} />
              <RevealGrid state={state} />
              <Results
                state={state}
                isFacilitator={isFacilitator}
                onRevote={() => send({ type: "revote" })}
                onNext={() => send({ type: "nextIssue" })}
              />
            </>
          ) : (
            <Waiting
              isFacilitator={isFacilitator}
              hasIssues={state.issues.length > 0}
              playerCount={players.length}
              onStartQuickVote={() => send({ type: "startRound", issueId: null })}
            />
          )}
        </main>
      </div>

      {error && <div className="toast">{error}</div>}
    </div>
  );
}

function CopyButton({ gameId }: { gameId: string }) {
  const [copied, setCopied] = useState(false);
  const url = `${window.location.origin}/game/${gameId}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      window.prompt("Copy this game link:", url);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <button className="btn btn-ghost" onClick={() => void copy()}>
      {copied ? "Copied!" : "Copy invite link"}
    </button>
  );
}

function IssueHeader({ issue, round }: { issue: Issue; round: number }) {
  return (
    <div className="issue-head">
      <div className="round-tag">Round {round}</div>
      <h2>{issue.title}</h2>
      {issue.description && <p className="desc">{issue.description}</p>}
    </div>
  );
}

function Waiting({
  isFacilitator,
  hasIssues,
  playerCount,
  onStartQuickVote,
}: {
  isFacilitator: boolean;
  hasIssues: boolean;
  playerCount: number;
  onStartQuickVote: () => void;
}) {
  return (
    <div className="waiting">
      <div className="suits" aria-hidden>
        <span>♠</span>
        <span>♥</span>
        <span>♦</span>
        <span>♣</span>
      </div>
      <h2>{hasIssues ? "Waiting to start" : "Ready to vote"}</h2>
      <p>
        {isFacilitator
          ? "Start a quick vote now, or add an issue on the left and pick it to estimate."
          : "The facilitator will start a round shortly."}
      </p>
      {isFacilitator && playerCount >= 2 && (
        <button className="btn btn-primary" onClick={onStartQuickVote}>
          Start quick vote
        </button>
      )}
      {isFacilitator && playerCount < 2 && (
        <p className="hint">Invite at least one more player to start voting.</p>
      )}
    </div>
  );
}
