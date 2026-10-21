// 最少の手数を探す（幅優先）。ステージを作って確かめる時と、ヒントに使う。
// 速さのために、柱を「下から上へ並べた文字列」で持つ（色 0 → 'a'、化石 → 'F'）。
// ルールは rules.ts と同じ。同じ結果になるかは tests/solve.test.ts で確かめる。
import { CAP, FOSSIL, MATCH, type Board, type Goal, type Move, type State } from './rules';

const F = 'F';
const enc = (v: number) => (v === FOSSIL ? F : String.fromCharCode(97 + v));
export const encode = (cols: Board): string[] => cols.map((col) => col.map(enc).join(''));

/** そろった石を消して落とす。連鎖の数も返す */
function settle(cols: string[]): { cols: string[]; chain: number } {
  let chain = 0;
  for (;;) {
    let marks: boolean[][] | null = null;
    const mark = (c: number, r: number) => {
      marks ??= cols.map((col) => Array<boolean>(col.length).fill(false));
      marks[c][r] = true;
    };
    for (let c = 0; c < cols.length; c++) {
      const col = cols[c];
      let start = 0;
      for (let r = 1; r <= col.length; r++) {
        if (r < col.length && col[r] === col[start]) continue;
        if (r - start >= MATCH && col[start] !== F) for (let k = start; k < r; k++) mark(c, k);
        start = r;
      }
    }
    for (let r = 0; r < CAP; r++) {
      let start = 0;
      for (let c = 1; c <= cols.length; c++) {
        const color = cols[start][r];
        if (c < cols.length && color !== undefined && cols[c][r] === color) continue;
        if (color !== undefined && color !== F && c - start >= MATCH) for (let k = start; k < c; k++) mark(k, r);
        start = c;
      }
    }
    if (!marks) return { cols, chain };
    const m: boolean[][] = marks;
    chain++;
    cols = cols.map((col, c) => {
      let s = '';
      for (let r = 0; r < col.length; r++) if (!m[c][r]) s += col[r];
      return s;
    });
  }
}

/** 1手打つ。打てない（何も変わらない）なら null */
export function step(cols: string[], move: Move): { cols: string[]; chain: number } | null {
  const n = cols.length;
  const { row, dir } = move;
  let any = false;
  const ring: (string | null)[] = cols.map((col) => {
    if (col.length > row) {
      any = true;
      return col[row];
    }
    return null;
  });
  if (!any) return null;
  let same = true;
  const next = cols.map((col, c) => {
    const cell = ring[(c - dir + n) % n];
    if (cell !== ring[c]) same = false;
    return col.slice(0, Math.min(row, col.length)) + (cell ?? '') + col.slice(row + 1);
  });
  if (same) return null;
  const settled = settle(next);
  // 一番上が化石なら掘り出す
  const dug = settled.cols.map((col) => {
    let s = col;
    while (s.length > 0 && s[s.length - 1] === F) s = s.slice(0, -1);
    return s;
  });
  return { cols: dug, chain: settled.chain };
}

const MOVES: Move[] = [];
for (let row = 0; row < CAP; row++) for (const dir of [-1, 1] as const) MOVES.push({ row, dir });

function reached(cols: string[], goal: Goal, chain: number): boolean {
  switch (goal.kind) {
    case 'clear':
      return cols.every((col) => col.length === 0);
    case 'fossil':
      return cols.every((col) => !col.includes(F));
    case 'chain':
      return chain >= goal.count;
  }
}

/** これ以上は消し切れない色があるか（全部消すのが目標の時だけ使う） */
function stranded(cols: string[]): boolean {
  const counts = new Map<string, number>();
  for (const col of cols) for (const ch of col) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  for (const n of counts.values()) if (n < MATCH) return true;
  return false;
}

/** 最少の手順を探す。maxMoves 手までに見つからない・maxNodes を超えた時は null */
export function solveCols(start: string[], goal: Goal, maxMoves: number, maxNodes = 500_000): Move[] | null {
  const parent = new Map<string, [string, Move] | null>();
  parent.set(start.join('|'), null);
  let frontier: string[][] = [start];
  for (let depth = 1; depth <= maxMoves && frontier.length > 0; depth++) {
    const next: string[][] = [];
    for (const cols of frontier) {
      const key = cols.join('|');
      for (const move of MOVES) {
        const out = step(cols, move);
        if (!out) continue;
        const k = out.cols.join('|');
        // 連鎖が目標の時は、同じ盤でも連鎖が起きた手を見逃さないよう、先に判定する
        if (reached(out.cols, goal, out.chain)) {
          parent.set(`${k}#goal`, [key, move]);
          return pathTo(parent, `${k}#goal`);
        }
        if (parent.has(k)) continue;
        if (goal.kind === 'clear' && stranded(out.cols)) continue;
        parent.set(k, [key, move]);
        if (parent.size > maxNodes) return null;
        next.push(out.cols);
      }
    }
    frontier = next;
  }
  return null;
}

function pathTo(parent: Map<string, [string, Move] | null>, key: string): Move[] {
  const moves: Move[] = [];
  for (let p = parent.get(key); p; p = parent.get(p[0])) moves.push(p[1]);
  return moves.reverse();
}

/**
 * 打てる手から毎回でたらめに1つ選んで打った時に、決まった手数の中で目標を果たせる確率。
 * 「適当に打っても解ける」ステージを落とすのに使う
 */
export function luck(start: string[], goal: Goal, moves: number): number {
  const memo = new Map<string, number>();
  const walk = (cols: string[], left: number): number => {
    const key = `${left}:${cols.join('|')}`;
    const known = memo.get(key);
    if (known !== undefined) return known;
    let sum = 0, n = 0;
    for (const move of MOVES) {
      const out = step(cols, move);
      if (!out) continue;
      n++;
      if (reached(out.cols, goal, out.chain)) sum += 1;
      else if (left > 1) sum += walk(out.cols, left - 1);
    }
    const p = n === 0 ? 0 : sum / n;
    memo.set(key, p);
    return p;
  };
  return walk(start, moves);
}

/** 今の状態からクリアまでの最少の手順（ヒント用） */
export function solve(state: State, maxNodes = 500_000): { moves: Move[] } | null {
  const moves = solveCols(encode(state.cols), state.goal, state.limit - state.moves, maxNodes);
  return moves ? { moves } : null;
}
