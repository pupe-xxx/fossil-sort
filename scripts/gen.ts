// ステージを自動で作って、総当たりで確かめる。
// 使い方: npm run gen            … 全ステージを作り直して src/game/levels.gen.ts に書く
//         npm run gen -- 12      … 12 番目のステージだけ作り直す（ほかはそのまま）
//
// 残す条件（web-game-template の rules の「ステージに置く物」「新しい要素」）
// - 決まった手数ちょうどで目標を果たせ、それより少ない手数では果たせない
// - 教えている要素（崩れて縦でそろう・連鎖）が、最少の手順の中で起きる
// - でたらめに打つと、ほぼ解けない（解ける確率が maxLuck 以下）
import { readFileSync, writeFileSync } from 'node:fs';
import { CAP, createState, findMatches, FOSSIL, play, status, type Goal, type Level, type Move } from '../src/game/rules';
import { encode, luck, solveCols } from '../src/game/solve';
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
  /** でたらめに打った時に解ける確率の上限 */
  maxLuck: number;
}

const CLEAR: Goal = { kind: 'clear' };
const FOSSIL_GOAL: Goal = { kind: 'fossil' };

// 1〜3：ずらすと横でそろう／4〜6：崩れて縦でそろう／7〜9：連鎖／10〜：化石
const SPECS: Spec[] = [
  { cols: 5, colors: [3], goal: CLEAR, moves: 1, maxLuck: 0.3 },
  { cols: 5, colors: [3, 3], goal: CLEAR, moves: 1, maxLuck: 0.2 },
  { cols: 5, colors: [3, 3], goal: CLEAR, moves: 2, maxLuck: 0.08 },
  { cols: 5, colors: [3, 3], goal: CLEAR, moves: 1, vertical: true, maxLuck: 0.2 },
  { cols: 5, colors: [3, 3, 3], goal: CLEAR, moves: 2, vertical: true, maxLuck: 0.06 },
  { cols: 5, colors: [3, 3, 3], goal: CLEAR, moves: 3, vertical: true, maxLuck: 0.03 },
  { cols: 5, colors: [3, 3, 3], goal: { kind: 'chain', count: 2 }, moves: 1, chain: true, maxLuck: 0.2 },
  { cols: 5, colors: [3, 3, 3], goal: CLEAR, moves: 2, chain: true, maxLuck: 0.06 },
  { cols: 6, colors: [3, 3, 3, 3], goal: CLEAR, moves: 3, chain: true, maxLuck: 0.03 },
  { cols: 5, colors: [3, 3, 3], fossils: 1, goal: FOSSIL_GOAL, moves: 2, maxLuck: 0.08 },
  { cols: 6, colors: [3, 3, 3, 3], fossils: 1, goal: FOSSIL_GOAL, moves: 3, chain: true, maxLuck: 0.03 },
  { cols: 6, colors: [3, 3, 3, 3], goal: { kind: 'chain', count: 3 }, moves: 2, chain: true, maxLuck: 0.03 },
  { cols: 6, colors: [3, 3, 3, 3], fossils: 2, goal: FOSSIL_GOAL, moves: 3, maxLuck: 0.03 },
  { cols: 6, colors: [3, 3, 3, 3, 3], goal: CLEAR, moves: 4, chain: true, vertical: true, maxLuck: 0.02 },
  { cols: 6, colors: [3, 3, 3, 3, 3], fossils: 1, goal: FOSSIL_GOAL, moves: 4, chain: true, maxLuck: 0.02 },
];

const TRIES = 200_000;
/** 条件を満たした中から選ぶ候補の数 */
const KEEP = 8;

function shuffle<T>(items: T[], rng: Rng): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

/** でたらめな盤を作る。高さはでこぼこにする。最初からそろっている盤・化石が見えている盤は作らない */
function deal(spec: Spec, rng: Rng): number[][] | null {
  const stones = shuffle(spec.colors.flatMap((n, color) => Array<number>(n).fill(color)), rng);
  const cols: number[][] = Array.from({ length: spec.cols }, () => []);
  for (const s of stones) {
    const open = cols.flatMap((col, i) => (col.length < CAP - 1 ? [i] : []));
    cols[rng.pick(open)].push(s);
  }
  // 化石は、石の下に差し込む
  for (let k = 0; k < (spec.fossils ?? 0); k++) {
    const open = cols.flatMap((col, i) => (col.length >= 1 && col.length < CAP && !col.includes(FOSSIL) ? [i] : []));
    if (open.length === 0) return null;
    const col = cols[rng.pick(open)];
    col.splice(rng.int(col.length), 0, FOSSIL);
  }
  if (cols.some((col) => col[col.length - 1] === FOSSIL)) return null;
  if (findMatches(cols).cells.length > 0) return null;
  return cols;
}

/** 最少の手順を打って、縦・連鎖が起きたかを見る */
function replay(level: Level, moves: Move[]) {
  let s = createState(level);
  let chain = false, vertical = false;
  for (const m of moves) {
    const out = play(s, m)!;
    if (out.rounds.length >= 2) chain = true;
    for (const r of out.rounds) vertical ||= r.vertical;
    s = out.state;
  }
  return { chain, vertical, cleared: status(s) === 'cleared' };
}

function make(spec: Spec, index: number): { level: Level; solution: Move[]; luck: number } {
  const rng = createRng(2000 + index * 7919);
  const found: { level: Level; solution: Move[]; luck: number }[] = [];
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
    const p = luck(enc, spec.goal, spec.moves);
    if (p > spec.maxLuck) {
      no('でたらめで解けやすい');
      continue;
    }
    found.push({ level, solution: sol, luck: p });
  }
  if (found.length === 0) throw new Error(`ステージ ${index + 1}: 条件を満たす盤が見つからない ${JSON.stringify(why)}`);
  // でたらめに打っても解けにくい物を選ぶ
  found.sort((a, b) => a.luck - b.luck);
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
  console.log(`ステージ ${i + 1}: ${level.moves} 手・でたらめで解ける確率 ${(made.luck * 100).toFixed(1)}%（${Date.now() - began}ms）`);
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
