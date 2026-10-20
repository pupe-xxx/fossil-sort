// 最少の手数を探す（幅優先）。ステージを作って確かめる時と、ヒントに使う。
// 速さのために、柱を「下から上へ並べた文字列」で持つ（色 0 → 'a'、化石 → 'F'）。
// ルールは rules.ts と同じ。同じ結果になるかは tests/solve.test.ts で確かめる。
import { CAP, FOSSIL, HORIZONTAL, VERTICAL, type Board, type Move, type State } from './rules';

const F = 'F';
const enc = (v: number) => (v === FOSSIL ? F : String.fromCharCode(97 + v));
export const encode = (cols: Board): string[] => cols.map((col) => col.map(enc).join(''));

/** そろった石を消して沈める（そろう物が無くなるまで） */
function settle(cols: string[], horizontal: boolean): string[] {
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
        if (r - start >= VERTICAL && col[start] !== F) for (let k = start; k < r; k++) mark(c, k);
        start = r;
      }
    }
    if (horizontal) {
      for (let r = 0; r < CAP; r++) {
        let start = 0;
        for (let c = 1; c <= cols.length; c++) {
          const color = cols[start][r];
          if (c < cols.length && color !== undefined && cols[c][r] === color) continue;
          if (color !== undefined && color !== F && c - start >= HORIZONTAL) for (let k = start; k < c; k++) mark(k, r);
          start = c;
        }
      }
    }
    if (!marks) return cols;
    const m: boolean[][] = marks;
    cols = cols.map((col, c) => {
      let s = '';
      for (let r = 0; r < col.length; r++) if (!m[c][r]) s += col[r];
      return s;
    });
  }
}

/** これ以上は消し切れない色があるか */
function stranded(cols: string[], horizontal: boolean): boolean {
  const counts = new Map<string, number>();
  for (const col of cols) for (const ch of col) if (ch !== F) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  const least = horizontal ? HORIZONTAL : VERTICAL;
  for (const n of counts.values()) if (n < least) return true;
  return false;
}

/** 1手打つ。打てなければ null。化石が一番上に出たら掘り出す */
export function step(cols: string[], from: number, to: number, horizontal: boolean): string[] | null {
  const src = cols[from], dst = cols[to];
  if (from === to || src.length === 0) return null;
  const c = src[src.length - 1];
  if (c === F) return null;
  const room = CAP - dst.length;
  if (room <= 0 || (dst.length > 0 && dst[dst.length - 1] !== c)) return null;
  let run = 1;
  while (run < src.length && src[src.length - 1 - run] === c) run++;
  const k = Math.min(run, room);
  const next = cols.slice();
  next[from] = src.slice(0, src.length - k);
  next[to] = dst + c.repeat(k);
  const settled = settle(next, horizontal);
  return settled.map((col) => (col === F ? '' : col));
}

export interface Goal {
  horizontal: boolean;
  /** 化石のステージなら、化石を全部掘ればクリア。普通のステージは石を全部消せばクリア */
  fossil: boolean;
  /** 打てる手数の上限（化石のステージ） */
  maxMoves?: number;
}

const done = (cols: string[], goal: Goal) => (goal.fossil ? cols.every((col) => !col.includes(F)) : cols.every((col) => col.length === 0));

/** 最少の手順を探す。見つからない・maxNodes を超えた時は null */
export function solveCols(start: string[], goal: Goal, maxNodes = 200_000): Move[] | null {
  if (done(start, goal)) return [];
  const parent = new Map<string, [string, number, number] | null>();
  const startKey = start.join('|');
  parent.set(startKey, null);
  let frontier: string[][] = [start];
  for (let depth = 1; frontier.length > 0 && depth <= (goal.maxMoves ?? Infinity); depth++) {
    const next: string[][] = [];
    for (const cols of frontier) {
      const key = cols.join('|');
      for (let from = 0; from < cols.length; from++) {
        const src = cols[from];
        if (src.length === 0) continue;
        // 縦だけのステージで、1色だけの柱を空の柱へ丸ごと移すのは、何も変わらない
        const whole = !goal.horizontal && [...src].every((ch) => ch === src[0]);
        for (let to = 0; to < cols.length; to++) {
          if (whole && cols[to].length === 0) continue;
          const after = step(cols, from, to, goal.horizontal);
          if (!after) continue;
          const k = after.join('|');
          if (parent.has(k)) continue;
          parent.set(k, [key, from, to]);
          if (done(after, goal)) return pathTo(parent, k);
          if (!goal.fossil && stranded(after, goal.horizontal)) continue;
          if (parent.size > maxNodes) return null;
          next.push(after);
        }
      }
    }
    frontier = next;
  }
  return null;
}

function pathTo(parent: Map<string, [string, number, number] | null>, key: string): Move[] {
  const moves: Move[] = [];
  for (let p = parent.get(key); p; p = parent.get(p[0])) moves.push({ from: p[1], to: p[2] });
  return moves.reverse();
}

/** 今の状態からクリアまでの最少の手順（ヒント用） */
export function solve(state: State, maxNodes = 200_000): { moves: Move[] } | null {
  const fossil = state.limit !== null;
  const moves = solveCols(encode(state.cols), {
    horizontal: state.horizontal,
    fossil,
    ...(fossil ? { maxMoves: state.limit! - state.moves } : {}),
  }, maxNodes);
  return moves ? { moves } : null;
}
