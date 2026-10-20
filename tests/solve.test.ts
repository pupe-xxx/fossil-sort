import { describe, expect, it } from 'vitest';
import { LEVELS, SOLUTIONS } from '../src/game/levels';
import { CAP, createState, FOSSIL, legalMoves, play, status, type Level } from '../src/game/rules';
import { encode, solve, step } from '../src/game/solve';
import { createRng } from '../src/kit/rng';

describe('速い探索は、ルールと同じ動きをする', () => {
  it('でたらめな盤とでたらめな手で、打った後の盤が一致する', () => {
    const rng = createRng(7);
    for (let game = 0; game < 300; game++) {
      const horizontal = rng.next() < 0.5;
      const cols = Array.from({ length: 3 + rng.int(5) }, () => {
        const col: number[] = rng.next() < 0.15 ? [FOSSIL] : [];
        const h = rng.int(CAP + 1 - col.length);
        for (let k = 0; k < h; k++) col.push(rng.int(4));
        return col;
      });
      let state = createState({ cols, horizontal, par: 0, limit: 999 });
      for (let k = 0; k < 20; k++) {
        const moves = legalMoves(state);
        if (moves.length === 0) break;
        const m = rng.pick(moves);
        const fast = step(encode(state.cols), m.from, m.to, horizontal);
        const out = play(state, m);
        if (!out) break; // 化石を全部掘った後は打てない
        expect(fast).toEqual(encode(out.state.cols));
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
      expect(SOLUTIONS[i]).toHaveLength(level.par);
      expect(solve(createState(level), 2_000_000)!.moves).toHaveLength(level.par);
    });
  });
});
