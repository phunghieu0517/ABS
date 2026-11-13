'use strict';
// Biên độ và bước giá theo quy định sàn (đơn vị: đồng)
const BAND = { HOSE: 0.07, HNX: 0.10, UPCOM: 0.15 };
const tickSize = (p, ex) => ex !== 'HOSE' ? 100 : (p < 10000 ? 10 : p < 50000 ? 50 : 100);

function withBand(s) {
  const ex = BAND[s.ex] ? s.ex : 'HOSE';
  const b = BAND[ex], hi = s.ref * (1 + b), lo = s.ref * (1 - b);
  const ceil = s.ceil || Math.floor(hi / tickSize(hi, ex)) * tickSize(hi, ex);
  const floor = s.floor || Math.ceil(lo / tickSize(lo, ex)) * tickSize(lo, ex);
  const snap = v => { const t = tickSize(v, ex); return Math.min(ceil, Math.max(floor, Math.round(v / t) * t)); };
  return Object.assign({}, s, { ex, ceil, floor, snap });
}

module.exports = { BAND, tickSize, withBand };
