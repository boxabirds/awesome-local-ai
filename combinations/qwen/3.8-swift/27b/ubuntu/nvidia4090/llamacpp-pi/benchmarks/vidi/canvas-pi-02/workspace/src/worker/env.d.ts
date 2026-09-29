// Env extensions for the worker (story 4 e2e test hooks, story 5 rate
// limits, story 12 assets).

declare namespace Cloudflare {
  interface Env {
    /** When '1', the /_test/ routes exist (e2e dev env only). */
    TEST_HOOKS?: string;
    /** Platform rate limiter for board creation (story 5). */
    BOARD_CREATE_LIMITER?: RateLimit;
    /** Story 12 (assets.api): image storage bucket. */
    ASSETS_BUCKET?: R2Bucket;
    /** Story 12 (image.rate_limit): platform rate limiter for image
     *  uploads. */
    ASSET_UPLOAD_LIMITER?: RateLimit;
  }
}
