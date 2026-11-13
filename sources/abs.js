// Nguồn giá ABS (invest.abs.vn/priceboard)
// -------------------------------------------------------------------------------------------
// CHƯA KIỂM CHỨNG: chưa xác định được địa chỉ dữ liệu mà bảng giá ABS dùng.
// Cách lấy địa chỉ: mở https://invest.abs.vn/priceboard bằng Chrome → F12 → tab Network →
// lọc Fetch/XHR → tải lại trang → tìm yêu cầu trả về danh sách mã kèm giá → chuột phải →
// Copy → Copy URL (hoặc Copy as cURL nếu cần header).
//
// Cấu hình bằng biến môi trường:
//   PRICE_SOURCE=abs
//   ABS_URL=<địa chỉ trên>            (nhiều địa chỉ, ví dụ mỗi sàn một địa chỉ: phân cách bằng dấu phẩy)
//   ABS_HEADERS={"Authorization":"..."} (tuỳ chọn, JSON)
//
// Hàm mapRow() bên dưới tự nhận các tên trường phổ biến của bảng giá chứng khoán Việt Nam.
// Nếu dữ liệu ABS dùng tên khác, chỉ cần sửa danh sách tên trường trong FIELDS.
// Nếu bảng giá ABS chỉ đẩy giá qua WebSocket, cần viết lại phần fetchAll() cho phù hợp.
// Hãy chắc chắn bạn được ABS cho phép dùng dữ liệu này trên trang công khai.
// -------------------------------------------------------------------------------------------
'use strict';
const seed = require('../data/seed.json');
const { withBand } = require('./util');
const seedBy = Object.fromEntries(seed.map(s => [s.t, s]));

const FIELDS = {
  t:      ['symbol', 'sym', 'code', 'stockSymbol', 'stockCode', 'ticker', 'sb', 's', 'a'],
  name:   ['companyName', 'name', 'organName', 'fullName', 'stockName', 'cn'],
  ex:     ['exchange', 'floorCode', 'marketCode', 'board', 'market', 'mc', 'e'],
  ref:    ['refPrice', 'ref', 'reference', 'basicPrice', 'priorClosePrice', 'r', 're', 'tc'],
  ceil:   ['ceilingPrice', 'ceiling', 'ceil', 'c', 'cl', 'tran'],
  floor:  ['floorPrice', 'floor', 'f', 'fl', 'san'],
  price:  ['matchPrice', 'lastPrice', 'closePrice', 'price', 'lp', 'mp', 'last', 'cp'],
  val:    ['totalValue', 'totalTradingValue', 'nmTotalTradedValue', 'value', 'tv', 'val'],
  shares: ['listedShare', 'listedShares', 'totalListedQty', 'issueShare', 'outstandingShare'],
};
const pick = (row, keys) => { for (const k of keys) if (row[k] !== undefined && row[k] !== null && row[k] !== '') return row[k]; };
const toNum = v => { const n = typeof v === 'string' ? parseFloat(v.replace(/,/g, '')) : Number(v); return Number.isFinite(n) ? n : 0; };
const EXMAP = { HOSE: 'HOSE', HSX: 'HOSE', HO: 'HOSE', STO: 'HOSE', '10': 'HOSE', HNX: 'HNX', HN: 'HNX', STX: 'HNX', '02': 'HNX', UPCOM: 'UPCOM', UPX: 'UPCOM', UP: 'UPCOM', '04': 'UPCOM' };

function mapRow(row) {
  const t = String(pick(row, FIELDS.t) || '').toUpperCase().trim();
  if (!/^[A-Z0-9]{3}$/.test(t)) return null;                  // chỉ lấy cổ phiếu (mã 3 ký tự)
  const known = seedBy[t] || {};
  let ref = toNum(pick(row, FIELDS.ref)), ceil = toNum(pick(row, FIELDS.ceil)), floor = toNum(pick(row, FIELDS.floor));
  let price = toNum(pick(row, FIELDS.price));
  if (!ref) return null;
  const k = ref < 1000 ? 1000 : 1;                            // giá tính bằng nghìn đồng → đổi ra đồng
  ref = Math.round(ref * k); ceil = Math.round(ceil * k); floor = Math.round(floor * k); price = Math.round(price * k);
  const ex = EXMAP[String(pick(row, FIELDS.ex) || known.ex || 'HOSE').toUpperCase()] || known.ex || 'HOSE';
  const s = withBand({ t, ex, ref, ceil, floor });
  if (!price) price = ref;                                    // chưa khớp lệnh: coi như giá tham chiếu
  const shares = toNum(pick(row, FIELDS.shares));
  const cap = known.cap || (shares ? Math.round(shares * price / 1e9) / 1000 : 0.5);   // nghìn tỷ đồng
  return {
    t, ex: s.ex, ref, ceil: s.ceil, floor: s.floor, price,
    name: String(pick(row, FIELDS.name) || known.name || t).slice(0, 80),
    cap, val: toNum(pick(row, FIELDS.val)) / 1e9 || 0,
  };
}

function findRows(json) {
  if (Array.isArray(json)) return json;
  for (const key of ['data', 'items', 'result', 'stocks', 'd', 'list']) if (json && Array.isArray(json[key])) return json[key];
  if (json && json.data && typeof json.data === 'object') return findRows(json.data);
  return [];
}

module.exports = {
  name: 'abs',
  async fetchAll() {
    const urls = (process.env.ABS_URL || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!urls.length) throw new Error('chưa cấu hình ABS_URL (xem hướng dẫn đầu file sources/abs.js)');
    let headers = { accept: 'application/json', 'user-agent': 'Mozilla/5.0 CaPheABS/1.0' };
    if (process.env.ABS_HEADERS) Object.assign(headers, JSON.parse(process.env.ABS_HEADERS));
    const out = new Map();
    for (const url of urls) {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`ABS trả về mã ${res.status} cho ${url}`);
      findRows(await res.json()).forEach(r => { const m = r && typeof r === 'object' ? mapRow(r) : null; if (m) out.set(m.t, m); });
    }
    return [...out.values()];
  },
  mapRow,
};
