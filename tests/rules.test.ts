import { describe, expect, it } from 'vitest';
import { createState, findMatches, FOSSIL, moveCount, play, resolve, stars, status, type Level } from '../src/game/rules';
import { solve } from '../src/game/solve';

const level = (cols: number[][], extra: Partial<Level> = {}): Level => ({ cols, horizontal: false, par: 1, ...extra });

describe('移す', () => {
  it('上の同じ色をまとめて移す', () => {
    const out = play(createState(level([[1, 1, 1, 0, 0], [1, 0, 0], []])), { from: 0, to: 2 })!;
    expect(out.count).toBe(2);
    expect(out.state.cols).toEqual([[1, 1, 1], [1, 0, 0], [0, 0]]);
  });

  it('空きが足りなければ、入るだけ移す', () => {
    const out = play(createState(level([[1, 0, 0, 0], [1, 1, 1, 0], []])), { from: 0, to: 1 })!;
    expect(out.count).toBe(1);
    expect(out.state.cols).toEqual([[1, 0, 0], [1, 1, 1, 0, 0], []]);
  });

  it('違う色の上・満杯の柱・自分の柱へは移せない', () => {
    const cols = [[0], [1], [1, 1, 2, 2, 2]];
    expect(moveCount(cols, 0, 1)).toBe(0);
    expect(moveCount(cols, 1, 2)).toBe(0);
    expect(moveCount(cols, 0, 0)).toBe(0);
  });

  it('化石は動かせず、上にも置けない', () => {
    const cols = [[FOSSIL], [0], []];
    expect(moveCount(cols, 0, 2)).toBe(0);
    expect(moveCount(cols, 1, 0)).toBe(0);
  });
});

describe('消える', () => {
  it('縦に4つそろうと消える', () => {
    const out = play(createState(level([[1, 0, 0, 0], [1, 1, 1, 0], []])), { from: 1, to: 0 })!;
    expect(out.state.cols).toEqual([[1], [1, 1, 1], []]);
    expect(out.rounds).toHaveLength(1);
  });

  it('縦は柱の途中でも、4つ続けば消える', () => {
    expect(findMatches([[1, 0, 0, 0, 0]], false).cells).toHaveLength(4);
  });

  it('横は、隣り合う3本の同じ高さが同じ色なら消える。縦だけのステージでは消えない', () => {
    const cols = [[0], [0], [0], [1]];
    expect(findMatches(cols, true).cells).toEqual([[0, 0], [1, 0], [2, 0]]);
    expect(findMatches(cols, false).cells).toEqual([]);
  });

  it('空の柱をはさむと横はつながらない', () => {
    expect(findMatches([[0], [0], [], [0]], true).cells).toEqual([]);
  });

  it('消えた段より上の石が沈み、またそろえば連鎖する', () => {
    // 1段目の 0 が横で消える → 2段目の 1 が沈んで、1段目で横にそろう
    const rounds = resolve([[0, 1], [0, 1], [0, 1], [2]], true);
    expect(rounds).toHaveLength(1); // 1 は最初から2段目で横にそろっているので、同時に消える
    const chain = resolve([[1], [0, 1], [0, 1], [0]], true);
    expect(chain).toHaveLength(2);
    expect(chain[1].after).toEqual([[], [], [], []]);
  });

  it('縦と横がそろったら、同時に消える', () => {
    const rounds = resolve([[0, 1, 1, 1, 1], [0], [0]], true);
    expect(rounds).toHaveLength(1);
    expect(rounds[0].vertical && rounds[0].horizontal).toBe(true);
    expect(rounds[0].after).toEqual([[], [], []]);
  });
});

describe('クリアと失敗', () => {
  it('全部消すとクリア', () => {
    const out = play(createState(level([[0, 0, 0], [0], []])), { from: 1, to: 0 })!;
    expect(status(out.state)).toBe('cleared');
  });

  it('消し切れない色が残ると失敗', () => {
    expect(status(createState(level([[0, 0, 0], [1, 2]])))).toBe('failed');
  });

  it('化石が一番上に出たら掘り出す。全部掘ればクリア（石が残っていてもよい）', () => {
    const s = createState(level([[FOSSIL, 1], [0], []], { limit: 3 }));
    const out = play(s, { from: 0, to: 2 })!;
    expect(out.dugCols).toEqual([0]);
    expect(out.state.cols[0]).toEqual([]);
    expect(status(out.state)).toBe('cleared');
  });

  it('化石のステージは、手数の上限を使い切ると失敗', () => {
    let s = createState(level([[FOSSIL, 1, 0], [], [], []], { limit: 1 }));
    s = play(s, { from: 0, to: 1 })!.state;
    expect(status(s)).toBe('failed');
  });

  it('星は最少の手数で3つ', () => {
    const s = { ...createState(level([[0]])), moves: 10 };
    expect(stars(s, 10)).toBe(3);
    expect(stars(s, 8)).toBe(2);
    expect(stars(s, 5)).toBe(1);
  });
});

describe('最少の手数を探す', () => {
  it('解ける盤では最少の手順を返す', () => {
    const s = createState(level([[0, 1, 0, 1], [1, 0, 1, 0], []]));
    const sol = solve(s)!;
    let state = s;
    for (const m of sol.moves) state = play(state, m)!.state;
    expect(status(state)).toBe('cleared');
    expect(sol.moves.length).toBeGreaterThan(0);
  });
});
