import { overviewHref } from "../../shared/routes.ts";

/** An address that names nothing we have: say what was asked for, and the way back. */
export function NotFound({ what }: { what: string }) {
  return (
    <div className="page not-found" data-page="notFound">
      <h1>Not found</h1>
      <p>There is no {what} here. It may be in another pack or version, or not recorded yet.</p>
      <p><a href={overviewHref()}>Back to the overview</a></p>
    </div>
  );
}
