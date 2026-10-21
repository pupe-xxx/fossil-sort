// ステージを自動で作って、総当たりで確かめる。
// 使い方: npm run gen            … 全ステージを作り直して src/game/levels.gen.ts に書く
//         npm run gen -- 12      … 12 番目のステージだけ作り直す（ほかはそのまま）
//
// 残す条件（web-game-template の rules の「ステージに置く物」「新しい要素」と、良いパズルの条件）
// - 決まった手数ちょうどで目標を果たせ、それより少ない手数では果たせない
// - 解き方が少ない（読み切って見つける1本道に近い）
// - 教えている要素（崩れて縦でそろう・連鎖）が、最少の手順の中で起きる
// - 罠：目先で一番たくさん消える手が、正解ではない（trap のステージ）
// - 最後の1手で、たくさん崩れて消える（化石は、上の石が「消えて」出てくる）
// - でたらめに打つと、ほぼ解けない
// 条件を満たした中から、最後の1手が一番派手なものを選ぶ。
// 盤は、下ほど広く埋まった地層らしい形（山・坂・谷）に石を配る。
import { readFileSync, writeFileSync } from 'node:fs';
import { CAP, createState, findMatches, FOSSIL, play, status, type Goal, type Level, type Move } from '../src/game/rules';
import { encode, luck, solveCols, step } from '../src/game/solve';
import { createRng, type Rng } from '../src/kit/rng';

interface Spec {
  cols: number;
  /** 色ごとの石の数 */
  colors: number[];
  fossils?: number;
  goal: Goal;
  /** 手数（最少の手数ちょうど） */
  moves: number;
  /** 最少の手順の中で縦でも消える */
  vertical?: boolean;
  /** 最少の手順の中で連鎖が起きる */
  chain?: boolean;
  /** 目先で一番たくさん消える初手が、正解ではない */
  trap?: boolean;
  /** 最後の1手で消える石の数の下限 */
  minFinal: number;
  /** でたらめに打った時に解ける確率の上限 */
  maxLuck: number;
}

const CLEAR: Goal = { kind: 'clear' };
const FOSSIL_GOAL: Goal = { kind: 'fossil' };
/** 解き方の数の上限（これより多いと、読まなくても見つかる） */
const MAX_SOLUTIONS = 2;

// 1〜3：ずらすと横でそろう／4〜6：崩れて縦でそろう／7〜9：連鎖／10〜：化石。8 からは罠を入れる
const SPECS: Spec[] = [
  { cols: 5, colors: [3], goal: CLEAR, moves: 1, minFinal: 3, maxLuck: 0.3 },
  { cols: 5, colors: [3, 3], goal: CLEAR, moves: 1, minFinal: 6, maxLuck: 0.2 },
  { cols: 5, colors: [3, 3], goal: CLEAR, moves: 2, minFinal: 3, maxLuck: 0.08 },
  { cols: 5, colors: [3, 3], goal: CLEAR, moves: 1, vertical: true, minFinal: 6, maxLuck: 0.2 },
  { cols: 5, colors: [3, 3, 3], goal: CLEAR, moves: 2, vertical: true, minFinal: 6, maxLuck: 0.06 },
  { cols: 5, colors: [3, 3, 3], goal: CLEAR, moves: 3, vertical: true, minFinal: 6, maxLuck: 0.03 },
  { cols: 5, colors: [3, 3, 3], goal: { kind: 'chain', count: 2 }, moves: 1, chain: true, minFinal: 6, maxLuck: 0.2 },
  { cols: 5, colors: [3, 3, 3], goal: CLEAR, moves: 2, chain: true, trap: true, minFinal: 6, maxLuck: 0.06 },
  { cols: 6, colors: [3, 3, 3, 3], goal: CLEAR, moves: 3, chain: true, trap: true, minFinal: 6, maxLuck: 0.03 },
  { cols: 5, colors: [3, 3, 3, 3], fossils: 1, goal: FOSSIL_GOAL, moves: 2, minFinal: 3, maxLuck: 0.08 },
  { cols: 6, colors: [3, 3, 3, 3, 3], fossils: 1, goal: FOSSIL_GOAL, moves: 3, trap: true, minFinal: 3, maxLuck: 0.03 },
  { cols: 6, colors: [3, 3, 3, 3], goal: { kind: 'chain', count: 3 }, moves: 2, chain: true, trap: true, minFinal: 9, maxLuck: 0.03 },
  { cols: 6, colors: [3, 3, 3, 3, 3], fossils: 2, goal: FOSSIL_GOAL, moves: 3, trap: true, minFinal: 3, maxLuck: 0.03 },
  { cols: 6, colors: [3, 3, 3, 3, 3], goal: CLEAR, moves: 4, chain: true, vertical: true, trap: true, minFinal: 9, maxLuck: 0.02 },
  { cols: 6, colors: [3, 3, 3, 3, 3, 3], fossils: 1, goal: FOSSIL_GOAL, moves: 4, trap: true, minFinal: 3, maxLuck: 0.02 },
];

const TRIES = 300_000;
/** 条件を満たした中から選ぶ候補の数 */
const KEEP = 12;

const MOVES: Move[] = [];
for (let row = 0; row < CAP; row++) for (const dir of [-1, 1] as const) MOVES.push({ row, dir });
const keyOf = (m: Move) => `${m.row},${m.dir}`;
/** 消えた石の数（化石は数えない） */
const stonesIn = (cols: string[]) => cols.join('').replace(/F/g, '').length;

function shuffle<T>(items: T[], rng: Rng): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

/** 柱の高さを、地層らしい形（山・坂・谷）で決める。合計は total */
function heightsOf(n: number, total: number, rng: Rng): number[] | null {
  const center = (n - 1) / 2;
  const shape = rng.int(5);
  // 5 つ目の形は、でこぼこ（石が少ない盤で、縦にそろう高い柱を作れるように）
  if (shape === 4) {
    const h = Array<number>(n).fill(0);
    for (let k = 0; k < total; k++) {
      const open = h.flatMap((v, c) => (v < CAP - 1 ? [c] : []));
      if (open.length === 0) return null;
      h[rng.pick(open)]++;
    }
    return h;
  }
  const weight = (c: number) =>
    shape === 0 ? center + 1.5 - Math.abs(c - center) // 山
    : shape === 1 ? c + 1.5 // 右上がりの坂
    : shape === 2 ? n - c + 0.5 // 左上がりの坂
    : Math.abs(c - center) + 1.5; // 谷
  const w = Array.from({ length: n }, (_, c) => weight(c) * (0.8 + rng.next() * 0.4));
  const sum = w.reduce((a, b) => a + b, 0);
  const h = w.map((v) => Math.floor((v / sum) * total));
  // 余りは重い柱から配る
  let left = total - h.reduce((a, b) => a + b, 0);
  const order = [...h.keys()].sort((a, b) => w[b] - w[a]);
  for (let k = 0; left > 0; k++, left--) h[order[k % n]]++;
  return h.some((v) => v > CAP - 1) ? null : h;
}

/** でたらめな盤を作る。最初からそろっている盤・化石が見えている盤は作らない */
function deal(spec: Spec, rng: Rng): number[][] | null {
  const fossils = spec.fossils ?? 0;
  const stones = shuffle(spec.colors.flatMap((n, color) => Array<number>(n).fill(color)), rng);
  const heights = heightsOf(spec.cols, stones.length + fossils, rng);
  if (!heights) return null;
  // 化石は一番下の段の、上に石が3つ以上ある所に埋める。
  // ほかの柱も2段以上にする。低い柱があると、化石の段をずらすだけで化石がその柱の上に乗って、すぐ見えてしまう
  if (fossils > 0 && Math.min(...heights) < 2) return null;
  const deep = shuffle(heights.flatMap((h, c) => (h >= 4 ? [[c, 0] as const] : [])), rng).slice(0, fossils);
  if (deep.length < fossils) return null;
  const fossilAt = new Set(deep.map(([c, r]) => `${c},${r}`));
  let next = 0;
  const cols = heights.map((h, c) => Array.from({ length: h }, (_, r) => (fossilAt.has(`${c},${r}`) ? FOSSIL : stones[next++])));
  if (findMatches(cols).cells.length > 0) return null;
  return cols;
}

/** 決まった手数で目標を果たす手順を全部数え、初手の種類を集める */
function solutionsOf(start: string[], goal: Goal, moves: number) {
  let count = 0;
  const firsts = new Set<string>();
  const walk = (cols: string[], left: number, first: string | null) => {
    for (const m of MOVES) {
      const out = step(cols, m);
      if (!out) continue;
      const f = first ?? keyOf(m);
      const done =
        goal.kind === 'clear' ? out.cols.every((c) => c.length === 0)
        : goal.kind === 'fossil' ? out.cols.every((c) => !c.includes('F'))
        : out.chain >= goal.count;
      if (done) {
        count++;
        firsts.add(f);
      } else if (left > 1) walk(out.cols, left - 1, f);
    }
  };
  walk(start, moves, null);
  return { count, firsts };
}

/** 目先で一番たくさん消える初手（消える初手が無ければ null） */
function greedyFirst(start: string[]): string | null {
  let best = 0, key: string | null = null;
  for (const m of MOVES) {
    const out = step(start, m);
    if (!out) continue;
    const gone = stonesIn(start) - stonesIn(out.cols);
    if (gone > best) {
      best = gone;
      key = keyOf(m);
    }
  }
  return key;
}

/** 最少の手順を打って、縦・連鎖・最後の1手の派手さを見る */
function replay(level: Level, moves: Move[]) {
  let s = createState(level);
  let chain = false, vertical = false, finalGone = 0, finalChain = 0, dugByClear = false;
  moves.forEach((m, i) => {
    const out = play(s, m)!;
    if (out.rounds.length >= 2) chain = true;
    for (const r of out.rounds) vertical ||= r.vertical;
    if (i === moves.length - 1) {
      finalGone = out.rounds.reduce((n, r) => n + r.removed.length, 0);
      finalChain = out.rounds.length;
      dugByClear = out.dugCols.length > 0 && out.rounds.length > 0;
    }
    s = out.state;
  });
  return { chain, vertical, finalGone, finalChain, dugByClear, cleared: status(s) === 'cleared' };
}

interface Made {
  level: Level;
  solution: Move[];
  luck: number;
  solutions: number;
  drama: number;
}

function make(spec: Spec, index: number): Made {
  const rng = createRng(3000 + index * 7919);
  const found: Made[] = [];
  const why: Record<string, number> = {};
  const no = (reason: string) => void (why[reason] = (why[reason] ?? 0) + 1);
  for (let t = 0; t < TRIES && found.length < KEEP; t++) {
    const cols = deal(spec, rng);
    if (!cols) continue;
    const enc = encode(cols);
    const sol = solveCols(enc, spec.goal, spec.moves);
    if (!sol) {
      no('手数内で解けない');
      continue;
    }
    if (sol.length < spec.moves) {
      no('少ない手数で解ける');
      continue;
    }
    const level: Level = { cols, goal: spec.goal, moves: spec.moves };
    const seen = replay(level, sol);
    if (!seen.cleared) throw new Error('探索とルールが食い違っている');
    if (spec.vertical && !seen.vertical) {
      no('縦で消えない');
      continue;
    }
    if (spec.chain && !seen.chain) {
      no('連鎖が起きない');
      continue;
    }
    if (seen.finalGone < spec.minFinal) {
      no('最後の1手が地味');
      continue;
    }
    if (spec.goal.kind === 'fossil' && !seen.dugByClear) {
      no('化石が崩落で出ない');
      continue;
    }
    const { count, firsts } = solutionsOf(enc, spec.goal, spec.moves);
    if (count > MAX_SOLUTIONS) {
      no('解き方が多い');
      continue;
    }
    if (spec.trap) {
      const greedy = greedyFirst(enc);
      if (!greedy || firsts.has(greedy)) {
        no('罠が無い');
        continue;
      }
    }
    const p = luck(enc, spec.goal, spec.moves);
    if (p > spec.maxLuck) {
      no('でたらめで解けやすい');
      continue;
    }
    found.push({ level, solution: sol, luck: p, solutions: count, drama: seen.finalGone + 4 * seen.finalChain });
  }
  if (found.length === 0) throw new Error(`ステージ ${index + 1}: 条件を満たす盤が見つからない ${JSON.stringify(why)}`);
  // 最後の1手が一番派手なもの。同じなら、でたらめで解けにくいもの
  found.sort((a, b) => b.drama - a.drama || a.luck - b.luck);
  return found[0];
}

const OUT = new URL('../src/game/levels.gen.ts', import.meta.url);

function readExisting(): string[] {
  try {
    return readFileSync(OUT, 'utf8').split('\n').filter((line) => line.startsWith('  {'));
  } catch {
    return [];
  }
}

const only = process.argv[2] ? Number(process.argv[2]) - 1 : null;
const lines = readExisting();
if (only === null) lines.length = 0;
for (let i = 0; i < SPECS.length; i++) {
  if (only !== null && i !== only && lines[i]) continue;
  const began = Date.now();
  const made = make(SPECS[i], i);
  const { level, solution } = made;
  lines[i] = `  ${JSON.stringify({ ...level, solution: solution.map((m) => [m.row, m.dir]) })},`;
  console.log(
    `ステージ ${i + 1}: ${level.moves} 手・解き方 ${made.solutions} 通り・最後の1手の派手さ ${made.drama}・でたらめで解ける確率 ${(made.luck * 100).toFixed(1)}%（${Date.now() - began}ms）`,
  );
  // 途中で止まっても、作れた所までは残す
  writeOut();
}

function writeOut() {
  const kept = lines.slice(0, SPECS.length).filter(Boolean);
  writeFileSync(
    OUT,
    `// npm run gen で作ったステージ。手で直さない。\n// solution は最少の手順（[段, 向き] の並び。向きは 1 が右、-1 が左）\nimport type { Level } from './rules';\n\nexport const GENERATED: (Level & { solution: [number, 1 | -1][] })[] = [\n${kept.join('\n')}\n];\n`,
  );
}
