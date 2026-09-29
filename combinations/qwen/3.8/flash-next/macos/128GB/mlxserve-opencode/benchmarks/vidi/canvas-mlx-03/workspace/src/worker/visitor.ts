// Who a request is, for the rate limits that are not per board (story 5's board creation,
// story 12's image uploads).
//
// The platform sets `CF-Connecting-IP` on every request that came through it. A local
// `wrangler dev` has no such header, and the choice made here is what that means for the
// limit: requests without one share a single bucket, rather than each getting a fresh key and
// the limit being invisible in development. That is also why the tests name their visitors
// explicitly — a suite that shares one bucket cannot test a limit.

/** The key a per-visitor limit is applied to. */
export function visitorKey(request: Request): string {
  return request.headers.get('CF-Connecting-IP') ?? 'local-visitor';
}
