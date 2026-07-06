import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fitScale,
  fitQuad,
  fitCubic,
  ease,
  elevate,
  toCSS,
  type Quad,
  type Cubic,
} from "../src/index.ts";

const qb = (t: number, a: number) => 2 * t * (1 - t) * a + t * t;
const cbz = (t: number, a1: number, a2: number) =>
  3 * t * (1 - t) ** 2 * a1 + 3 * t * t * (1 - t) * a2 + t ** 3;

test("fitQuad recovers a known control point exactly", () => {
  const Q: Quad = [0.7, 0.2];
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    xs.push(qb(t, Q[0]));
    ys.push(qb(t, Q[1]));
  }
  const [px, py] = fitQuad(xs, ys);
  assert.ok(Math.abs(px - 0.7) < 1e-3, `px ${px}`);
  assert.ok(Math.abs(py - 0.2) < 1e-3, `py ${py}`);
});

test("fitCubic reproduces a polynomial easing to near-zero error", () => {
  // x-handles at thirds → x(t) = t, so y(x) is a plain cubic polynomial
  const C: Cubic = [1 / 3, 0.05, 2 / 3, 0.9];
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    xs.push(t);
    ys.push(cbz(t, C[1], C[3]));
  }
  const fit = fitCubic(xs, ys);
  for (let i = 0; i <= 24; i++) {
    const x = i / 24;
    assert.ok(Math.abs(ease(x, fit) - cbz(x, C[1], C[3])) < 1e-4);
  }
});

test("elevate: quad and elevated cubic agree everywhere", () => {
  const Q: Quad = [0.83, 0.11];
  const C = elevate(Q);
  for (let i = 0; i <= 100; i++) {
    const x = i / 100;
    assert.ok(Math.abs(ease(x, Q) - ease(x, C)) < 1e-6, `x=${x}`);
  }
});

test("ease pins endpoints for both degrees", () => {
  const q: Quad = [0.9, 0.05];
  const c: Cubic = [0.8, 0.1, 0.9, 0.4];
  for (const curve of [q, c] as const) {
    assert.ok(Math.abs(ease(0, curve)) < 1e-9);
    assert.ok(Math.abs(ease(1, curve) - 1) < 1e-9);
  }
});

test("fitScale: both degrees fit a messy scale, quad is stiffer", () => {
  const data = [4, 5, 7, 10, 14.5, 20, 28, 40, 57, 96];
  const f3 = fitScale(data, 3);
  const f2 = fitScale(data, 2);
  assert.equal(f2.curve.length, 2);
  assert.equal(f3.curve.length, 4);
  assert.ok(f3.maxError < data[data.length - 1] * 0.15);
  // guaranteed by candidate selection: cubic picks the best of {alternating
  // solve, elevated quad, quad-seeded solve} by max error
  for (let run = 0; run < 100; run++) {
    const n = 5 + Math.floor(Math.random() * 12);
    const exp = 1 + Math.random() * 2.5;
    const vals = Array.from({ length: n }, (_, i) =>
      4 + 92 * Math.pow(i / (n - 1), exp) * (1 + (Math.random() - 0.5) * 0.3),
    ).sort((a, b) => a - b);
    if (vals[0] === vals[n - 1]) continue;
    const e2 = fitScale(vals, 2).maxError;
    const e3 = fitScale(vals, 3).maxError;
    assert.ok(e3 <= e2 + 1e-6, `cubic ${e3} worse than quad ${e2}`);
  }
});

test("fitScale sorts input and pins min/max", () => {
  const f = fitScale([96, 4, 12, 48, 24, 8], 2);
  assert.equal(f.min, 4);
  assert.equal(f.max, 96);
  const s = f.sizes(7);
  assert.ok(Math.abs(s[0] - 4) < 1e-9);
  assert.ok(Math.abs(s[6] - 96) < 1e-9);
});

test("sizes are monotone (y-clamped fits)", () => {
  const data = [4, 6, 6.5, 11, 13, 30, 29.5, 44, 70, 96]; // includes a local dip
  for (const degree of [2, 3] as const) {
    const s = fitScale(data, degree).sizes(16);
    for (let i = 1; i < s.length; i++) assert.ok(s[i] >= s[i - 1] - 1e-9);
  }
});

test("offset carry: delta at n = data.length reproduces the input exactly", () => {
  const data = [4, 5.5, 8, 12.5, 18, 27, 41, 63, 96];
  for (const degree of [2, 3] as const) {
    const f = fitScale(data, degree);
    const s = f.sizes(data.length, "delta");
    s.forEach((v, i) => assert.ok(Math.abs(v - data[i]) < 1e-9, `i=${i} ${v}`));
  }
});

test("offset carry: ratio at n = data.length reproduces the input", () => {
  const data = [4, 5.5, 8, 12.5, 18, 27, 41, 63, 96];
  const s = fitScale(data, 2).sizes(data.length, "ratio");
  s.forEach((v, i) => assert.ok(Math.abs(v - data[i]) < 1e-6, `i=${i} ${v}`));
});

test("css string is always a valid cubic-bezier, quads elevated", () => {
  const f2 = fitScale([4, 8, 16, 32, 64, 96], 2);
  const f3 = fitScale([4, 8, 16, 32, 64, 96], 3);
  for (const f of [f2, f3]) {
    assert.match(f.css, /^cubic-bezier\((-?\d+(\.\d+)?, ){3}-?\d+(\.\d+)?\)$/);
  }
  assert.equal(f2.css, toCSS(f2.curve));
});

test("input validation", () => {
  assert.throws(() => fitScale([1, 2]), RangeError);
  assert.throws(() => fitScale([1, NaN, 3]), TypeError);
  assert.throws(() => fitScale([5, 5, 5]), RangeError);
  assert.throws(() => fitScale([1, 2, 3]).sizes(1), RangeError);
});

test("fuzz: random plausible scales never produce NaN or non-monotone output", () => {
  for (let run = 0; run < 200; run++) {
    const n = 5 + Math.floor(Math.random() * 15);
    const exp = 1 + Math.random() * 2.5;
    const data = Array.from({ length: n }, (_, i) => {
      const t = i / (n - 1);
      return 4 + 92 * Math.pow(t, exp) * (1 + (Math.random() - 0.5) * 0.35);
    }).sort((a, b) => a - b);
    if (data[0] === data[n - 1]) continue;
    for (const degree of [2, 3] as const) {
      const s = fitScale(data, degree).sizes(3 + (run % 20));
      assert.ok(s.every(Number.isFinite));
      for (let i = 1; i < s.length; i++) assert.ok(s[i] >= s[i - 1] - 1e-9);
    }
  }
});
