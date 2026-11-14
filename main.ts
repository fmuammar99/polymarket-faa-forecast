// polymarket-faa-attribution-02 entry (Node 22, standard library only).
//
// Forecast: for each market, the median stays at its last price (no drift:
// on the practice, every trend / mean-reversion drift tried made the loss
// worse), and the spread widens like h^0.4 with a per-market volatility
// estimated robustly from recent one-minute moves. Two views are blended:
//
//   1. Linear view (weight 0.7): sigma is an exponentially weighted mean of
//      |1-minute price changes| (half-life 240 minutes) times 1.2533 (the
//      normal mean-|x| to sigma factor), clipped to [0.0005, 0.012] and
//      scaled by 0.9. Quantiles: q = x + z_tau * sigma * h^0.4.
//   2. Logit view (weight 0.3): the same construction in log-odds space
//      (prices clipped to [1e-4, 1-1e-4]), sigma from the mean |logit change|
//      over the last 360 minutes, clipped to [0.001, 0.05] and scaled by 0.9,
//      mapped back through the sigmoid. This gives multiplicative moves for
//      the many small-price markets, where a 0.002 market moves in 0.001s
//      and a 0.3 market in 0.02s.
//
// Why these numbers (all chosen on the 6 practice cases, then held fixed):
//   - The baseline's fixed sigma 0.0025 * sqrt(h) is wrong twice: minute
//     changes are mostly 0 with rare jumps, so the plain standard deviation
//     (0.83 loss) is ruined by the jumps while mean |change| is robust; and
//     the spread of h-minute changes grows slower than sqrt(h) (prices are
//     bounded probabilities that mean-revert), so h^0.4 fits better.
//   - A recent window matters: sigma from the last 6h beats the 72h one by
//     ~0.07 of loss, because volatility regimes change with the news.
//   - The outer quantiles are widened by 1.3x (z_0.05/z_0.95 = +/-2.138):
//     jumps outside a normal spread are common, and pinball at the tails
//     punishes a too-narrow 90% interval hard.
//
// Practice score (local scorer validated to reproduce the server's baseline
// figures exactly: 0.363589 loss, 0.767503 median error, 0.949642 coverage):
//   baseline starter 0.363589 -> this entry 0.269496 (-25.9%), better on
//   every one of the six cases (p00 0.464, p01 0.309, p02 0.356, p03 0.240,
//   p04 0.209, p05 0.104 vs baseline 0.536/0.380/0.408/0.369/0.299/0.238).
// The practice is another event (NVIDIA CEO), so this is no guarantee for
// the FAA final; it is the best evidence available before the deadline.
//
// Contract (as the starter): read every <id>.in in the input directory,
// write <id>.out to the output directory: {"forecasts":[{"id","q"}]}, every
// market exactly once, q exactly horizon_minutes rows, each row one finite
// number in [0,1] per quantile level, non-decreasing; at most 1 MiB.
// Deterministic: pure arithmetic on the input, no clock, no randomness.
// Runs offline, no network.
//
//   mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

/** The quantile levels the contest scores, in the order each row lists them. */
const QUANTILES = [0.05, 0.25, 0.5, 0.75, 0.95];
/** The standard normal's quantile at each level, outer levels widened 1.3x. */
const Z = [-1.644854 * 1.3, -0.67449, 0, 0.67449, 1.644854 * 1.3];
/** Spread grows like h^ALPHA, not sqrt(h): bounded prices mean-revert. */
const ALPHA = 0.4;
/** Overall sigma scale (the robust estimate runs a little wide). */
const SIGMA_MULT = 0.9;
/** EWMA half-life, in minutes, for the linear view's |change| average. */
const EWMA_HALF_LIFE = 240;
/** Plain window, in minutes, for the logit view's |change| average. */
const LOGIT_WINDOW = 360;
/** Blend weights: linear view 0.7, logit view 0.3. */
const LINEAR_WEIGHT = 0.7;

interface CaseMarket {
  id: string;
  prices: number[];
}

interface Case {
  horizon_minutes: number;
  quantiles: number[];
  markets: CaseMarket[];
}

/** x clamped to [0,1] and rounded to 6 decimals (0, never -0). */
const price6 = (x: number): number => Math.round(Math.min(1, Math.max(0, x)) * 1e6) / 1e6 + 0;

/** EWMA (oldest first, newest weight 1) of |1-minute changes| of `p`. */
function ewmaMeanAbsDiff(p: number[]): number {
  const lam = Math.pow(0.5, 1 / EWMA_HALF_LIFE);
  let s = 0;
  let w = 0;
  for (let i = 1; i < p.length; i++) {
    const d = Math.abs(p[i] as number - (p[i - 1] as number));
    s = lam * s + d;
    w = lam * w + 1;
  }
  return w > 0 ? s / w : 0;
}

/** Mean |change| over the last `win` changes of `p` (whole series if shorter). */
function recentMeanAbsDiff(p: number[], win: number): number {
  const start = Math.max(1, p.length - win);
  if (p.length - start < 1) return 0;
  let s = 0;
  let n = 0;
  for (let i = start; i < p.length; i++) {
    s += Math.abs((p[i] as number) - (p[i - 1] as number));
    n++;
  }
  return n > 0 ? s / n : 0;
}

/** The forecast of one market: horizon rows of the five quantiles. */
function forecast(m: CaseMarket, horizon: number): number[][] {
  if (m.prices.length === 0) throw new Error(`market ${m.id} has no prices`);
  const x = m.prices[m.prices.length - 1] as number;
  const rows: number[][] = [];

  // Linear view.
  const sigmaLin =
    (m.prices.length > 1
      ? Math.min(0.012, Math.max(0.0005, ewmaMeanAbsDiff(m.prices) * 1.2533))
      : 0.0025) * SIGMA_MULT;

  // Logit view.
  const eps = 1e-4;
  const logit = m.prices.map((v) => {
    const c = Math.min(1 - eps, Math.max(eps, v));
    return Math.log(c / (1 - c));
  });
  const sigmaLog =
    (m.prices.length > 1
      ? Math.min(0.05, Math.max(0.001, recentMeanAbsDiff(logit, LOGIT_WINDOW) * 1.2533))
      : 0.005) * SIGMA_MULT;
  const logitX = logit[logit.length - 1] as number;

  for (let h = 1; h <= horizon; h++) {
    const spread = Math.pow(h, ALPHA);
    const row: number[] = [];
    for (let j = 0; j < QUANTILES.length; j++) {
      const z = Z[j] as number;
      // Each view is clamped to [0,1] before blending: a view is a valid
      // quantile forecast on its own, and blending raw values would let a
      // linear tail below 0 drag the blend down after clamping.
      const lin = price6(x + z * sigmaLin * spread);
      const log = price6(1 / (1 + Math.exp(-(logitX + z * sigmaLog * spread))));
      row.push(price6(LINEAR_WEIGHT * lin + (1 - LINEAR_WEIGHT) * log));
    }
    // Rounding can only preserve order, but enforce it outright.
    for (let j = 1; j < row.length; j++) {
      if ((row[j] as number) < (row[j - 1] as number)) row[j] = row[j - 1] as number;
    }
    rows.push(row);
  }
  return rows;
}

mkdirSync(OUTPUT_DIR, { recursive: true });
// Every case file, in name order, so two runs write the same bytes.
const inputs = readdirSync(INPUT_DIR).filter((f) => f.endsWith('.in')).sort();
for (const file of inputs) {
  const id = file.slice(0, -'.in'.length);
  const c = JSON.parse(readFileSync(join(INPUT_DIR, file), 'utf8')) as Case;
  if (c.quantiles.length !== QUANTILES.length || c.quantiles.some((t, j) => t !== QUANTILES[j])) throw new Error(`${file} asks for quantiles ${JSON.stringify(c.quantiles)}, not ${JSON.stringify(QUANTILES)}`);
  const forecasts = c.markets.map((m) => ({ id: m.id, q: forecast(m, c.horizon_minutes) }));
  writeFileSync(join(OUTPUT_DIR, `${id}.out`), `${JSON.stringify({ forecasts })}\n`);
}
