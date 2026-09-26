import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';

const ORIGIN = 'http://127.0.0.1:8791';
const B = process.argv[2] ?? '0123456789abcdefGHIJKL';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const doc = new Y.Doc();
const provider = new WebsocketProvider(`${ORIGIN}/api/rooms`, B, doc, { disableBc: true });
await new Promise((res) => (provider.on('status', (s) => (s === 'connected' ? res() : null)), setTimeout(res, 5000)));
console.log('connected?', provider.wsconnected);
const objects = doc.getMap('objects');
for (let i = 0; i < 3; i++) {
  const m = new Y.Map();
  m.set('x', i * 20);
  m.set('y', 0);
  m.set('text', new Y.Text(`note ${i}`));
  objects.set(`note-${i}`, m);
}
await sleep(500);
const st = async () => (await fetch(`${ORIGIN}/__test/rooms/${B}/state`)).json();
console.log('after writes', JSON.stringify(await st()));
console.log('compact', JSON.stringify(await (await fetch(`${ORIGIN}/__test/rooms/${B}/compact`, { method: 'POST' })).json()));
console.log('corrupt', JSON.stringify(await (await fetch(`${ORIGIN}/__test/rooms/${B}/corrupt-snapshot`, { method: 'POST' })).json()));
provider.destroy();
await sleep(200);

const ws = new WebSocket(`ws://127.0.0.1:8791/api/rooms/${B}`);
const closed = await new Promise((res) => {
  ws.addEventListener('close', (e) => res(e.code));
  ws.addEventListener('error', (e) => res(`error ${e.message}`));
  setTimeout(() => res(`timeout readyState=${ws.readyState}`), 6000);
});
console.log('second client close code:', closed);
console.log('state after', JSON.stringify(await st()));
provider.destroy();
process.exit(0);
