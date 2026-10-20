// Fossil Sort の画面。外枠（shell）に渡す中身：描く・タップを手に直す・動きを見せる・ルールブック。
import { depthOf, HORIZONTAL_FROM, LEVELS, type Depth } from '../game/levels';
import { CAP, createState, FOSSIL, isFossilStage, legalMoves, play, stars, status, stranded, topRun, type Board, type Move, type Outcome, type State } from '../game/rules';
import { solve } from '../game/solve';
import { t } from './i18n';
import type { Anim, GameDef, RuleEntry, Step } from './shell';

export const VIEW = { width: 720, height: 700 } as const;

/** 石の一番下の線 */
const BASE_Y = 600;
/** 1段の高さ */
const ROW = 74;
const PILLAR_TOP = BASE_Y - CAP * ROW - 14;

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
const MOVE_MS = 220;
const FLASH_MS = 300;
const SINK_MS = 190;
const DIG_MS = 900;

/** 今遊んでいるステージ（化石の種類と背景、星の数え方に使う） */
let current = 0;
/** 選んでいる柱と、ヒントの手。どの状態の時に選んだかも持ち、状態が変わったら消えたことにする */
let selected: { state: State; col: number } | null = null;
let hinted: { state: State; move: Move } | null = null;

const ease = (p: number) => 1 - (1 - p) * (1 - p);

function layout(n: number) {
  const spacing = Math.min(124, 680 / n);
  const width = Math.min(96, spacing * 0.82);
  const x = (i: number) => VIEW.width / 2 + (i - (n - 1) / 2) * spacing;
  return { spacing, width, x };
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
      for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) {
        ctx.moveTo(x + (w * (i + 0.5)) / 4 + 5, y + (h * (j + 0.5)) / 2);
        ctx.arc(x + (w * (i + 0.5)) / 4, y + (h * (j + 0.5)) / 2, 5, 0, Math.PI * 2);
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
      for (let k = 0; k <= 6; k++) ctx.lineTo(x + (w * k) / 6, y + (k % 2 ? h * 0.3 : h * 0.65));
      ctx.stroke();
      break;
    case 4:
      for (let i = 0; i < 3; i++) {
        const cx = x + (w * (i + 0.5)) / 3, cy = y + h / 2;
        ctx.moveTo(cx - 7, cy);
        ctx.lineTo(cx + 7, cy);
        ctx.moveTo(cx, cy - 7);
        ctx.lineTo(cx, cy + 7);
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
  const sw = (w - 8) * s, sh = (ROW - 8) * s;
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

function drawPillars(ctx: CanvasRenderingContext2D, n: number, sel: number | null) {
  const { x, width } = layout(n);
  const accent = DEPTH_LOOK[depthOf(current)].accent;
  for (let i = 0; i < n; i++) {
    const left = x(i) - width / 2 - 4;
    roundRect(ctx, left, PILLAR_TOP, width + 8, BASE_Y - PILLAR_TOP + 8, 14);
    ctx.fillStyle = 'rgba(0,0,0,0.38)';
    ctx.fill();
    ctx.strokeStyle = i === sel ? accent : 'rgba(255,255,255,0.10)';
    ctx.lineWidth = i === sel ? 4 : 2;
    ctx.stroke();
    // 台座
    roundRect(ctx, left - 6, BASE_Y + 8, width + 20, 18, 6);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fill();
  }
}

/** 盤を描く。skip は描かない石、lift は柱ごとに上の何個を持ち上げるか */
function drawBoard(ctx: CanvasRenderingContext2D, cols: Board, opts: { skip?: (c: number, r: number) => boolean; lift?: number[] } = {}) {
  const { x, width } = layout(cols.length);
  cols.forEach((col, c) => {
    col.forEach((v, r) => {
      if (opts.skip?.(c, r)) return;
      const lifted = (opts.lift?.[c] ?? 0) > 0 && r >= col.length - opts.lift![c];
      drawStone(ctx, v, x(c), rowY(r) - (lifted ? 18 : 0), width);
    });
  });
}

function drawArrow(ctx: CanvasRenderingContext2D, n: number, move: Move) {
  const { x } = layout(n);
  const x0 = x(move.from), x1 = x(move.to), y = PILLAR_TOP - 30;
  const mid = (x0 + x1) / 2, rise = 40 + Math.abs(x1 - x0) * 0.15;
  ctx.save();
  ctx.strokeStyle = '#ffd54f';
  ctx.fillStyle = '#ffd54f';
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x0, y);
  ctx.quadraticCurveTo(mid, y - rise * 2, x1, y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x1, y + 8);
  ctx.lineTo(x1 - 13, y - 14);
  ctx.lineTo(x1 + 13, y - 14);
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
  ctx.strokeText(text, VIEW.width / 2, 110);
  ctx.fillStyle = color;
  ctx.fillText(text, VIEW.width / 2, 110);
  ctx.restore();
}

/** 動きの全体の時間 */
const durationOf = (out: Outcome) => MOVE_MS + out.rounds.length * (FLASH_MS + SINK_MS) + (out.dugCols.length > 0 ? DIG_MS : 0);

function drawAnim(ctx: CanvasRenderingContext2D, state: State, anim: Anim<State, Outcome>) {
  const out = anim.events;
  const n = out.afterMove.length;
  const { x, width } = layout(n);
  let ms = anim.t * durationOf(out);

  // 1. 石が弧を描いて移る
  if (ms < MOVE_MS) {
    const p = ease(ms / MOVE_MS);
    const to = out.afterMove[out.move.to];
    const fromLen = anim.from.cols[out.move.from].length;
    drawBoard(ctx, out.afterMove, { skip: (c, r) => c === out.move.to && r >= to.length - out.count });
    for (let k = 0; k < out.count; k++) {
      const r0 = fromLen - out.count + k, r1 = to.length - out.count + k;
      const px = x(out.move.from) + (x(out.move.to) - x(out.move.from)) * p;
      const py = rowY(r0) - 18 + (rowY(r1) - rowY(r0) + 18) * p - Math.sin(p * Math.PI) * 110;
      drawStone(ctx, to[r1], px, py, width);
    }
    return;
  }
  ms -= MOVE_MS;

  // 2. そろった石が光って割れ、上の石が沈む（1回ごとが連鎖の1段）
  for (let k = 0; k < out.rounds.length; k++) {
    const round = out.rounds[k];
    const before = k === 0 ? out.afterMove : out.rounds[k - 1].after;
    const gone = new Set(round.removed.map(([c, r]) => `${c},${r}`));
    const label = k >= 1 ? t(`${k + 1} 連鎖！`, `${k + 1}x CHAIN!`) : null;
    if (ms < FLASH_MS) {
      const p = ms / FLASH_MS;
      drawBoard(ctx, before, { skip: (c, r) => gone.has(`${c},${r}`) });
      for (const [c, r] of round.removed) {
        if (p < 0.45) drawStone(ctx, before[c][r], x(c), rowY(r), width, { glow: p / 0.45, scale: 1 + p * 0.15 });
        else drawShards(ctx, before[c][r], x(c), rowY(r), (p - 0.45) / 0.55);
      }
      if (label) drawBanner(ctx, label, p * 0.6, '#ffd54f');
      return;
    }
    ms -= FLASH_MS;
    if (ms < SINK_MS) {
      const p = ease(ms / SINK_MS);
      before.forEach((col, c) => {
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

  // 3. 化石を掘り出す
  const p = Math.min(1, ms / DIG_MS);
  drawBoard(ctx, state.cols);
  for (const c of out.dugCols) {
    ctx.save();
    ctx.globalAlpha = 0.5 * (1 - p);
    ctx.fillStyle = '#fff3c4';
    ctx.beginPath();
    ctx.arc(x(c), rowY(0) - ease(p) * 160, 70 * (0.6 + p), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    drawStone(ctx, FOSSIL, x(c), rowY(0) - ease(p) * 160, width, { scale: 1 + p * 0.3, alpha: p < 0.8 ? 1 : (1 - p) * 5 });
  }
  const [ja, en] = FOSSIL_NAME[depthOf(current)];
  drawBanner(ctx, t(`${ja}を掘り出した！`, `${en} unearthed!`), p, '#fff3c4');
}

function draw(ctx: CanvasRenderingContext2D, state: State, anim: Anim<State, Outcome> | null) {
  drawBackground(ctx);
  const sel = !anim && selected?.state === state ? selected.col : null;
  drawPillars(ctx, state.cols.length, sel);
  if (anim) {
    drawAnim(ctx, state, anim);
    return;
  }
  const lift = state.cols.map((col, c) => (c === sel ? topRun(col) : 0));
  drawBoard(ctx, state.cols, { lift });
  if (hinted?.state === state) drawArrow(ctx, state.cols.length, hinted.move);
}

function colAt(state: State, px: number, py: number): number | null {
  if (py < PILLAR_TOP - 120 || py > BASE_Y + 50) return null;
  const { spacing, x } = layout(state.cols.length);
  for (let i = 0; i < state.cols.length; i++) if (Math.abs(px - x(i)) <= spacing / 2) return i;
  return null;
}

/** 1手の効果音。置く「コトッ」→ 光る「キィン」→ 割れる「パリン」→ 沈む「ズン」、化石は短い節 */
function tonesOf(out: Outcome): NonNullable<Step<State, Outcome>['tones']> {
  const tones: NonNullable<Step<State, Outcome>['tones']> = [{ at: MOVE_MS - 30, hz: 330, ms: 70, volume: 0.25 }];
  let at = MOVE_MS;
  out.rounds.forEach((_, k) => {
    const up = 1 + k * 0.12;
    tones.push({ at, hz: 1320 * up, ms: 140, volume: 0.12 });
    tones.push({ at: at + FLASH_MS * 0.45, hz: 1980 * up, ms: 160, volume: 0.1 });
    tones.push({ at: at + FLASH_MS, hz: 92, ms: 170, volume: 0.35 });
    at += FLASH_MS + SINK_MS;
  });
  if (out.dugCols.length > 0) [523, 659, 784, 1047].forEach((hz, i) => tones.push({ at: at + i * 110, hz, ms: 200, volume: 0.15 }));
  return tones;
}

function tap(state: State, px: number, py: number): Step<State, Outcome> | null {
  const col = colAt(state, px, py);
  const sel = selected?.state === state ? selected.col : null;
  if (col === null) {
    selected = null;
    return { state };
  }
  if (sel === null || sel === col) {
    selected = sel === null && topRun(state.cols[col]) > 0 ? { state, col } : null;
    return { state, sound: selected ? 'tap' : undefined };
  }
  const out = play(state, { from: sel, to: col });
  if (out) {
    selected = null;
    return { state: out.state, events: out, ms: durationOf(out), tones: tonesOf(out) };
  }
  // 移せない柱を選んだ時は、そちらを選び直す（選べない柱なら、外す）
  selected = topRun(state.cols[col]) > 0 ? { state, col } : null;
  return { state, sound: selected ? 'tap' : 'miss' };
}

const FOSSIL_STAGE_FROM = LEVELS.findIndex((l) => l.limit !== undefined);
const CHAIN_FROM = HORIZONTAL_FROM + 1;

const RULES: RuleEntry[] = [
  {
    from: 0,
    title: t('石を移す', 'Move stones'),
    text: t(
      '柱をタップして選び、移す先の柱をタップする。上の同じ色の石はまとめて移る。置けるのは、空の柱か、同じ色の石の上だけ。入りきらない分は元の柱に残る。',
      'Tap a pillar, then tap where to move. Same-colored stones on top move together. You can only place them on an empty pillar or on the same color. Whatever does not fit stays behind.',
    ),
  },
  {
    from: 0,
    title: t('縦にそろえて消す', 'Stack to clear'),
    text: t(
      '1本の柱に同じ色が4つ続くと、結晶になって消える。全部の石を消せばクリア。',
      'Four of the same color in a row on one pillar turn to crystal and break. Clear every stone to win.',
    ),
  },
  {
    from: FOSSIL_STAGE_FROM,
    title: t('化石を掘り出す', 'Dig up fossils'),
    text: t(
      '柱の底に化石が埋まっている。上の石を全部どかすと掘り出せる。化石のステージは手数に上限があり、上限までに全部の化石を掘り出せばクリア（石は残ってもよい）。化石は動かせず、上に石も置けない。',
      'A fossil is buried at the bottom of a pillar. Move every stone off it to dig it up. Fossil stages have a move limit: dig up all fossils within it to win (stones may remain). Fossils cannot be moved, and nothing can be placed on them.',
    ),
  },
  {
    from: HORIZONTAL_FROM,
    title: t('横に並べても消える', 'Line up across'),
    text: t(
      '同じ高さで、隣り合う3本以上の柱が同じ色になると、地層として横一列で消える。消えた段より上の石は1段沈む。縦と横が同時にそろったら、いっしょに消える。',
      'When three or more side-by-side pillars have the same color at the same height, the whole layer clears. Stones above sink down one step. Vertical and horizontal matches clear together.',
    ),
  },
  {
    from: CHAIN_FROM,
    title: t('連鎖', 'Chains'),
    text: t(
      '沈んだ石がまたそろうと、続けて消える。沈んだ後の形を読んで、連鎖を仕込もう。',
      'If the sinking stones line up again, they clear too. Read the shape after the drop and set up chains.',
    ),
  },
  {
    from: 0,
    scope: 'general',
    title: t('星', 'Stars'),
    text: t('最少の手数でクリアすると★3。↶ で1手戻せる。↻ で最初からやり直す。', 'Clear in the fewest moves for ★3. ↶ undoes one move. ↻ restarts.'),
  },
  {
    from: 0,
    scope: 'general',
    title: t('ヒント', 'Hints'),
    text: t(
      '同じステージで2回失敗するたびに、ヒントが1回分増える（1ステージ3回まで）。ヒントは次に移すとよい1手を矢印で見せる。',
      'Every 2 fails on a stage earn one hint (up to 3 per stage). A hint shows the next good move with an arrow.',
    ),
  },
];

function stageHint(level: number): string {
  const l = LEVELS[level];
  if (level === 0) return t('柱をタップして選び、移す先をタップ。同じ色を縦に4つで消える', 'Tap a pillar, then a target. 4 of a color in a column clear');
  if (l.limit !== undefined) return t('化石のステージ：手数の上限までに化石を掘り出す', 'Fossil stage: dig up the fossil within the move limit');
  if (level === HORIZONTAL_FROM) return t('横に3本そろえても消える', 'Three side by side clears too');
  if (level === CHAIN_FROM) return t('沈んだ後にまたそろうと、連鎖する', 'Stones that line up after sinking chain');
  return '';
}

export const game: GameDef<State, Outcome> = {
  saveKey: 'fossil-sort.v1',
  title: 'Fossil Sort',
  howto: t(
    '石を移して、縦に4つ・横に3本そろえて消す。消えると上が沈んで連鎖する。化石のステージでは、底に眠る化石を掘り出す。',
    'Move stones to stack 4 or line up 3 across. Cleared layers make the rest sink and chain. On fossil stages, dig up what lies at the bottom.',
  ),
  view: VIEW,
  levelCount: LEVELS.length,
  start(level) {
    current = level;
    selected = null;
    hinted = null;
    return createState(LEVELS[level]);
  },
  status,
  stars: (state) => stars(state, LEVELS[current].par),
  counter(state) {
    if (isFossilStage(state)) {
      return t(`残り ${state.limit! - state.moves} 手　化石 ${state.dug}/${state.dug + state.fossils}`, `${state.limit! - state.moves} moves left  Fossils ${state.dug}/${state.dug + state.fossils}`);
    }
    return t(`手数 ${state.moves}（最少 ${LEVELS[current].par}）`, `Moves ${state.moves} (best ${LEVELS[current].par})`);
  },
  hint: stageHint,
  failText(state) {
    if (isFossilStage(state) && state.moves >= state.limit!) return t('手数の上限になった', 'Out of moves');
    if (!isFossilStage(state) && stranded(state)) return t('消し切れない色が残った', 'A color can no longer be cleared');
    if (legalMoves(state).length === 0) return t('動かせる石がない', 'No moves left');
    return '';
  },
  tap,
  rules: RULES,
  undoable: true,
  showHint(state) {
    const sol = solve(state);
    if (!sol || sol.moves.length === 0) {
      hinted = null;
      return t('この形からは解けない。1手戻すか、やり直そう', 'This position cannot be solved. Undo or restart');
    }
    hinted = { state, move: sol.moves[0] };
    selected = null;
    return t('矢印の通りに移してみよう', 'Try the move shown by the arrow');
  },
  draw,
};
