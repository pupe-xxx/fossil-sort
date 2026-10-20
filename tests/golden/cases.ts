// 動作記録に入れる場面：各ステージで、記録した最少の手順を打った時の、1手ごとの盤。
// ルールかステージが変わると、ここが変わる。
import { LEVELS, SOLUTIONS } from '../../src/game/levels';
import { createState, play } from '../../src/game/rules';
import { fingerprint, type Trace } from '../../src/kit/golden';

function traceLevel(i: number): Trace {
  let state = createState(LEVELS[i]);
  const trace = [fingerprint(state)];
  for (const m of SOLUTIONS[i]) {
    const out = play(state, m)!;
    state = out.state;
    trace.push(fingerprint({ state, rounds: out.rounds.length, dug: out.dugCols }));
  }
  return trace;
}

export function goldenCases(): Record<string, Trace> {
  return Object.fromEntries(LEVELS.map((_, i) => [`stage ${i + 1}`, traceLevel(i)]));
}
