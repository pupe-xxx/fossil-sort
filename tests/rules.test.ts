import { describe, expect, it } from 'vitest';
import { createState, findMatches, FOSSIL, play, resolve, shift, status, type Goal, type Level } from '../src/game/rules';

const level = (cols: number[][], goal: Goal = { kind: 'clear' }, moves = 3): Level => ({ cols, goal, moves });

describe('ずらす', () => {
  it('段の石だけが横に動き、端から出た石は反対の端に入る', () => {
    const out = shift([[0], [1], [2]], { row: 0, dir: 1 })!;
    expect(out.cols).toEqual([[2], [0], [1]]);
  });

  it('ずらした段の上の石は、自分の柱に残る', () => {
    const out = shift([[0, 5], [1, 6], [2, 7]], { row: 0, dir: -1 })!;
    expect(out.cols).toEqual([[1, 5], [2, 6], [0, 7]]);
  });

  it('下が空いた石は真下に落ちる（空いたマスも一緒に回る）', () => {
    // 段 1 の [5, 空, 7] を右へ → [7, 5, 空]。柱 2 は段 1 が空になり、段 2 の 8 が落ちる
    const out = shift([[0, 5], [1], [2, 7, 8]], { row: 1, dir: 1 })!;
    expect(out.cols).toEqual([[0, 7], [1, 5], [2, 8]]);
  });

  it('低い柱の上へずれた石は、その柱の一番上まで落ちる', () => {
    const out = shift([[0, 1, 2], [], []], { row: 2, dir: 1 })!;
    expect(out.cols).toEqual([[0, 1], [2], []]);
  });

  it('石の無い段・何も変わらない段はずらせない', () => {
    expect(shift([[0], [1]], { row: 3, dir: 1 })).toBeNull();
    expect(shift([[0], [0], [0]], { row: 0, dir: 1 })).toBeNull();
  });
});

describe('消える', () => {
  it('縦に3つ・横に3つで消える。横は端をまたがない', () => {
    expect(findMatches([[0, 0, 0]]).cells).toHaveLength(3);
    expect(findMatches([[0], [0], [0], [1]]).cells).toHaveLength(3);
    expect(findMatches([[0], [1], [0], [0]]).cells).toEqual([]);
  });

  it('化石はそろっても消えない', () => {
    expect(findMatches([[FOSSIL], [FOSSIL], [FOSSIL]]).cells).toEqual([]);
  });

  it('消えて落ちた石がまたそろうと、連鎖する', () => {
    const rounds = resolve([[1], [0, 1], [0, 1], [0]]);
    expect(rounds).toHaveLength(2);
    expect(rounds[1].after).toEqual([[], [], [], []]);
  });

  it('ずらして横にそろえば消える', () => {
    const out = play(createState(level([[0], [1], [1, 1], [0], [0]])), { row: 0, dir: -1 })!;
    // 段 0 を左へ → [1, 1, 0, 0, 0]。0 が横に3つで消え、柱 2 の 1 が落ちる → [1, 1, 1] で連鎖
    expect(out.rounds).toHaveLength(2);
    expect(status(out.state)).toBe('cleared');
  });
});

describe('化石', () => {
  it('段と一緒にずれ、上に何も無くなったら掘り出す', () => {
    const s = createState(level([[FOSSIL, 0], [1], [1], [1, 0], [0]], { kind: 'fossil' }));
    // 段 1 を右へ → 柱 0 の 0 が柱 1 へ。柱 0 は化石が一番上になり、掘り出す
    const out = play(s, { row: 1, dir: 1 })!;
    expect(out.dugCols).toEqual([0]);
    expect(status(out.state)).toBe('cleared');
  });
});

describe('クリアと失敗', () => {
  it('手数を使い切っても目標に届かなければ失敗', () => {
    const s = createState(level([[0], [1], [2], [0], [1], [2]], { kind: 'clear' }, 1));
    expect(status(play(s, { row: 0, dir: 1 })!.state)).toBe('failed');
  });

  it('連鎖が目標のステージは、その数の連鎖が起きればクリア', () => {
    const s = createState(level([[0], [1], [1, 1], [0], [0]], { kind: 'chain', count: 2 }, 1));
    expect(status(play(s, { row: 0, dir: -1 })!.state)).toBe('cleared');
  });
});
