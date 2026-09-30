// The one way an entity is named on the page: a link to its own page, the same text everywhere. Combination names
// are short labels with the full id on hover. A run is always shown with its combination unless the context has it.
import type { ReactNode } from "react";
import { combinationHref, overviewHref, runHref, storyRunHref } from "../../shared/routes.ts";

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

/** One run's work on one story. */
export function StoryRunLink({ pack, stack, runId, story, children }: { pack: string; stack: string; runId: string; story: string; children?: ReactNode }) {
  return <a className="entity story-run-link" href={storyRunHref(pack, stack, runId, story)}>{children ?? `story ${Number(story)}`}</a>;
}

export interface Crumb { label: ReactNode; href?: string }

/** Where this page sits: Overview › combination › run › story. The last crumb is the page itself. */
export function Breadcrumb({ trail }: { trail: Crumb[] }) {
  const all: Crumb[] = [{ label: "Overview", href: overviewHref() }, ...trail];
  return (
    <nav className="breadcrumb" aria-label="Breadcrumb">
      {all.map((c, i) => (
        <span key={i}>
          {i > 0 ? <span className="sep" aria-hidden="true"> › </span> : null}
          {c.href && i < all.length - 1 ? <a href={c.href}>{c.label}</a> : <span aria-current={i === all.length - 1 ? "page" : undefined}>{c.label}</span>}
        </span>
      ))}
    </nav>
  );
}
