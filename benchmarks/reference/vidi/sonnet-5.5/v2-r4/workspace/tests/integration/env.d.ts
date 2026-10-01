declare namespace Cloudflare {
  interface Env {
    BOARD_ROOM: DurableObjectNamespace<import('../../src/worker/board-room').BoardRoom>;
    TEST_HOOKS?: string;
    ASSETS_BUCKET: R2Bucket;
    ASSETS: Fetcher;
  }
  interface GlobalProps {
    mainModule: typeof import('../../src/worker/index');
  }
}
