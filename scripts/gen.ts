// ステージを自動で作って、総当たりで確かめる。
// 使い方: npm run gen            … 全ステージを作り直して src/game/levels.gen.ts に書く
//         npm run gen -- 12      … 12 番目のステージだけ作り直す（ほかはそのまま）
//
// 残す条件（web-game-template の rules の「ステージに置く物」「新しい要素」）
// - 最少の手数が、ステージごとの幅に入る
// - 空の柱は、どれを取り除いても最少では解けなくなる（余る柱を置かない）
// - 横のステージは、横で消えないと最少では解けない
// - 連鎖が要るステージは、最少の手順の中で連鎖が起きる
// - 適当に打つと解けない（でたらめに打った時のクリアの割合が低い物を選ぶ）
import { readFileSync, writeFileSync } from 'node:fs';
import { CAP, createState, findMatches, FOSSIL, legalMoves, play, status, type Level, type Move, type State } from '../src/game/rules';
import { encode, solveCols } from '../src/game/solve';
import { createRng, type Rng } from '../src/kit/rng';

interface Spec {
  cols: number;
  empty: number;
  /** 色ごとの石の数 */
  colors: number[];
  horizontal?: boolean;
  fossils?: number;
  par: [number, number];
  /** 最少の手順の中で連鎖が起きる */
  chain?: boolean;
  /** 最少の手順の中で縦でも消える（横のステージで、縦も使わせる） */
  vertical?: boolean;
  /** 化石の柱を上まで石で埋める */
  deep?: boolean;
}

// ステージ 5・10・15・20 が化石のステージ。横はステージ 11 から（10 は化石のステージなので、新しいルールを教えない）
const SPECS: Spec[] = [
  { cols: 3, empty: 1, colors: [4, 4], par: [3, 5] },
  { cols: 4, empty: 1, colors: [4, 4, 4], par: [4, 7] },
  { cols: 4, empty: 1, colors: [4, 4, 4], par: [6, 10] },
  { cols: 5, empty: 1, colors: [4, 4, 4, 4], par: [6, 10] },
  { cols: 4, empty: 1, colors: [4, 4, 4], fossils: 1, par: [4, 8] },
  { cols: 5, empty: 1, colors: [4, 4, 4, 4], par: [8, 13] },
  { cols: 6, empty: 2, colors: [4, 4, 4, 4, 4], par: [8, 14] },
  { cols: 6, empty: 1, colors: [4, 4, 4, 4, 4], par: [9, 15] },
  { cols: 6, empty: 1, colors: [4, 4, 4, 4, 4], par: [11, 17] },
  { cols: 5, empty: 1, colors: [4, 4, 4, 4], fossils: 2, par: [6, 12] },
  { cols: 4, empty: 1, colors: [3, 3, 3], horizontal: true, par: [3, 6] },
  { cols: 5, empty: 1, colors: [3, 3, 3, 4], horizontal: true, chain: true, par: [4, 9] },
  { cols: 5, empty: 1, colors: [3, 3, 4, 4], horizontal: true, chain: true, par: [5, 10] },
  { cols: 6, empty: 1, colors: [3, 3, 3, 4, 4], horizontal: true, chain: true, vertical: true, par: [6, 12] },
  { cols: 5, empty: 1, colors: [3, 3, 4, 4], horizontal: true, fossils: 1, par: [4, 10] },
  { cols: 6, empty: 1, colors: [3, 4, 3, 4, 3], horizontal: true, chain: true, vertical: true, par: [7, 13] },
  { cols: 6, empty: 1, colors: [3, 3, 4, 4, 4], horizontal: true, chain: true, vertical: true, par: [8, 14] },
  { cols: 7, empty: 1, colors: [3, 3, 3, 4, 4, 4], horizontal: true, chain: true, vertical: true, par: [8, 15] },
  { cols: 7, empty: 1, colors: [3, 4, 4, 3, 4, 3], horizontal: true, chain: true, vertical: true, par: [9, 16] },
  { cols: 7, empty: 1, colors: [3, 3, 4, 4], horizontal: true, fossils: 2, deep: true, par: [6, 14] },
];

/** 化石のステージの手数の上限は、最少 + これ */
const FOSSIL_SLACK = 3;
/** 1つのステージで試す盤の数と、条件を満たした中から選ぶ候補の数 */
const TRIES = 400;
// 連鎖が要るステージは、条件に合う盤がまれなので多く試す
const CHAIN_TRIES = 30_000;
const KEEP = 6;
const MAX_NODES = 150_000;
const PLAYOUTS = 200;

function shuffle<T>(items: T[], rng: Rng): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

/** でたらめな盤を作る。最初からそろっている盤は作らない */
function deal(spec: Spec, rng: Rng): number[][] | null {
  const filled = spec.cols - spec.empty;
  const stones = shuffle(spec.colors.flatMap((n, color) => Array<number>(n).fill(color)), rng);
  const fossilAt = new Set(shuffle([...Array(filled).keys()], rng).slice(0, spec.fossils ?? 0));
  const room = [...Array(filled).keys()].map((i) => CAP - (fossilAt.has(i) ? 1 : 0));
  if (stones.length > room.reduce((a, b) => a + b, 0)) throw new Error('石が柱に入りきらない');
  // 高さはなるべくそろえ、余りをでたらめに配る
  // deep なら、化石の柱は上まで石で埋める（化石が浅いと、すぐ掘れてしまう）
  const heights = room.map((r, i) => (spec.deep && fossilAt.has(i) ? r : 0));
  for (let k = heights.reduce((a, b) => a + b, 0); k < stones.length; k++) {
    const open = heights.flatMap((h, i) => (h < room[i] ? [i] : []));
    const low = Math.min(...open.map((i) => heights[i]));
    heights[rng.pick(open.filter((i) => heights[i] === low))]++;
  }
  let next = 0;
  const filledCols = heights.map((h, i) => [...(fossilAt.has(i) ? [FOSSIL] : []), ...stones.slice(next, (next += h))]);
  // 化石の上には、必ず石がある
  if (filledCols.some((col) => col.length === 1 && col[0] === FOSSIL)) return null;
  const emptyAt = new Set(shuffle([...Array(spec.cols).keys()], rng).slice(0, spec.empty));
  let f = 0;
  const cols = [...Array(spec.cols).keys()].map((i) => (emptyAt.has(i) ? [] : filledCols[f++]));
  if (findMatches(cols, !!spec.horizontal).cells.length > 0) return null;
  return cols;
}

const levelOf = (cols: number[][], spec: Spec, par = 0): Level => ({
  cols,
  horizontal: !!spec.horizontal,
  par,
  ...(spec.fossils ? { limit: par + FOSSIL_SLACK } : {}),
});

/** 最少の手数。化石のステージは上限を気にせずに探す */
const parOf = (cols: number[][], horizontal: boolean) => {
  const fossil = cols.some((col) => col.includes(FOSSIL));
  const moves = solveCols(encode(cols), { horizontal, fossil }, MAX_NODES);
  return moves ? { moves } : null;
};

/** 最少の手順を打って、連鎖・縦・横が起きたかを見る */
function replay(level: Level, moves: Move[]) {
  let s: State = createState(level);
  let chain = false, vertical = false, horizontal = false;
  for (const m of moves) {
    const out = play(s, m)!;
    if (out.rounds.length >= 2) chain = true;
    for (const r of out.rounds) {
      vertical ||= r.vertical;
      horizontal ||= r.horizontal;
    }
    s = out.state;
  }
  return { chain, vertical, horizontal, cleared: status(s) === 'cleared' };
}

/** でたらめに打った時に、クリアできる割合（すぐ戻す手は打たない） */
function luck(level: Level, rng: Rng): number {
  let wins = 0;
  for (let k = 0; k < PLAYOUTS; k++) {
    let s = createState(level);
    let last: Move | null = null;
    const cap = level.limit ?? level.par * 3;
    while (status(s) === 'playing' && s.moves < cap) {
      const moves = legalMoves(s).filter((m) => !(last && m.from === last.to && m.to === last.from));
      if (moves.length === 0) break;
      last = rng.pick(moves);
      s = play(s, last)!.state;
    }
    if (status(s) === 'cleared') wins++;
  }
  return wins / PLAYOUTS;
}

function make(spec: Spec, index: number): { level: Level; solution: Move[]; luck: number } {
  const rng = createRng(1000 + index * 7919);
  const found: { level: Level; solution: Move[]; luck: number }[] = [];
  // 落とした理由ごとの数（見つからない時に、どの条件がきついかを知るため）
  const why: Record<string, number> = {};
  const no = (reason: string) => void (why[reason] = (why[reason] ?? 0) + 1);
  const tries = spec.chain ? CHAIN_TRIES : TRIES;
  for (let t = 0; t < tries && found.length < KEEP; t++) {
    const cols = deal(spec, rng);
    if (!cols) continue;
    const sol = parOf(cols, !!spec.horizontal);
    if (!sol) {
      no('解けない');
      continue;
    }
    const par = sol.moves.length;
    if (par < spec.par[0] || par > spec.par[1]) {
      no(`最少 ${par} 手`);
      continue;
    }
    const level = levelOf(cols, spec, par);
    // 空の柱は、どれを取り除いても最少では解けない
    const emptyNeeded = cols.every((col, i) => {
      if (col.length > 0) return true;
      const fewer = parOf(cols.filter((_, j) => j !== i), !!spec.horizontal);
      return !fewer || fewer.moves.length > par;
    });
    if (!emptyNeeded) {
      no('空の柱が余る');
      continue;
    }
    // 横のステージは、横で消えないと最少では解けない
    if (spec.horizontal) {
      const noH = parOf(cols, false);
      if (noH && noH.moves.length <= par) {
        no('横が要らない');
        continue;
      }
    }
    const seen = replay(level, sol.moves);
    if (!seen.cleared) continue;
    if (spec.chain && !seen.chain) {
      no('連鎖が起きない');
      continue;
    }
    if (spec.vertical && !seen.vertical) {
      no('縦で消えない');
      continue;
    }
    found.push({ level, solution: sol.moves, luck: luck(level, rng) });
  }
  if (found.length === 0) throw new Error(`ステージ ${index + 1}: 条件を満たす盤が見つからない ${JSON.stringify(why)}`);
  // 適当に打っても解けにくい物を選ぶ
  found.sort((a, b) => a.luck - b.luck);
  return found[0];
}

const OUT = new URL('../src/game/levels.gen.ts', import.meta.url);

function readExisting(): string[] {
  try {
    const text = readFileSync(OUT, 'utf8');
    return text.split('\n').filter((line) => line.startsWith('  {'));
  } catch {
    return [];
  }
}

const only = process.argv[2] ? Number(process.argv[2]) - 1 : null;
const lines = readExisting();
for (let i = 0; i < SPECS.length; i++) {
  if (only !== null && i !== only && lines[i]) continue;
  const began = Date.now();
  const made = make(SPECS[i], i);
  const { level, solution } = made;
  lines[i] = `  ${JSON.stringify({ ...level, solution: solution.map((m) => [m.from, m.to]) })},`;
  console.log(`ステージ ${i + 1}: 最少 ${level.par} 手・でたらめでクリア ${(made.luck * 100).toFixed(0)}%（${Date.now() - began}ms）`);
  // 途中で止まっても、作れた所までは残す
  writeOut();
}

function writeOut() {
  const kept = lines.slice(0, SPECS.length).filter(Boolean);
  writeFileSync(
    OUT,
    `// npm run gen で作ったステージ。手で直さない。\n// solution は最少の手順（[移す元, 移す先] の並び）\nimport type { Level } from './rules';\n\nexport const GENERATED: (Level & { solution: [number, number][] })[] = [\n${kept.join('\n')}\n];\n`,
  );
}
