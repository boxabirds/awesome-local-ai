import type { GameState } from "../../../src/types";

export default function RevealGrid({ state }: { state: GameState }) {
  const players = Object.values(state.players);
  return (
    <div className="reveal">
      {players.map((p, i) => (
        <div className="reveal-slot" key={p.id}>
          <div
            className={`card card-static ${p.vote === null ? "card-hidden" : ""}`}
            style={{ animationDelay: `${i * 90}ms` }}
          >
            <span className="card-pip">{p.vote ?? "?"}</span>
          </div>
          <span className="reveal-name">{p.name}</span>
        </div>
      ))}
    </div>
  );
}
