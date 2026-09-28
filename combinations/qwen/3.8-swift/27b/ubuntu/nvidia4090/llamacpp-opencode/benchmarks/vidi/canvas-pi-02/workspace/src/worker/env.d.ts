// Env extensions for the worker (story 4 e2e test hooks).

declare namespace Cloudflare {
  interface Env {
    /** When '1', the /_test/ routes exist (e2e dev env only). */
    TEST_HOOKS?: string;
    /** Platform rate limiter for board creation (story 5). */
    BOARD_CREATE_LIMITER?: RateLimit;
  }
}
