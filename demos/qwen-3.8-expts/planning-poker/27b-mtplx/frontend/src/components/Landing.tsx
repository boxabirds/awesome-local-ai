import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { createGame } from "../api";
import { FIBONACCI_DECK } from "../../../src/rules";

export default function Landing() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const gameId = await createGame();
      sessionStorage.setItem(`pp-name-${gameId}`, trimmed);
      navigate(`/game/${gameId}`);
    } catch {
      setError("Could not create a game. Please try again.");
      setBusy(false);
    }
  }

  return (
    <div className="landing">
      <div className="landing-card">
        <div className="landing-logo" aria-hidden>
          <span className="card-face">
            <span className="card-corner">A</span>
            <span className="card-pip">♠</span>
          </span>
          <span className="card-face gold">
            <span className="card-corner">K</span>
            <span className="card-pip">♦</span>
          </span>
        </div>
        <h1>Planning Poker</h1>
        <p className="subtitle">Estimate story points together, one issue at a time.</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void start();
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
          <button className="btn btn-primary" type="submit" disabled={!name.trim() || busy}>
            {busy ? "Creating…" : "Start a new game"}
          </button>
        </form>
        {error && <div className="banner banner-error">{error}</div>}
        <p className="deck-hint">
          Deck: {FIBONACCI_DECK.join(" · ")}
        </p>
      </div>
    </div>
  );
}
