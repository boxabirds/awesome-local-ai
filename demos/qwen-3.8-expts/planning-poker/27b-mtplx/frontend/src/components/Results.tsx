import type { GameState } from "../../../src/types";

interface Props {
  state: GameState;
  isFacilitator: boolean;
  onRevote: () => void;
  onNext: () => void;
}

export default function Results({ state, isFacilitator, onRevote, onNext }: Props) {
  const values = Object.values(state.players)
    .map((p) => p.vote)
    .filter((v): v is number => v !== null);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const consensus = min === max;

  return (
    <div className="results">
      <div className={`consensus-badge ${consensus ? "ok" : "warn"}`}>
        {consensus ? `Consensus: ${min}` : `No consensus (min ${min}, max ${max})`}
      </div>
      <div className="stats">
        <div>
          <span>Mean</span>
          <b>{mean.toFixed(1)}</b>
        </div>
        <div>
          <span>Spread</span>
          <b>{max - min}</b>
        </div>
        <div>
          <span>Round</span>
          <b>{state.round}</b>
        </div>
      </div>
      {isFacilitator ? (
        <div className="actions">
          {!consensus && (
            <button className="btn btn-secondary" onClick={onRevote}>
              Re-vote
            </button>
          )}
          <button className="btn btn-primary" onClick={onNext}>
            Next issue
          </button>
        </div>
      ) : (
        <p className="hint">Waiting for the facilitator…</p>
      )}
    </div>
  );
}
