// Cà phê ABS — máy chủ
// - Phục vụ trang quán (public/index.html)
// - Lấy bảng giá mỗi phút và đẩy cho mọi khách đang mở trang
// - Phòng chơi chung qua WebSocket: tối đa 30 khách, người đến sau chờ ngoài cửa,
//   hàng chờ order đánh số theo thứ tự máy chủ nhận được
// Không cần cài thư viện ngoài: chỉ cần Node.js 18 trở lên.

'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const MAX_GUESTS = Number(process.env.MAX_GUESTS) || 30;
const MAX_CONNECTIONS = Number(process.env.MAX_CONNECTIONS) || 300;
const PRICE_INTERVAL_MS = Number(process.env.PRICE_INTERVAL_MS) || 60_000;
const SOURCE = (process.env.PRICE_SOURCE || 'sim').toLowerCase();

const source = SOURCE === 'abs' ? require('./sources/abs') : require('./sources/sim');
const PUBLIC = path.join(__dirname, 'public');

/* ================== BẢNG GIÁ ================== */
let snapshot = { updatedAt: 0, source: source.name, stocks: [] };
let snapshotJson = JSON.stringify(snapshot);
let lastError = '';

async function refreshPrices() {
  try {
    const stocks = await source.fetchAll();
    if (!Array.isArray(stocks) || !stocks.length) throw new Error('nguồn giá trả về danh sách rỗng');
    snapshot = { updatedAt: Date.now(), source: source.name, stocks };
    snapshotJson = JSON.stringify(snapshot);
    lastError = '';
    broadcastRaw(`{"type":"prices","data":${snapshotJson}}`);
    console.log(`[giá] ${new Date().toLocaleTimeString('vi-VN')} · ${stocks.length} mã · nguồn ${source.name}`);
  } catch (e) {
    lastError = e.message || String(e);
    console.error('[giá] lỗi:', lastError, '— giữ nguyên bảng giá trước đó');
  }
}

/* ================== HTTP ================== */
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/prices') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    return res.end(snapshotJson);
  }
  if (url.pathname === '/favicon.ico') { res.writeHead(204); return res.end(); }
  if (url.pathname === '/api/health') {
    const inRoom = [...clients.values()].filter(c => c.state === 'in').length;
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, source: source.name, stocks: snapshot.stocks.length, updatedAt: snapshot.updatedAt, lastError, guests: inRoom, connections: clients.size }));
  }
  let file = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  file = path.normalize(path.join(PUBLIC, file));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); return res.end('Không tìm thấy'); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(data);
  });
});

/* ================== WEBSOCKET (tự cài đặt, không cần thư viện) ================== */
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
function frame(op, data) {
  const n = data.length;
  let head;
  if (n < 126) head = Buffer.from([0x80 | op, n]);
  else if (n < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | op; head[1] = 126; head.writeUInt16BE(n, 2); }
  else { head = Buffer.alloc(10); head[0] = 0x80 | op; head[1] = 127; head.writeBigUInt64BE(BigInt(n), 2); }
  return Buffer.concat([head, data]);
}
function wrapSocket(sock) {
  let buf = Buffer.alloc(0);
  const ws = {
    open: true,
    sendRaw(text) { if (ws.open && !sock.destroyed) sock.write(frame(0x1, Buffer.from(text))); },
    send(obj) { ws.sendRaw(JSON.stringify(obj)); },
    close() { if (!ws.open) return; ws.open = false; try { sock.end(frame(0x8, Buffer.alloc(0))); } catch (e) {} },
    onmessage: null, onclose: null,
  };
  sock.on('data', chunk => {
    buf = Buffer.concat([buf, chunk]);
    if (buf.length > 256 * 1024) return sock.destroy();
    for (;;) {
      if (buf.length < 2) break;
      const op = buf[0] & 0x0f, masked = buf[1] & 0x80;
      let len = buf[1] & 0x7f, off = 2;
      if (len === 126) { if (buf.length < 4) break; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) break; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      if (len > 64 * 1024) return sock.destroy();
      const maskAt = off; if (masked) off += 4;
      if (buf.length < off + len) break;
      let payload = Buffer.from(buf.subarray(off, off + len));
      if (masked) { const m = buf.subarray(maskAt, maskAt + 4); for (let i = 0; i < payload.length; i++) payload[i] ^= m[i & 3]; }
      buf = buf.subarray(off + len);
      if (op === 0x8) { ws.close(); sock.destroy(); return; }
      if (op === 0x9) { sock.write(frame(0xA, payload)); continue; }
      if (op === 0x1 && ws.onmessage) { try { ws.onmessage(payload.toString('utf8')); } catch (e) { console.error(e); } }
    }
  });
  const end = () => { if (ws.onclose) { const f = ws.onclose; ws.onclose = null; ws.open = false; f(); } };
  sock.on('close', end);
  sock.on('error', () => { sock.destroy(); end(); });
  return ws;
}
server.on('upgrade', (req, sock) => {
  const url = new URL(req.url, 'http://x');
  const key = req.headers['sec-websocket-key'];
  if (!url.pathname.endsWith('/ws') || !key || clients.size >= MAX_CONNECTIONS) { sock.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
  sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  sock.setNoDelay(true);
  onConnect(wrapSocket(sock));
});

/* ================== PHÒNG CHƠI ==================
   Mỗi khách gửi "presence" (tên, màu, vị trí, ghế, ly, biểu cảm, hàng chờ).
   Máy chủ quyết định: ai được vào (tối đa 30, theo thứ tự đến), ai chờ ngoài cửa,
   và số thứ tự hàng chờ order. */
const clients = new Map();
let joinSeq = 0, queueSeq = 0, dirty = false;

const TICKER = /^[A-Z0-9]{1,10}$/;
const str = (v, n) => typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, n) : '';
const numIn = (v, lo, hi, d) => (typeof v === 'number' && Number.isFinite(v)) ? Math.min(hi, Math.max(lo, v)) : d;
const tick = v => typeof v === 'string' && TICKER.test(v) ? v : '';
const EMOTES = new Set(['none', 'dance', 'sad', 'happy', 'wave', 'angry']);

function onConnect(ws) {
  const id = crypto.randomBytes(6).toString('hex');
  const c = { id, ws, state: 'lobby', ja: 0, q: 0, pr: {}, last: Date.now() };
  clients.set(id, c);
  ws.send({ type: 'hello', id, max: MAX_GUESTS });
  ws.sendRaw(`{"type":"prices","data":${snapshotJson}}`);
  sendPeers(c);
  ws.onmessage = text => {
    if (text.length > 4096) return;
    let m; try { m = JSON.parse(text); } catch (e) { return; }
    c.last = Date.now();
    if (m && m.type === 'presence' && m.pr && typeof m.pr === 'object') onPresence(c, m.pr);
    else if (m && m.type === 'ping') ws.send({ type: 'pong' });
  };
  ws.onclose = () => { clients.delete(id); admit(); dirty = true; };
}

function onPresence(c, p) {
  const wants = p.j === 1 || p.wt === 1;
  if (wants && c.state === 'lobby') { c.state = 'wait'; c.ja = ++joinSeq; admit(); }
  if (!wants && c.state !== 'lobby') { c.state = 'lobby'; c.q = 0; admit(); }
  const q = numIn(p.q, 0, 1e16, 0);
  if (c.state === 'in' && q > 0 && !c.q) c.q = ++queueSeq;
  if (!q || c.state !== 'in') c.q = 0;
  c.pr = {
    n: str(p.n, 18) || 'Khách',
    c: /^#[0-9a-fA-F]{6}$/.test(p.c) ? p.c : '#94a3b8',
    x: Math.round(numIn(p.x, 0, 2000, 110)),
    y: Math.round(numIn(p.y, 0, 2000, 1160)),
    s: Number.isInteger(p.s) && p.s >= 0 && p.s < 30 ? p.s : -1,
    k: tick(p.k), e: EMOTES.has(p.e) ? p.e : 'none',
    w: tick(p.w), sv: tick(p.sv),
  };
  dirty = true;
}

function admit() {
  let inRoom = 0;
  clients.forEach(c => { if (c.state === 'in') inRoom++; });
  const line = [...clients.values()].filter(c => c.state === 'wait').sort((a, b) => a.ja - b.ja);
  while (inRoom < MAX_GUESTS && line.length) { line.shift().state = 'in'; inRoom++; }
  dirty = true;
}

function peerList() {
  const waiting = [...clients.values()].filter(c => c.state === 'wait').sort((a, b) => a.ja - b.ja);
  const list = [];
  clients.forEach(c => {
    if (c.state === 'lobby') return;
    const inRoom = c.state === 'in';
    const pr = Object.assign({}, c.pr, { j: inRoom ? 1 : 0, wt: inRoom ? 0 : 1, ja: c.ja, q: c.q });
    if (!inRoom) { pr.wp = waiting.indexOf(c) + 1; delete pr.x; delete pr.y; }
    list.push({ id: c.id, pr });
  });
  return list;
}
function sendPeers(c) { c.ws.send({ type: 'peers', peers: peerList() }); }
function broadcastRaw(text) { clients.forEach(c => c.ws.sendRaw(text)); }

setInterval(() => {                       // gửi trạng thái phòng tối đa 10 lần/giây
  if (!dirty) return;
  dirty = false;
  broadcastRaw(JSON.stringify({ type: 'peers', peers: peerList() }));
}, 100);
setInterval(() => {                       // ai im lặng quá 45 giây thì coi như đã rời
  const cut = Date.now() - 45_000;
  clients.forEach(c => { if (c.last < cut) c.ws.close(); });
}, 10_000);

/* ================== KHỞI ĐỘNG ================== */
server.listen(PORT, () => {
  console.log(`Cà phê ABS đang mở tại http://localhost:${PORT} · nguồn giá: ${source.name} · cập nhật mỗi ${PRICE_INTERVAL_MS / 1000}s · tối đa ${MAX_GUESTS} khách`);
});
refreshPrices();
setInterval(refreshPrices, PRICE_INTERVAL_MS);
