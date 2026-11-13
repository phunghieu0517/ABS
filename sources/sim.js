// Nguồn giá MÔ PHỎNG: dùng khi chưa nối được nguồn giá ABS.
// Giá dao động trong biên độ Trần–Sàn, tính theo thời gian nên lần nào lấy cũng nhất quán.
'use strict';
const seed = require('../data/seed.json');
const { withBand } = require('./util');

function hash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

module.exports = {
  name: 'sim',
  async fetchAll() {
    const day = Math.floor(Date.now() / 86400000);
    const k = Math.floor(Date.now() / 60000);          // mỗi phút một bước
    return seed.map(s0 => {
      const s = withBand(s0);
      const h = hash(s.t + ':' + day);
      const ph = [0, 1, 2, 3, 4, 5].map(i => ((h >>> (i * 5)) & 31) / 31 * Math.PI * 2);
      const bias = (((h >>> 30) & 3) - 1.5) / 3.5;
      const n = 0.5 * Math.sin(k * 0.05 + ph[0]) + 0.3 * Math.sin(k * 0.13 + ph[1]) + 0.15 * Math.sin(k * 0.37 + ph[2]);
      const band = s.ex === 'HOSE' ? 0.07 : s.ex === 'HNX' ? 0.10 : 0.15;
      let price = s.snap(s.ref * (1 + (n + bias) * band * 1.15));
      if (Math.abs(price - s.ref) < s.ref * 0.003) price = s.ref;
      const val = Math.pow(s.cap, 0.85) * (1 + 0.5 * Math.sin(k * 0.11 + ph[4]) + 0.3 * Math.sin(k * 0.29 + ph[5]));
      return { t: s.t, name: s.name, ex: s.ex, ref: s.ref, ceil: s.ceil, floor: s.floor, price, cap: s.cap, val: Math.round(val * 100) / 100 };
    });
  },
};
