// Fossil Sort の画面。外枠（shell）に渡す中身：描く・なぞる／タップを手に直す・動きを見せる・ルールブック。
import { depthOf, LEVELS, SOLUTIONS, type Depth } from '../game/levels';
import { CAP, createState, FOSSIL, legalMoves, play, rowExists, status, type Board, type Goal, type Move, type Outcome, type State } from '../game/rules';
import { solve } from '../game/solve';
import { t } from './i18n';
import type { Anim, GameDef, RuleEntry, Step } from './shell';

export const VIEW = { width: 720, height: 720 } as const;

/** 石の一番下の線 */
const BASE_Y = 640;
/** 1段の高さ */
const ROW = 76;
const BOARD_TOP = BASE_Y - CAP * ROW;

// 色と模様。色が見分けにくい人のために、模様でも見分けられるようにする
const STONES = [
  { fill: '#e2553f', light: '#ff9a7a' }, // 横縞
  { fill: '#22b3a1', light: '#7ff0de' }, // 点
  { fill: '#f0bf45', light: '#fff0a0' }, // 斜め線
  { fill: '#8c6ad8', light: '#cdb8ff' }, // ギザギザ
  { fill: '#3d8fe0', light: '#9fd0ff' }, // 十字
  { fill: '#6cbf48', light: '#c2f59f' }, // 輪
] as const;

const DEPTH_LOOK: Record<Depth, { sky: string; deep: string; band: string[]; accent: string }> = {
  surface: { sky: '#1d2b24', deep: '#14181a', band: ['#2b3a2c', '#3a3a28', '#33302a'], accent: '#9ccc65' },
  clay: { sky: '#2e211b', deep: '#170f0c', band: ['#3f2a20', '#4a3022', '#36241c'], accent: '#ffab70' },
  bedrock: { sky: '#1c2230', deep: '#0d1017', band: ['#2a3140', '#232a37', '#30384a'], accent: '#90caf9' },
  lava: { sky: '#2d1210', deep: '#120606', band: ['#3e1611', '#4f1d12', '#341310'], accent: '#ff7043' },
  core: { sky: '#17123a', deep: '#07051a', band: ['#221a4f', '#2b2060', '#1d1745'], accent: '#e1bee7' },
};

const FOSSIL_NAME: Record<Depth, [string, string]> = {
  surface: ['貝の化石', 'Shell fossil'],
  clay: ['三葉虫', 'Trilobite'],
  bedrock: ['アンモナイト', 'Ammonite'],
  lava: ['竜の骨', 'Dragon bone'],
  core: ['星のかけら', 'Star shard'],
};

// 動きの時間（ミリ秒）
const SHIFT_MS = 200;
const FALL_MS = 200;
const FLASH_MS = 300;
const SINK_MS = 190;
const DIG_MS = 900;

/** 今遊んでいるステージ（化石の種類と背景に使う） */
let current = 0;
/** ヒントの手。どの状態の時に出したかも持ち、状態が変わったら消えたことにする */
let hinted: { state: State; move: Move } | null = null;

const ease = (p: number) => 1 - (1 - p) * (1 - p);

function layout(n: number) {
  const spacing = Math.min(100, 560 / n);
  const width = spacing * 0.92;
  const x = (i: number) => VIEW.width / 2 + (i - (n - 1) / 2) * spacing;
  const left = x(0) - spacing / 2, right = x(n - 1) + spacing / 2;
  return { spacing, width, x, left, right };
}
const rowY = (row: number) => BASE_Y - (row + 0.5) * ROW;

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function drawPattern(ctx: CanvasRenderingContext2D, kind: number, x: number, y: number, w: number, h: number) {
  ctx.strokeStyle = 'rgba(0,0,0,0.26)';
  ctx.fillStyle = 'rgba(0,0,0,0.26)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  switch (kind) {
    case 0:
      for (let k = 1; k <= 3; k++) {
        ctx.moveTo(x, y + (h * k) / 4);
        ctx.lineTo(x + w, y + (h * k) / 4);
      }
      ctx.stroke();
      break;
    case 1:
      for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) {
        ctx.moveTo(x + (w * (i + 0.5)) / 3 + 5, y + (h * (j + 0.5)) / 2);
        ctx.arc(x + (w * (i + 0.5)) / 3, y + (h * (j + 0.5)) / 2, 5, 0, Math.PI * 2);
      }
      ctx.fill();
      break;
    case 2:
      for (let k = -h; k < w; k += 16) {
        ctx.moveTo(x + k, y + h);
        ctx.lineTo(x + k + h, y);
      }
      ctx.stroke();
      break;
    case 3:
      ctx.moveTo(x, y + h * 0.65);
      for (let k = 0; k <= 5; k++) ctx.lineTo(x + (w * k) / 5, y + (k % 2 ? h * 0.3 : h * 0.65));
      ctx.stroke();
      break;
    case 4:
      for (let i = 0; i < 2; i++) {
        const cx = x + (w * (i + 0.5)) / 2, cy = y + h / 2;
        ctx.moveTo(cx - 8, cy);
        ctx.lineTo(cx + 8, cy);
        ctx.moveTo(cx, cy - 8);
        ctx.lineTo(cx, cy + 8);
      }
      ctx.stroke();
      break;
    case 5:
      ctx.lineWidth = 3;
      for (const r of [8, 16]) {
        ctx.moveTo(x + w / 2 + r, y + h / 2);
        ctx.arc(x + w / 2, y + h / 2, r, 0, Math.PI * 2);
      }
      ctx.stroke();
      break;
  }
}

function drawFossilMark(ctx: CanvasRenderingContext2D, depth: Depth, cx: number, cy: number, s: number) {
  ctx.strokeStyle = '#5b4a30';
  ctx.fillStyle = '#5b4a30';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  switch (depth) {
    case 'surface': // 扇の形の貝
      for (let k = -2; k <= 2; k++) {
        ctx.moveTo(cx, cy + s * 0.55);
        ctx.lineTo(cx + Math.sin(k * 0.45) * s, cy + s * 0.55 - Math.cos(k * 0.45) * s);
      }
      ctx.moveTo(cx + s, cy);
      ctx.arc(cx, cy + s * 0.55, s * 1.05, -Math.PI * 0.85, -Math.PI * 0.15);
      break;
    case 'clay': // 三葉虫
      ctx.ellipse(cx, cy, s * 0.7, s, 0, 0, Math.PI * 2);
      for (let k = -2; k <= 2; k++) {
        ctx.moveTo(cx - s * 0.6, cy + k * s * 0.32);
        ctx.lineTo(cx + s * 0.6, cy + k * s * 0.32);
      }
      ctx.moveTo(cx, cy - s);
      ctx.lineTo(cx, cy + s);
      break;
    case 'bedrock': // アンモナイト
      for (let a = 0; a < Math.PI * 5; a += 0.2) {
        const r = s * 0.12 + (a / (Math.PI * 5)) * s;
        const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r;
        if (a === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      break;
    case 'lava': // 骨
      ctx.lineWidth = 7;
      ctx.moveTo(cx - s * 0.8, cy);
      ctx.lineTo(cx + s * 0.8, cy);
      ctx.stroke();
      ctx.beginPath();
      for (const dx of [-1, 1]) for (const dy of [-1, 1]) {
        ctx.moveTo(cx + dx * s * 0.9 + s * 0.22, cy + dy * s * 0.22);
        ctx.arc(cx + dx * s * 0.9, cy + dy * s * 0.22, s * 0.22, 0, Math.PI * 2);
      }
      ctx.fill();
      return;
    case 'core': // 星
      for (let k = 0; k < 10; k++) {
        const r = k % 2 ? s * 0.45 : s;
        const a = -Math.PI / 2 + (k * Math.PI) / 5;
        if (k === 0) ctx.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        else ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      }
      ctx.closePath();
      ctx.fill();
      return;
  }
  ctx.stroke();
}

interface StoneLook {
  alpha?: number;
  /** 白く光る強さ（0〜1） */
  glow?: number;
  scale?: number;
}

function drawStone(ctx: CanvasRenderingContext2D, color: number, cx: number, cy: number, w: number, look: StoneLook = {}) {
  const s = look.scale ?? 1;
  const sw = (w - 6) * s, sh = (ROW - 6) * s;
  const x = cx - sw / 2, y = cy - sh / 2;
  ctx.save();
  ctx.globalAlpha = look.alpha ?? 1;
  if (color === FOSSIL) {
    const g = ctx.createLinearGradient(0, y, 0, y + sh);
    g.addColorStop(0, '#e8d6ac');
    g.addColorStop(1, '#b49a68');
    roundRect(ctx, x, y, sw, sh, 12);
    ctx.fillStyle = g;
    ctx.fill();
    drawFossilMark(ctx, depthOf(current), cx, cy, sh * 0.32);
  } else {
    const look2 = STONES[color % STONES.length];
    const g = ctx.createLinearGradient(0, y, 0, y + sh);
    g.addColorStop(0, look2.light);
    g.addColorStop(0.35, look2.fill);
    g.addColorStop(1, look2.fill);
    roundRect(ctx, x, y, sw, sh, 10);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.save();
    roundRect(ctx, x, y, sw, sh, 10);
    ctx.clip();
    drawPattern(ctx, color % STONES.length, x, y, sw, sh);
    ctx.restore();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 2;
    roundRect(ctx, x, y, sw, sh, 10);
    ctx.stroke();
  }
  if (look.glow) {
    ctx.globalAlpha = (look.alpha ?? 1) * look.glow;
    ctx.fillStyle = '#ffffff';
    roundRect(ctx, x, y, sw, sh, 10);
    ctx.fill();
  }
  ctx.restore();
}

/** 結晶になって割れる。p は 0〜1 */
function drawShards(ctx: CanvasRenderingContext2D, color: number, cx: number, cy: number, p: number) {
  const look = STONES[color % STONES.length];
  ctx.save();
  ctx.globalAlpha = Math.max(0, 1 - p);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + 0.3;
    const d = 10 + p * 70;
    const px = cx + Math.cos(a) * d, py = cy + Math.sin(a) * d + p * p * 40;
    const r = 9 * (1 - p * 0.6);
    ctx.fillStyle = k % 2 ? look.light : '#ffffff';
    ctx.beginPath();
    ctx.moveTo(px, py - r);
    ctx.lineTo(px + r * 0.6, py);
    ctx.lineTo(px, py + r);
    ctx.lineTo(px - r * 0.6, py);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawBackground(ctx: CanvasRenderingContext2D) {
  const look = DEPTH_LOOK[depthOf(current)];
  const g = ctx.createLinearGradient(0, 0, 0, VIEW.height);
  g.addColorStop(0, look.sky);
  g.addColorStop(1, look.deep);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, VIEW.width, VIEW.height);
  // 地層の帯（ゆるく波打つ）
  for (let k = 0; k < 7; k++) {
    const y0 = 120 + k * 85;
    ctx.fillStyle = look.band[k % look.band.length];
    ctx.globalAlpha = 0.45;
    ctx.beginPath();
    ctx.moveTo(0, y0);
    for (let x = 0; x <= VIEW.width; x += 40) ctx.lineTo(x, y0 + Math.sin(x / 90 + k * 1.7) * 9);
    ctx.lineTo(VIEW.width, y0 + 40);
    for (let x = VIEW.width; x >= 0; x -= 40) ctx.lineTo(x, y0 + 40 + Math.sin(x / 110 + k) * 7);
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/** 盤の枠・段の筋・段の両端の矢印 */
function drawFrame(ctx: CanvasRenderingContext2D, cols: Board, glowRow: number | null) {
  const { left, right } = layout(cols.length);
  const accent = DEPTH_LOOK[depthOf(current)].accent;
  roundRect(ctx, left - 8, BOARD_TOP - 8, right - left + 16, BASE_Y - BOARD_TOP + 16, 16);
  ctx.fillStyle = 'rgba(0,0,0,0.38)';
  ctx.fill();
  for (let r = 0; r < CAP; r++) {
    const y = rowY(r);
    const live = rowExists(cols, r);
    if (r === glowRow) {
      roundRect(ctx, left - 4, y - ROW / 2 + 1, right - left + 8, ROW - 2, 10);
      ctx.fillStyle = 'rgba(255,213,79,0.16)';
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(left, y + ROW / 2);
    ctx.lineTo(right, y + ROW / 2);
    ctx.stroke();
    if (!live) continue;
    // 段の両端の矢印（押すとその向きへずれる）
    ctx.fillStyle = r === glowRow ? '#ffd54f' : accent;
    ctx.globalAlpha = r === glowRow ? 1 : 0.55;
    for (const side of [-1, 1]) {
      const ax = side < 0 ? left - 34 : right + 34;
      ctx.beginPath();
      ctx.moveTo(ax + side * 12, y);
      ctx.lineTo(ax - side * 8, y - 14);
      ctx.lineTo(ax - side * 8, y + 14);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}

/** 盤を描く。skip は描かない石 */
function drawBoard(ctx: CanvasRenderingContext2D, cols: Board, skip?: (c: number, r: number) => boolean) {
  const { x, width } = layout(cols.length);
  cols.forEach((col, c) => col.forEach((v, r) => !skip?.(c, r) && drawStone(ctx, v, x(c), rowY(r), width)));
}

/** ヒント：ずらす向きの大きな矢印を、段の上に重ねる */
function drawHint(ctx: CanvasRenderingContext2D, n: number, move: Move) {
  const { left, right } = layout(n);
  const y = rowY(move.row);
  const mid = (left + right) / 2;
  ctx.save();
  ctx.strokeStyle = '#ffd54f';
  ctx.fillStyle = '#ffd54f';
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  ctx.moveTo(mid - move.dir * 90, y);
  ctx.lineTo(mid + move.dir * 80, y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(mid + move.dir * 104, y);
  ctx.lineTo(mid + move.dir * 76, y - 20);
  ctx.lineTo(mid + move.dir * 76, y + 20);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawBanner(ctx: CanvasRenderingContext2D, text: string, p: number, color: string) {
  ctx.save();
  ctx.globalAlpha = Math.min(1, p * 4) * (p > 0.8 ? (1 - p) * 5 : 1);
  ctx.font = `800 ${Math.round(46 + 10 * Math.sin(Math.min(1, p * 3) * Math.PI))}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 8;
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.strokeText(text, VIEW.width / 2, 120);
  ctx.fillStyle = color;
  ctx.fillText(text, VIEW.width / 2, 120);
  ctx.restore();
}

/** 動きの全体の時間 */
const durationOf = (out: Outcome) =>
  SHIFT_MS + FALL_MS + out.rounds.length * (FLASH_MS + SINK_MS) + (out.dugCols.length > 0 ? DIG_MS : 0);

function drawAnim(ctx: CanvasRenderingContext2D, state: State, anim: Anim<State, Outcome>) {
  const out = anim.events;
  const before = anim.from.cols;
  const n = before.length;
  const { x, width, spacing, left, right } = layout(n);
  let ms = anim.t * durationOf(out);
  const { row, dir } = out.move;

  // 1. 段が横にずれる（端から出た石は、反対の端から入る）
  if (ms < SHIFT_MS) {
    const p = ease(ms / SHIFT_MS);
    drawBoard(ctx, before, (_, r) => r === row);
    ctx.save();
    ctx.beginPath();
    ctx.rect(left - 4, BOARD_TOP - 10, right - left + 8, BASE_Y - BOARD_TOP + 20);
    ctx.clip();
    before.forEach((col, c) => {
      if (col.length <= row) return;
      const px = x(c) + dir * spacing * p;
      drawStone(ctx, col[row], px, rowY(row), width);
      // 端から出る石は、反対の端からも描く
      if (c + dir < 0 || c + dir >= n) drawStone(ctx, col[row], px - dir * spacing * n, rowY(row), width);
    });
    ctx.restore();
    return;
  }
  ms -= SHIFT_MS;

  // 2. 下が空いた石が落ちる
  if (ms < FALL_MS) {
    const p = ms / FALL_MS;
    const moving = new Set(out.falls.map((f) => `${f.col},${f.toRow}`));
    drawBoard(ctx, out.afterShift, (c, r) => moving.has(`${c},${r}`));
    for (const f of out.falls) {
      const drop = f.fromRow - f.toRow;
      // 落ちる距離が長いほど、重さが出るよう加速して落とす
      const y = rowY(f.fromRow) + (rowY(f.toRow) - rowY(f.fromRow)) * (drop > 0 ? p * p : 1);
      drawStone(ctx, f.value, x(f.col), y, width);
    }
    return;
  }
  ms -= FALL_MS;

  // 3. そろった石が光って割れ、上の石が落ちる（1回ごとが連鎖の1段）
  for (let k = 0; k < out.rounds.length; k++) {
    const round = out.rounds[k];
    const board = k === 0 ? out.afterShift : out.rounds[k - 1].after;
    const gone = new Set(round.removed.map(([c, r]) => `${c},${r}`));
    const label = k >= 1 ? t(`${k + 1} 連鎖！`, `${k + 1}x CHAIN!`) : null;
    if (ms < FLASH_MS) {
      const p = ms / FLASH_MS;
      drawBoard(ctx, board, (c, r) => gone.has(`${c},${r}`));
      for (const [c, r] of round.removed) {
        if (p < 0.45) drawStone(ctx, board[c][r], x(c), rowY(r), width, { glow: p / 0.45, scale: 1 + p * 0.15 });
        else drawShards(ctx, board[c][r], x(c), rowY(r), (p - 0.45) / 0.55);
      }
      if (label) drawBanner(ctx, label, p * 0.6, '#ffd54f');
      return;
    }
    ms -= FLASH_MS;
    if (ms < SINK_MS) {
      const p = ease(ms / SINK_MS);
      board.forEach((col, c) => {
        let below = 0;
        col.forEach((v, r) => {
          if (gone.has(`${c},${r}`)) {
            below++;
            return;
          }
          drawStone(ctx, v, x(c), rowY(r) + (rowY(r - below) - rowY(r)) * p, width);
        });
      });
      if (label) drawBanner(ctx, label, 0.6 + p * 0.4, '#ffd54f');
      return;
    }
    ms -= SINK_MS;
  }

  // 4. 化石を掘り出す
  const p = Math.min(1, ms / DIG_MS);
  drawBoard(ctx, state.cols);
  const settled = out.rounds.length > 0 ? out.rounds[out.rounds.length - 1].after : out.afterShift;
  for (const c of new Set(out.dugCols)) {
    const r0 = settled[c].length - 1;
    ctx.save();
    ctx.globalAlpha = 0.5 * (1 - p);
    ctx.fillStyle = '#fff3c4';
    ctx.beginPath();
    ctx.arc(x(c), rowY(r0) - ease(p) * 140, 70 * (0.6 + p), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    drawStone(ctx, FOSSIL, x(c), rowY(r0) - ease(p) * 140, width, { scale: 1 + p * 0.3, alpha: p < 0.8 ? 1 : (1 - p) * 5 });
  }
  const [ja, en] = FOSSIL_NAME[depthOf(current)];
  drawBanner(ctx, t(`${ja}を掘り出した！`, `${en} unearthed!`), p, '#fff3c4');
}

function draw(ctx: CanvasRenderingContext2D, state: State, anim: Anim<State, Outcome> | null) {
  drawBackground(ctx);
  const hint = !anim && hinted?.state === state ? hinted.move : null;
  drawFrame(ctx, anim ? anim.from.cols : state.cols, anim ? anim.events.move.row : hint?.row ?? null);
  if (anim) {
    drawAnim(ctx, state, anim);
    return;
  }
  drawBoard(ctx, state.cols);
  if (hint) drawHint(ctx, state.cols.length, hint);
}

function rowAt(py: number): number | null {
  if (py < BOARD_TOP || py > BASE_Y) return null;
  return Math.min(CAP - 1, Math.floor((BASE_Y - py) / ROW));
}

/** 1手の効果音。ずれる「ズッ」→ 落ちる「ゴトッ」→ 光る「キィン」→ 割れる「パリン」、化石は短い節 */
function tonesOf(out: Outcome): NonNullable<Step<State, Outcome>['tones']> {
  const tones: NonNullable<Step<State, Outcome>['tones']> = [{ at: 0, hz: 140, ms: 160, volume: 0.3 }];
  if (out.falls.some((f) => f.fromRow > f.toRow)) tones.push({ at: SHIFT_MS + FALL_MS - 40, hz: 95, ms: 140, volume: 0.35 });
  let at = SHIFT_MS + FALL_MS;
  out.rounds.forEach((_, k) => {
    const up = 1 + k * 0.12;
    tones.push({ at, hz: 1320 * up, ms: 140, volume: 0.12 });
    tones.push({ at: at + FLASH_MS * 0.45, hz: 1980 * up, ms: 160, volume: 0.1 });
    tones.push({ at: at + FLASH_MS, hz: 92, ms: 170, volume: 0.3 });
    at += FLASH_MS + SINK_MS;
  });
  if (out.dugCols.length > 0) [523, 659, 784, 1047].forEach((hz, i) => tones.push({ at: at + i * 110, hz, ms: 200, volume: 0.15 }));
  return tones;
}

function shiftStep(state: State, move: Move): Step<State, Outcome> | null {
  const out = play(state, move);
  if (!out) return { state, sound: 'miss' };
  hinted = null;
  return { state: out.state, events: out, ms: durationOf(out), tones: tonesOf(out) };
}

/** 段の両端の矢印を押した */
function tap(state: State, px: number, py: number): Step<State, Outcome> | null {
  const row = rowAt(py);
  if (row === null || !rowExists(state.cols, row)) return null;
  const { left, right } = layout(state.cols.length);
  if (px < left) return shiftStep(state, { row, dir: -1 });
  if (px > right) return shiftStep(state, { row, dir: 1 });
  return null;
}

/** 段を横になぞった */
function drag(state: State, x0: number, y0: number, x1: number): Step<State, Outcome> | null {
  const row = rowAt(y0);
  if (row === null || !rowExists(state.cols, row)) return null;
  return shiftStep(state, { row, dir: x1 > x0 ? 1 : -1 });
}

function goalText(goal: Goal, moves: number): string {
  switch (goal.kind) {
    case 'clear':
      return t(`${moves}手で 全部消せ`, `Clear everything in ${moves} move${moves > 1 ? 's' : ''}`);
    case 'fossil':
      return t(`${moves}手で 化石を掘り出せ`, `Dig up the fossil in ${moves} move${moves > 1 ? 's' : ''}`);
    case 'chain':
      return t(`${moves}手で ${goal.count}連鎖させろ`, `Make a ${goal.count}x chain in ${moves} move${moves > 1 ? 's' : ''}`);
  }
}

const RULES: RuleEntry[] = [
  {
    from: 0,
    title: t('段をずらす', 'Shift a layer'),
    text: t(
      '段を指で横になぞるか、段の端の矢印を押すと、その段だけが1マスずれる。端から出た石は反対の端に入る。ずれた段の上の石は、自分の柱に残る。',
      'Swipe a layer sideways, or tap the arrows at its ends, to slide just that layer by one. A stone pushed off one end comes in at the other. Stones above stay in their own column.',
    ),
  },
  {
    from: 0,
    title: t('そろえて消す', 'Match to clear'),
    text: t('縦か横に、同じ色が3つ以上並ぶと消える。', 'Three or more of the same color in a row or column clear.'),
  },
  {
    from: 3,
    title: t('崩れ落ちる', 'Collapse'),
    text: t('ずらした後、下が空いた石は真下に落ちる。落ちた先でそろっても消える。', 'After a shift, any stone with nothing under it falls straight down. Matches made by falling clear too.'),
  },
  {
    from: 6,
    title: t('連鎖', 'Chains'),
    text: t('消えた所に上の石が落ちて、またそろうと、続けて消える。', 'When stones fall into the gaps and line up again, they clear in a chain.'),
  },
  {
    from: LEVELS.findIndex((l) => l.goal.kind === 'fossil'),
    title: t('化石', 'Fossils'),
    text: t(
      '化石は段と一緒にずれて、落ちる。そろっても消えない。上に何も無くなると掘り出せる。',
      'Fossils slide and fall with the layers, but never clear. Once nothing is on top of one, it is dug up.',
    ),
  },
  {
    from: 0,
    scope: 'general',
    title: t('手数', 'Moves'),
    text: t(
      '各ステージは決まった手数で目標を果たす。↶ で1手戻せる。↻ で最初からやり直す。',
      'Each stage must be solved in an exact number of moves. ↶ undoes a move. ↻ restarts.',
    ),
  },
  {
    from: 0,
    scope: 'general',
    title: t('ヒント', 'Hints'),
    text: t(
      '同じステージで2回失敗するたびに、ヒントが1回分増える（1ステージ3回まで）。ヒントは次にずらす段と向きを見せる。',
      'Every 2 fails on a stage earn one hint (up to 3 per stage). A hint shows which layer to slide, and which way.',
    ),
  },
];

export const game: GameDef<State, Outcome> = {
  saveKey: 'fossil-sort.v2',
  title: 'Fossil Sort',
  howto: t(
    '地層の段を横にずらすと、はみ出た石が崩れ落ちる。色を3つそろえて消し、連鎖を起こして、化石を掘り出そう。',
    'Slide layers of rock sideways and watch them collapse. Match 3 colors, set off chains, and dig up fossils.',
  ),
  view: VIEW,
  levelCount: LEVELS.length,
  starless: true,
  autoRules: false,
  start(level) {
    current = level;
    const state = createState(LEVELS[level]);
    // 最初のステージは、文字の説明の代わりに、ずらす段と向きを最初から見せる
    hinted = level === 0 ? { state, move: SOLUTIONS[0][0] } : null;
    return state;
  },
  status,
  stars: () => 3,
  counter: (state) => t(`残り ${state.limit - state.moves} 手`, `${state.limit - state.moves} move${state.limit - state.moves === 1 ? '' : 's'} left`),
  hint: (level) => goalText(LEVELS[level].goal, LEVELS[level].moves),
  failText(state) {
    if (legalMoves(state).length === 0) return t('ずらせる段が無い', 'No layer can move');
    return t('手数を使い切った', 'Out of moves');
  },
  tap,
  drag,
  rules: RULES,
  undoable: true,
  showHint(state) {
    const sol = solve(state);
    if (!sol || sol.moves.length === 0) {
      hinted = null;
      return t('この形からは解けない。1手戻すか、やり直そう', 'This position cannot be solved. Undo or restart');
    }
    hinted = { state, move: sol.moves[0] };
    return t('矢印の向きに、光っている段をずらしてみよう', 'Slide the glowing layer the way the arrow points');
  },
  draw,
};
