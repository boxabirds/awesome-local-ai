import type { CSSProperties } from "react";
import { FIBONACCI_DECK } from "../../../src/rules";

interface Props {
  selected: number | null;
  onSelect: (value: number) => void;
}

export default function CardDeck({ selected, onSelect }: Props) {
  const mid = (FIBONACCI_DECK.length - 1) / 2;
  return (
    <div className="cards">
      {FIBONACCI_DECK.map((value, i) => (
        <button
          key={value}
          type="button"
          className={`card ${selected === value ? "card-selected" : ""}`}
          style={{ "--fan": i - mid } as CSSProperties}
          onClick={() => onSelect(value)}
          aria-label={`Vote ${value}`}
          aria-pressed={selected === value}
        >
          <span className={`card-corner ${value % 2 === 0 ? "red" : "black"}`}>{value}</span>
          <span className={`card-pip ${value % 2 === 0 ? "red" : "black"}`}>{value}</span>
        </button>
      ))}
    </div>
  );
}
