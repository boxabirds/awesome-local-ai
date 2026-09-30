// A heading or label from the glossary, with its definition on hover: one name and one meaning per measure.
import type { ReactNode } from "react";
import { GLOSSARY, type TermId } from "../../../shared/glossary.ts";

export const termTip = (id: TermId) => GLOSSARY[id].what;
export const termName = (id: TermId) => GLOSSARY[id].name;

export function Term({ id, children, className }: { id: TermId; children?: ReactNode; className?: string }) {
  return <span className={className ? `term ${className}` : "term"} data-tip={GLOSSARY[id].what}>{children ?? GLOSSARY[id].name}</span>;
}

/** "—" for a number we don't have, with why on hover: never a 0 that looks like a measurement. */
export function Missing({ why }: { why: string }) {
  return <span className="missing" tabIndex={0} data-tip={why}>—</span>;
}
