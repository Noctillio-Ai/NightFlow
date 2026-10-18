// Layout helpers for SVG charts.

/** Spread label centres (in input order) at least `gap` apart within [lo, hi]. */
export function spreadLabels(ys, gap, lo, hi) {
  const order = ys.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y);
  for (let k = 1; k < order.length; k++) order[k].y = Math.max(order[k].y, order[k - 1].y + gap);
  // Pushed past the bottom: shift the stack up, keeping the gaps.
  for (let k = order.length - 1; k >= 0; k--) {
    const limit = k === order.length - 1 ? hi : order[k + 1].y - gap;
    order[k].y = Math.max(lo, Math.min(order[k].y, limit));
  }
  const out = [];
  order.forEach((o) => (out[o.i] = o.y));
  return out;
}
