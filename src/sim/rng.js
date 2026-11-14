// Deterministic, save-friendly PRNG (mulberry32) with explicit serialisable state.

export function makeRng(seed = 1) {
  let s = seed >>> 0;
  const rng = {
    seed: seed >>> 0,
    next() {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    range(a, b) {
      return a + (b - a) * rng.next();
    },
    int(a, b) {
      return Math.floor(a + (b - a + 1) * rng.next());
    },
    pick(arr) {
      return arr[Math.floor(rng.next() * arr.length)];
    },
    chance(p) {
      return rng.next() < p;
    },
    // weighted: [[value, weight], ...]
    weighted(pairs) {
      let total = 0;
      for (const [, w] of pairs) total += w;
      let r = rng.next() * total;
      for (const [v, w] of pairs) {
        r -= w;
        if (r <= 0) return v;
      }
      return pairs[pairs.length - 1][0];
    },
    shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rng.next() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    },
    state() {
      return s >>> 0;
    },
    setState(v) {
      s = v >>> 0;
    },
  };
  return rng;
}

export function randomSeed() {
  return (Math.floor(Math.random() * 0xffffffff) ^ Date.now()) >>> 0;
}
