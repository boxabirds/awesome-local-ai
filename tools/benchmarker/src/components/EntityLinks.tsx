// The one way an entity is named on the page: a link to its own page, the same text everywhere. Combination names
// are short labels with the full id on hover. A run is always shown with its combination unless the context has it.
import { useEffect, useState, type ReactNode } from "react";
import type { Invalid } from "../../shared/types.ts";
import { combinationHref, machineHref, overviewHref, runHref, storyHref, storyRunHref } from "../../shared/routes.ts";
import { invalidTip } from "../../shared/runView.ts";
import { useHeightVar } from "../useHeightVar.ts";

export function CombinationLink({ pack, stack, label }: { pack: string; stack: string; label: string }) {
  return <a className="entity combination-link" href={combinationHref(pack, stack)} data-tip={stack}>{label}</a>;
}

/** A run: "v2-r2", or with its combination ("3.8-swift-1.5/27b llamacpp v2-r2") where the context doesn't say. An
 * invalid run is struck through, with why on hover, wherever it is named. */
export function RunLink({ pack, stack, runId, label, invalid }: { pack: string; stack: string; runId: string; label?: string; invalid?: Invalid | null }) {
  return (
    <a className={`entity run-link${invalid ? " invalid-run" : ""}`} href={runHref(pack, stack, runId)} data-invalid={invalid ? "true" : undefined}
      data-tip={invalid ? `${stack} · ${runId}. ${invalidTip(invalid)}` : `${stack} · ${runId}`}>
      {label ? <span className="stack-label">{label} </span> : null}<b>{runId}</b>{invalid ? <span className="sr-only"> (invalid)</span> : null}
    </a>
  );
}

/** A machine (a dbench node, or a host no node answered for), with its hardware on hover when known. */
export function MachineLink({ machine, host }: { machine: string; host?: string }) {
  return <a className="entity machine-link" href={machineHref(machine)} data-tip={host || undefined}>{machine}</a>;
}

/** A story of a pack: every combination's attempt at it. */
export function StoryLink({ pack, story, children }: { pack: string; story: string; children?: ReactNode }) {
  return <a className="entity story-link" href={storyHref(pack, story)}>{children ?? `story ${Number(story)}`}</a>;
}

/** One run's work on one story; struck through, with why on hover, when its run is invalid. */
export function StoryRunLink({ pack, stack, runId, story, children, invalid }: { pack: string; stack: string; runId: string; story: string; children?: ReactNode; invalid?: Invalid | null }) {
  return (
    <a className={`entity story-run-link${invalid ? " invalid-run" : ""}`} href={storyRunHref(pack, stack, runId, story)}
      data-invalid={invalid ? "true" : undefined} data-tip={invalid ? invalidTip(invalid) : undefined}>
      {children ?? `story ${Number(story)}`}
    </a>
  );
}

export interface Crumb { label: ReactNode; href?: string }

/** Whether the window has scrolled at all: the page is then passing under what is pinned to its top. */
function useScrolled(): boolean {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const read = () => setScrolled(scrollY > 0);
    read();
    addEventListener("scroll", read, { passive: true });
    return () => removeEventListener("scroll", read);
  }, []);
  return scrolled;
}

/** Where this page sits: Overview › combination › run › story. The last crumb is the page itself. It stays pinned
 * under the app's top bar while the page scrolls (styles.css), with a line under it once the page is beneath it. */
export function Breadcrumb({ trail }: { trail: Crumb[] }) {
  const all: Crumb[] = [{ label: "Overview", href: overviewHref() }, ...trail];
  const nav = useHeightVar<HTMLElement>("--crumb-h");
  const stuck = useScrolled();
  return (
    <nav ref={nav} className="breadcrumb" aria-label="Breadcrumb" data-stuck={stuck ? "true" : undefined}>
      {all.map((c, i) => (
        <span key={i}>
          {i > 0 ? <span className="sep" aria-hidden="true"> › </span> : null}
          {c.href && i < all.length - 1 ? <a href={c.href}>{c.label}</a> : <span aria-current={i === all.length - 1 ? "page" : undefined}>{c.label}</span>}
        </span>
      ))}
    </nav>
  );
}
