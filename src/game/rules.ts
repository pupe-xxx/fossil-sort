// Fossil Sort（断層版）のルール。
// 高さの違う柱でできた地層の、段を1つ選んで左右に1マスずらす。端から出た石は反対の端に入る。
// ずらした後、下が空いた石は真下に落ちる。縦か横に3つ以上同じ色がそろうと消え、上が落ちて、またそろえば連鎖。
// 化石は段と一緒にずれて落ちる。消えない。上に何も無くなったら掘り出す。
// このフォルダ（src/game）は画面の処理に触れない。document・Canvas・Math.random は使わない。

/** 柱1本の段の数の上限 */
export const CAP = 6;
/** 縦・横とも、この数だけ同じ色が続くと消える */
export const MATCH = 3;
/** 化石。そろっても消えない */
export const FOSSIL = -1;

/** 柱は下から上へ並べる。数は石の色（0 から）か FOSSIL */
export type Column = readonly number[];
export type Board = readonly Column[];

export type Goal = { kind: 'clear' } | { kind: 'fossil' } | { kind: 'chain'; count: number };

export interface Level {
  cols: number[][];
  goal: Goal;
  /** 手数（最少の手数ちょうど） */
  moves: number;
}

export interface State {
  cols: Board;
  goal: Goal;
  limit: number;
  moves: number;
  /** これまでの1手の中で、一番長かった連鎖 */
  bestChain: number;
  fossils: number;
  dug: number;
}

/** 段 row を、dir の向き（1 なら右、-1 なら左）へ1マスずらす */
export interface Move {
  row: number;
  dir: 1 | -1;
}

/** ずらした時に動いた石。fromRow から toRow へ落ちる（落ちなければ同じ） */
export interface Fall {
  col: number;
  value: number;
  fromRow: number;
  toRow: number;
  /** ずれて隣の柱から来た石なら、来る前の柱 */
  fromCol: number;
}

export interface Round {
  /** 消える前の盤での [柱, 段] */
  removed: [number, number][];
  vertical: boolean;
  horizontal: boolean;
  after: Board;
}

export interface Outcome {
  state: State;
  move: Move;
  /** ずらして落ちた後（消える前）の盤 */
  afterShift: Board;
  /** ずらした段の石と、落ちた石の動き（ずらす前の盤から afterShift まで） */
  falls: Fall[];
  rounds: Round[];
  dugCols: number[];
}

export function createState(level: Level): State {
  const fossils = level.cols.reduce((n, col) => n + col.filter((v) => v === FOSSIL).length, 0);
  return {
    cols: level.cols.map((col) => col.slice()),
    goal: level.goal,
    limit: level.moves,
    moves: 0,
    bestChain: 0,
    fossils,
    dug: 0,
  };
}

/** 段 row に石がある柱があるか（無い段はずらせない） */
export const rowExists = (cols: Board, row: number) => cols.some((col) => col.length > row);

/**
 * 段をずらして、落とす。何も変わらない時（段の石が全部同じ色で、空きも無い時など）は null。
 * 段の石だけが横に動き、その上の石は自分の柱に残る。下が空いた石は真下に落ちる
 */
export function shift(cols: Board, move: Move): { cols: number[][]; falls: Fall[] } | null {
  const n = cols.length;
  const { row, dir } = move;
  if (!rowExists(cols, row)) return null;
  const ring = cols.map((col) => (col.length > row ? col[row] : null));
  const moved = ring.map((_, c) => ring[(c - dir + n) % n]);
  if (moved.every((v, c) => v === ring[c])) return null;
  const falls: Fall[] = [];
  const next = cols.map((col, c) => {
    const below = col.slice(0, Math.min(row, col.length));
    const above = col.slice(row + 1);
    const cell = moved[c];
    const out = [...below];
    if (cell !== null) {
      falls.push({ col: c, value: cell, fromRow: row, toRow: out.length, fromCol: (c - dir + n) % n });
      out.push(cell);
    }
    above.forEach((v, k) => {
      falls.push({ col: c, value: v, fromRow: row + 1 + k, toRow: out.length, fromCol: c });
      out.push(v);
    });
    return out;
  });
  return { cols: next, falls };
}

/** 今そろっている石の位置。縦・横を同時に見る。横は端をまたがない */
export function findMatches(cols: Board): { cells: [number, number][]; vertical: boolean; horizontal: boolean } {
  const hit = cols.map((col) => col.map(() => false));
  let v = false, h = false;
  cols.forEach((col, c) => {
    let start = 0;
    for (let r = 1; r <= col.length; r++) {
      if (r < col.length && col[r] === col[start]) continue;
      if (col[start] !== FOSSIL && r - start >= MATCH) {
        for (let k = start; k < r; k++) hit[c][k] = true;
        v = true;
      }
      start = r;
    }
  });
  for (let r = 0; r < CAP; r++) {
    let start = 0;
    for (let c = 1; c <= cols.length; c++) {
      const color = cols[start]?.[r];
      if (c < cols.length && color !== undefined && cols[c][r] === color) continue;
      if (color !== undefined && color !== FOSSIL && c - start >= MATCH) {
        for (let k = start; k < c; k++) hit[k][r] = true;
        h = true;
      }
      start = c;
    }
  }
  const cells: [number, number][] = [];
  hit.forEach((col, c) => col.forEach((on, r) => on && cells.push([c, r])));
  return { cells, vertical: v, horizontal: h };
}

/** そろった石を消して落とす。そろう物が無くなるまで繰り返す（1回ごとが連鎖の1段） */
export function resolve(cols: Board): Round[] {
  const rounds: Round[] = [];
  let board = cols;
  for (;;) {
    const m = findMatches(board);
    if (m.cells.length === 0) return rounds;
    const gone = new Set(m.cells.map(([c, r]) => `${c},${r}`));
    board = board.map((col, c) => col.filter((_, r) => !gone.has(`${c},${r}`)));
    rounds.push({ removed: m.cells, vertical: m.vertical, horizontal: m.horizontal, after: board });
  }
}

/** 一番上が化石の柱から、化石を掘り出す */
function dig(cols: Board): { cols: number[][]; dugCols: number[] } {
  const dugCols: number[] = [];
  const out = cols.map((col, c) => {
    const rest = col.slice();
    while (rest.length > 0 && rest[rest.length - 1] === FOSSIL) {
      dugCols.push(c);
      rest.pop();
    }
    return rest;
  });
  return { cols: out, dugCols };
}

export function legalMoves(state: State): Move[] {
  const moves: Move[] = [];
  for (let row = 0; row < CAP; row++) {
    for (const dir of [-1, 1] as const) if (shift(state.cols, { row, dir })) moves.push({ row, dir });
  }
  return moves;
}

/** 手を打った後の中身を返す（元の状態は変えない）。打てない手なら null */
export function play(state: State, move: Move): Outcome | null {
  if (status(state) !== 'playing') return null;
  const shifted = shift(state.cols, move);
  if (!shifted) return null;
  const rounds = resolve(shifted.cols);
  const settled = rounds.length > 0 ? rounds[rounds.length - 1].after : shifted.cols;
  const { cols, dugCols } = dig(settled);
  return {
    state: {
      ...state,
      cols,
      moves: state.moves + 1,
      bestChain: Math.max(state.bestChain, rounds.length),
      fossils: state.fossils - dugCols.length,
      dug: state.dug + dugCols.length,
    },
    move,
    afterShift: shifted.cols,
    falls: shifted.falls,
    rounds,
    dugCols,
  };
}

export type Status = 'playing' | 'cleared' | 'failed';

export function goalMet(state: State): boolean {
  switch (state.goal.kind) {
    case 'clear':
      return state.cols.every((col) => col.length === 0);
    case 'fossil':
      return state.fossils === 0;
    case 'chain':
      return state.bestChain >= state.goal.count;
  }
}

export function status(state: State): Status {
  if (goalMet(state)) return 'cleared';
  if (state.moves >= state.limit || legalMoves(state).length === 0) return 'failed';
  return 'playing';
}
