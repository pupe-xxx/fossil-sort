// ステージの一覧。中身は scripts/gen.ts が作る（npm run gen）。
import { GENERATED } from './levels.gen';
import type { Level, Move } from './rules';

export const LEVELS: Level[] = GENERATED.map(({ solution: _, ...level }) => level);

/** 最少の手順（テストとヒントの確かめに使う） */
export const SOLUTIONS: Move[][] = GENERATED.map((g) => g.solution.map(([row, dir]) => ({ row, dir })));

/** 深さ。5 ステージごとに1段深くなり、背景と化石が変わる */
export const DEPTHS = ['surface', 'clay', 'bedrock', 'lava', 'core'] as const;
export type Depth = (typeof DEPTHS)[number];
export const depthOf = (level: number): Depth => DEPTHS[Math.min(DEPTHS.length - 1, Math.floor(level / 5))];
