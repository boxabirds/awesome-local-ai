// Probe: how does a client observe the load-failure close (4500)?
const ORIGIN = 'http://127.0.0.1:8791';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function probe(board, label) {
  const ws = new WebSocket(`ws://127.0.0.1:8791/api/rooms/${board}`);
  ws.binaryType = 'arraybuffer';
  const events = [];
  const done = new Promise((res) => {
    ws.addEventListener('close', (e) => {
      events.push(`close ${e.code}`);
      res(events.join(','));
    });
    ws.addEventListener('error', () => res('error'));
    ws.addEventListener('message', () => events.push('msg'));
    setTimeout(() => res(`timeout(${events.join(',') || 'nothing'}) rs=${ws.readyState}`), 5000);
  });
  await new Promise((res) => {
    if (ws.readyState === WebSocket.OPEN) return res();
    ws.addEventListener('open', res);
    setTimeout(res, 3000);
  });
  console.log(label, 'open state', ws.readyState);
  if (label.startsWith('withmsg')) {
    ws.send(Uint8Array.from([0, 0, 1, 0])); // sync step 1, empty state vector
  }
  console.log(label, '=>', await done);
}

const st = async (b) => (await (await fetch(`${ORIGIN}/__test/rooms/${b}/state`)).json()).state;

// board A: already load-failed from the previous probe
const A = 'AAAAAAAAAAAAAAAAAAAAA1';
console.log('A state before:', await st(A));
await probe(A, 'plain');
await probe(A, 'withmsg');

// board B: fresh, healthy board
const B = 'BBBBBBBBBBBBBBBBBBB1';
const { Doc } = await import('yjs');
const { WebsocketProvider } = await import('y-websocket');
const doc = new Doc();
const provider = new WebsocketProvider(`${ORIGIN}/api/rooms`, B, doc, { disableBc: true });
await sleep(1500);
const objects = doc.getMap('objects');
for (let i = 0; i < 3; i++) {
  const m = new (await import('yjs')).Map();
  m.set('x', i);
  m.set('text', new (await import('yjs')).Text('x'));
  objects.set(`n${i}`, m);
}
await sleep(500);
await fetch(`${ORIGIN}/__test/rooms/${B}/compact`, { method: 'POST' });
await fetch(`${ORIGIN}/__test/rooms/${B}/corrupt-snapshot`, { method: 'POST' });
console.log('B state after corrupt:', await st(B));
provider.destroy();
await sleep(300);
await probe(B, 'plain');
process.exit(0);
