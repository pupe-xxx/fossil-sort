import { describe, expect, it } from 'vitest';
import { LEVELS, SOLUTIONS } from '../src/game/levels';
import { CAP, createState, FOSSIL, legalMoves, play, status, type Level } from '../src/game/rules';
import { encode, solve, step } from '../src/game/solve';
import { createRng } from '../src/kit/rng';

describe('速い探索は、ルールと同じ動きをする', () => {
  it('でたらめな盤とでたらめな手で、打った後の盤と連鎖の数が一致する', () => {
    const rng = createRng(7);
    for (let game = 0; game < 400; game++) {
      const cols = Array.from({ length: 4 + rng.int(3) }, () =>
        Array.from({ length: rng.int(CAP + 1) }, () => (rng.next() < 0.08 ? FOSSIL : rng.int(4))),
      );
      let state = createState({ cols, goal: { kind: 'clear' }, moves: 99 });
      for (let k = 0; k < 15; k++) {
        const moves = legalMoves(state);
        if (moves.length === 0) break;
        const m = rng.pick(moves);
        const fast = step(encode(state.cols), m);
        const out = play(state, m);
        if (!out) break;
        expect(fast?.cols).toEqual(encode(out.state.cols));
        expect(fast?.chain).toBe(out.rounds.length);
        state = out.state;
      }
    }
  });
});

describe('ステージ', () => {
  LEVELS.forEach((level: Level, i) => {
    it(`ステージ ${i + 1}: 記録した手順でクリアでき、それより短い手順は無い`, () => {
      let state = createState(level);
      for (const m of SOLUTIONS[i]) state = play(state, m)!.state;
      expect(status(state)).toBe('cleared');
      expect(SOLUTIONS[i]).toHaveLength(level.moves);
      const shorter = solve(createState({ ...level, moves: level.moves - 1 }));
      expect(shorter).toBeNull();
    });
  });
});
