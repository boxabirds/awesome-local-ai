declare namespace Cloudflare {
  interface Env {
    BOARD_ROOM: DurableObjectNamespace<import('../../src/worker/board-room').BoardRoom>;
    ASSETS: Fetcher;
  }
  interface GlobalProps {
    mainModule: typeof import('../../src/worker/index');
  }
}
