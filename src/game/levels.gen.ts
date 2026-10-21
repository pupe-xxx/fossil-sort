// npm run gen で作ったステージ。手で直さない。
// solution は最少の手順（[段, 向き] の並び。向きは 1 が右、-1 が左）
import type { Level } from './rules';

export const GENERATED: (Level & { solution: [number, 1 | -1][] })[] = [
  {"cols":[[],[],[],[0],[0,0]],"goal":{"kind":"clear"},"moves":1,"solution":[[0,-1]]},
  {"cols":[[],[],[],[0,1,0,1],[1,0]],"goal":{"kind":"clear"},"moves":1,"solution":[[1,-1]]},
  {"cols":[[],[1,0],[1,0,1],[0],[]],"goal":{"kind":"clear"},"moves":2,"solution":[[2,-1],[2,-1]]},
  {"cols":[[],[],[],[0,1,0,0,1],[1]],"goal":{"kind":"clear"},"moves":1,"solution":[[1,-1]]},
  {"cols":[[],[0],[1],[1,0,1],[2,0,2,2]],"goal":{"kind":"clear"},"moves":2,"solution":[[1,-1],[2,1]]},
  {"cols":[[0],[0],[2],[1,0,2,1,1],[2]],"goal":{"kind":"clear"},"moves":3,"solution":[[1,-1],[1,-1],[1,1]]},
  {"cols":[[2],[1,0],[1,1,0],[2,0],[2]],"goal":{"kind":"chain","count":2},"moves":1,"solution":[[0,-1]]},
  {"cols":[[2],[2,1,0],[1,1,0],[0],[2]],"goal":{"kind":"clear"},"moves":2,"solution":[[2,1],[0,1]]},
  {"cols":[[],[1],[3],[0,0,1],[3,2,0],[2,1,2,3]],"goal":{"kind":"clear"},"moves":3,"solution":[[3,-1],[1,1],[0,1]]},
  {"cols":[[2,2],[-1,1,0,0],[3,3],[3,0],[1,2,1]],"goal":{"kind":"fossil"},"moves":2,"solution":[[1,-1],[1,-1]]},
  {"cols":[[3,0],[3,1,2],[-1,1,1,2],[2,4],[4,0],[3,4,0]],"goal":{"kind":"fossil"},"moves":3,"solution":[[0,-1],[0,-1],[1,-1]]},
  {"cols":[[1],[2,3,3],[2,0,2],[0,0,3],[1],[1]],"goal":{"kind":"chain","count":3},"moves":2,"solution":[[1,1],[0,-1]]},
  {"cols":[[-1,4,3,2],[3,1],[0,1],[-1,0,0,1,2],[2,4],[3,4]],"goal":{"kind":"fossil"},"moves":3,"solution":[[3,-1],[0,1],[1,-1]]},
  {"cols":[[4,0,2,0,1],[2,4,0,2],[3,3,4],[3,1],[1],[]],"goal":{"kind":"clear"},"moves":4,"solution":[[0,1],[1,1],[2,-1],[1,-1]]},
  {"cols":[[0,4],[1,2,5],[2,0,1],[4,0],[-1,5,3,5],[2,4,3,3,1]],"goal":{"kind":"fossil"},"moves":4,"solution":[[4,1],[2,-1],[2,-1],[2,-1]]},
];
