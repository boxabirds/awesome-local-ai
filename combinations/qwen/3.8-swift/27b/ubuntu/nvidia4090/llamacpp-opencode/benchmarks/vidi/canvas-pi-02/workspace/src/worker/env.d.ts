// Env extensions for the worker (story 4 e2e test hooks).

declare namespace Cloudflare {
  interface Env {
    /** When '1', the /_test/ routes exist (wrangler.e2e.jsonc only). */
    TEST_HOOKS?: string;
  }
}
