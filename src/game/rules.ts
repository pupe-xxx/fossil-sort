// Fossil Sort のルール。
// 岩の柱に色の石が積んである。上の同じ色をまとめて移し、縦に4つ・横に3本そろえて消す。
// 消えると上の石が沈み、またそろえば続けて消える（連鎖）。化石のステージでは、底に埋まった化石を掘り出す。
// このフォルダ（src/game）は画面の処理に触れない。document・Canvas・Math.random は使わない。

/** 柱1本に積める段の数 */
export const CAP = 5;
/** 縦にこの数だけ同じ色が続くと消える */
export const VERTICAL = 4;
/** 同じ高さで、隣り合うこの本数の柱が同じ色だと消える */
export const HORIZONTAL = 3;
/** 化石。柱の底の1段を使い、動かせない。上に石を置けない */
export const FOSSIL = -1;

/** 柱は下から上へ並べる。数は石の色（0 から）か FOSSIL */
export type Column = readonly number[];
export type Board = readonly Column[];

export interface Level {
  cols: number[][];
  /** 横でも消えるか（教える順で、序盤は縦だけ） */
  horizontal: boolean;
  /** 最少の手数 */
  par: number;
  /** 化石のステージだけ。手数の上限 */
  limit?: number;
}

export interface State {
  cols: Board;
  horizontal: boolean;
  moves: number;
  /** 化石のステージの手数の上限。普通のステージは null */
  limit: number | null;
  /** まだ掘り出していない化石の数 */
  fossils: number;
  /** 掘り出した化石の数 */
  dug: number;
}

export interface Move {
  from: number;
  to: number;
}

/** 1回の消える→沈む。removed は消える前の盤での [柱, 段] */
export interface Round {
  removed: [number, number][];
  /** 縦・横のどちらで消えたか（両方のこともある） */
  vertical: boolean;
  horizontal: boolean;
  after: Board;
}

/** 1手の中身。動きを見せるのと、ステージを確かめるのに使う */
export interface Outcome {
  state: State;
  move: Move;
  /** 移した石の数 */
  count: number;
  /** 移した直後（消える前）の盤 */
  afterMove: Board;
  rounds: Round[];
  /** 化石を掘り出した柱 */
  dugCols: number[];
}

export function createState(level: Level): State {
  const fossils = level.cols.reduce((n, col) => n + col.filter((v) => v === FOSSIL).length, 0);
  return {
    cols: level.cols.map((col) => col.slice()),
    horizontal: level.horizontal,
    moves: 0,
    limit: level.limit ?? null,
    fossils,
    dug: 0,
  };
}

const top = (col: Column): number | undefined => col[col.length - 1];

/** 柱の一番上で、同じ色が幾つ続いているか */
export function topRun(col: Column): number {
  const c = top(col);
  if (c === undefined || c === FOSSIL) return 0;
  let n = 0;
  for (let i = col.length - 1; i >= 0 && col[i] === c; i--) n++;
  return n;
}

/** from から to へ移せるか。移せるなら移る石の数、移せないなら 0 */
export function moveCount(cols: Board, from: number, to: number): number {
  if (from === to || !cols[from] || !cols[to]) return 0;
  const run = topRun(cols[from]);
  if (run === 0) return 0;
  const dest = cols[to];
  const room = CAP - dest.length;
  if (room <= 0) return 0;
  const t = top(dest);
  if (t !== undefined && t !== cols[from][cols[from].length - 1]) return 0;
  return Math.min(run, room);
}

export function legalMoves(state: State): Move[] {
  const moves: Move[] = [];
  for (let from = 0; from < state.cols.length; from++) {
    for (let to = 0; to < state.cols.length; to++) {
      if (moveCount(state.cols, from, to) > 0) moves.push({ from, to });
    }
  }
  return moves;
}

/** 今そろっている石の位置。縦・横を同時に見る */
export function findMatches(cols: Board, horizontal: boolean): { cells: [number, number][]; vertical: boolean; horizontal: boolean } {
  const hit = cols.map((col) => col.map(() => false));
  let v = false, h = false;
  cols.forEach((col, c) => {
    let start = 0;
    for (let r = 1; r <= col.length; r++) {
      if (r < col.length && col[r] === col[start]) continue;
      if (col[start] !== FOSSIL && r - start >= VERTICAL) {
        for (let k = start; k < r; k++) hit[c][k] = true;
        v = true;
      }
      start = r;
    }
  });
  if (horizontal) {
    for (let r = 0; r < CAP; r++) {
      let start = 0;
      for (let c = 1; c <= cols.length; c++) {
        const color = cols[start]?.[r];
        if (c < cols.length && color !== undefined && cols[c][r] === color) continue;
        if (color !== undefined && color !== FOSSIL && c - start >= HORIZONTAL) {
          for (let k = start; k < c; k++) hit[k][r] = true;
          h = true;
        }
        start = c;
      }
    }
  }
  const cells: [number, number][] = [];
  hit.forEach((col, c) => col.forEach((on, r) => on && cells.push([c, r])));
  return { cells, vertical: v, horizontal: h };
}

/** そろった石を消して沈める。そろう物が無くなるまで繰り返す（1回ごとが連鎖の1段） */
export function resolve(cols: Board, horizontal: boolean): Round[] {
  const rounds: Round[] = [];
  let board = cols;
  for (;;) {
    const m = findMatches(board, horizontal);
    if (m.cells.length === 0) return rounds;
    const gone = new Set(m.cells.map(([c, r]) => `${c},${r}`));
    board = board.map((col, c) => col.filter((_, r) => !gone.has(`${c},${r}`)));
    rounds.push({ removed: m.cells, vertical: m.vertical, horizontal: m.horizontal, after: board });
  }
}

/** 手を打った後の中身を返す（元の状態は変えない）。打てない手なら null */
export function play(state: State, move: Move): Outcome | null {
  if (status(state) !== 'playing') return null;
  const count = moveCount(state.cols, move.from, move.to);
  if (count === 0) return null;
  const cols = state.cols.map((col) => col.slice());
  const stones = cols[move.from].splice(cols[move.from].length - count, count);
  cols[move.to].push(...stones);
  const rounds = resolve(cols, state.horizontal);
  const settled = rounds.length > 0 ? rounds[rounds.length - 1].after : cols;
  // 上の石が全部なくなって、化石が一番上に出たら掘り出す
  const dugCols: number[] = [];
  const final = settled.map((col, c) => {
    if (col.length === 1 && col[0] === FOSSIL) {
      dugCols.push(c);
      return [];
    }
    return col;
  });
  return {
    state: {
      ...state,
      cols: final,
      moves: state.moves + 1,
      fossils: state.fossils - dugCols.length,
      dug: state.dug + dugCols.length,
    },
    move,
    count,
    afterMove: cols,
    rounds,
    dugCols,
  };
}

export type Status = 'playing' | 'cleared' | 'failed';

export const isFossilStage = (state: State) => state.limit !== null;

/** これ以上は消し切れない色があるか（数が足りない色が残っている） */
export function stranded(state: State): boolean {
  const counts = new Map<number, number>();
  for (const col of state.cols) for (const v of col) if (v !== FOSSIL) counts.set(v, (counts.get(v) ?? 0) + 1);
  const least = state.horizontal ? HORIZONTAL : VERTICAL;
  return [...counts.values()].some((n) => n < least);
}

export function status(state: State): Status {
  if (isFossilStage(state)) {
    if (state.fossils === 0) return 'cleared';
    if (state.moves >= state.limit! || legalMoves(state).length === 0) return 'failed';
    return 'playing';
  }
  if (state.cols.every((col) => col.length === 0)) return 'cleared';
  if (stranded(state) || legalMoves(state).length === 0) return 'failed';
  return 'playing';
}

/** 星の数。最少の手数なら3つ */
export function stars(state: State, par: number): number {
  if (state.moves <= par) return 3;
  if (isFossilStage(state)) return state.moves <= par + 1 ? 2 : 1;
  return state.moves <= Math.ceil(par * 1.3) ? 2 : 1;
}
