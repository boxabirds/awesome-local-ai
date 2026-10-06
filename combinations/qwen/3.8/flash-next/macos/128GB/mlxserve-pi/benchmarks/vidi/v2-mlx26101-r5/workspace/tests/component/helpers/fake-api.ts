/**
 * `fetch`, as a test can hold it.
 *
 * The pages under test talk to the board API, and what a test needs to say about that API is not
 * "it returned this" but "it refused, twice, and then answered" — with the calls counted, so that
 * a promise to retry can be told apart from a page that asked once and gave up. Stubbing the
 * global rather than mocking `src/client/api` keeps the sorting that file does (a 404 is an answer,
 * a 500 is not) inside what is being tested, which is the part a page depends on being true.
 */

import { vi } from 'vitest';

/** One request the page made. */
export interface ApiCall {
  method: string;
  url: string;
}

/**
 * How to answer one call: a `Response` as the service sends it, an `Error` as a network throws one,
 * a `Promise` for a call a test wants to hold open, or the shorthand for a JSON answer — which is
 * what this API mostly gives, and what a test should not have to build by hand every time.
 */
export type ApiAnswer = Response | Error | Promise<Response> | { status?: number; json?: unknown };

export interface FakeFetch {
  /** Every call the page made, in order, including the ones nothing was said about. */
  readonly calls: ApiCall[];
  /** The path of the nth call, without the origin jsdom invented. */
  path(index: number): string;
  /** Stops answering, so a call made after this point throws. */
  restore(): void;
}

/** Builds the `Response` a JSON answer stands for. */
function toResponse(answer: Exclude<ApiAnswer, Response | Error | Promise<Response>>): Response {
  const body = answer.json === undefined ? '' : JSON.stringify(answer.json);
  return new Response(body, {
    status: answer.status ?? 200,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * Answers the calls in the order the test listed them.
 *
 * A page that calls more often than the test provided answers gets an error rather than an
 * infinite supply of the last one: a retry loop that will not stop is exactly the bug a test like
 * this exists to catch, and repeating the final answer would hide it.
 */
export function stubFetch(...answers: ApiAnswer[]): FakeFetch {
  const calls: ApiCall[] = [];
  const queue = [...answers];
  let answering = true;

  const fake = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET').toUpperCase();
    calls.push({ method, url });
    if (!answering) throw new Error(`vidi6: fetch is no longer stubbed (${url})`);

    const answer = queue.shift();
    if (answer === undefined) {
      throw new Error(`vidi6: ${method} ${url} was called and the test said nothing about it`);
    }
    if (answer instanceof Error) throw answer;
    if (answer instanceof Promise) return answer;
    if (answer instanceof Response) return answer;
    return toResponse(answer);
  });

  vi.stubGlobal('fetch', fake);

  return {
    calls,
    path: (index: number) => new URL(calls[index]?.url ?? '', window.location.origin).pathname,
    restore: () => {
      answering = false;
      vi.unstubAllGlobals();
    },
  };
}
