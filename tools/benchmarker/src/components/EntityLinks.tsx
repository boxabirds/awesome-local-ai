// The one way an entity is named on the page: a link to its own page, the same text everywhere. Combination names
// are short labels with the full id on hover. A run is always shown with its combination unless the context has it.
import { useEffect, useState, type ReactNode } from "react";
import { combinationHref, machineHref, runHref, storyHref, storyRunHref, titleFor, trailFor, type Route, type TrailNames } from "../../shared/routes.ts";
import { useHeightVar } from "../useHeightVar.ts";

export function CombinationLink({ pack, stack, label }: { pack: string; stack: string; label: string }) {
  return <a className="entity combination-link" href={combinationHref(pack, stack)} data-tip={stack}>{label}</a>;
}

/** A run: "v2-r2", or with its combination ("3.8-swift-1.5/27b llamacpp v2-r2") where the context doesn't say. */
export function RunLink({ pack, stack, runId, label }: { pack: string; stack: string; runId: string; label?: string }) {
  return (
    <a className="entity run-link" href={runHref(pack, stack, runId)} data-tip={`${stack} · ${runId}`}>
      {label ? <span className="stack-label">{label} </span> : null}<b>{runId}</b>
    </a>
  );
}

/** A machine (a node, or a host no node answered for), with its hardware on hover when known. */
export function MachineLink({ machine, host }: { machine: string; host?: string }) {
  return <a className="entity machine-link" href={machineHref(machine)} data-tip={host || undefined}>{machine}</a>;
}

/** A story of a pack: every combination's attempt at it. */
export function StoryLink({ pack, story, children }: { pack: string; story: string; children?: ReactNode }) {
  return <a className="entity story-link" href={storyHref(pack, story)}>{children ?? `story ${Number(story)}`}</a>;
}

/** One run's work on one story. */
export function StoryRunLink({ pack, stack, runId, story, children }: { pack: string; stack: string; runId: string; story: string; children?: ReactNode }) {
  return <a className="entity story-run-link" href={storyRunHref(pack, stack, runId, story)}>{children ?? `story ${Number(story)}`}</a>;
}

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

/** Where this page sits (routes.ts `trailFor`): Overview › … › the page itself, the last crumb, which has no link.
 * It stays pinned under the app's top bar while the page scrolls (styles.css), with a line under it once the page is
 * beneath it. The window's title is the same trail, nearest first. */
export function Breadcrumb({ route, names = {} }: { route: Route; names?: TrailNames }) {
  const all = trailFor(route, names);
  const nav = useHeightVar<HTMLElement>("--crumb-h");
  const stuck = useScrolled();
  const title = titleFor(all);
  useEffect(() => { document.title = title; }, [title]);
  if (!all.length) return null;
  return (
    <nav ref={nav} className="breadcrumb" aria-label="Breadcrumb" data-stuck={stuck ? "true" : undefined}>
      {all.map((c, i) => (
        <span key={i}>
          {i > 0 ? <span className="sep" aria-hidden="true"> › </span> : null}
          {c.href ? <a className={c.cls ? `entity ${c.cls}` : undefined} href={c.href} data-tip={c.tip}>{c.label}</a> : <span aria-current={i === all.length - 1 ? "page" : undefined}>{c.label}</span>}
        </span>
      ))}
    </nav>
  );
}
