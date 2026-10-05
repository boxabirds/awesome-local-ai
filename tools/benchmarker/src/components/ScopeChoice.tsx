// The pack and the version family: what the figures are over. The two choices travel together, because a figure means
// nothing without both. On the dashboard they sit in the ranking band's own heading, since that is all they scope;
// on an entity's page they are in the header, where they scope the whole page.
export interface ScopeChoiceProps {
  packs: string[];
  pack: string;
  families: string[];
  family: string;
  /** The pack's current version family, marked so a reader can see when they are looking at an older one. */
  currentFamily: string;
  onPack(pack: string): void;
  onFamily(family: string): void;
}

export function ScopeChoice({ packs, pack, families, family, currentFamily, onPack, onFamily }: ScopeChoiceProps) {
  return (
    <span className="scope-choice" data-scope>
      <label>
        Pack{" "}
        <select value={pack} onChange={(e) => onPack(e.target.value)} aria-label="Pack">
          {packs.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </label>
      <label>
        Version{" "}
        <select value={family} onChange={(e) => onFamily(e.target.value)} aria-label="Version">
          {families.map((f) => (
            <option key={f} value={f}>{f === "all" ? "all versions" : f}{f === currentFamily ? " (current)" : ""}</option>
          ))}
        </select>
      </label>
    </span>
  );
}
