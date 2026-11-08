import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { escapeHtml, sameState, persistPlacement, defaultHeightFor, clampHeight, clampPlacement, parseBadgePos, parseBadgeMini, clampBadgePosition } from '../src/client/index.ts'

test('会话标题在插入 HTML 前转义文本和属性危险字符', () => {
  const title = '<img src=x onerror=alert(1)>"&\''
  assert.equal(escapeHtml(title), '&lt;img src=x onerror=alert(1)&gt;&quot;&amp;&#39;')
  const source = readFileSync(new URL('../src/client/index.ts', import.meta.url), 'utf8')
  assert.match(source, /title="\$\{title\}">\$\{title\}<\/span>/)
  assert.match(source, /wtb-boardName">\$\{escapeHtml\(t\.title\)\}<\/span>/)
  // v17 起 host 不再下发旧周期字段（见下一行断言的字面量）：防已删字段残留回潮（恒 undefined 的死链路）
  assert.doesNotMatch(source, /realmByPeriod/)
})

// sameState 最小 State 夹具：只填 sameState 读取的字段
const stateOf = (score) => ({
  ok: true,
  day: '2026-08-27',
  range: 'day',
  overview: {
    activeMinutes: 60, avgActiveMinutes: 60, peakParallel: 1, calls: 10,
    inputTokens: 100, outputTokens: 200, llmRatio: 0.5, toolRatio: 0.5,
    xianPct: 0, activeDays: 1,
  },
  threads: [],
  heat: { kind: 'day', heatSlots: [1, 0], heatCalls: [1, 0], heatTokens: [1, 0] },
  backfill: { complete: true, done: 0, total: 0 },
  score,
})

test('sameState：修仙值/境界/突破奖励/入定成长变化 → 不再跳过重建', () => {
  // 完全相同（含 score 一致）→ 无变化
  assert.equal(sameState(stateOf({ value: 100, realm: '炼气期' }), stateOf({ value: 100, realm: '炼气期' })), true)
  // 仅修仙值变（步骤/输入次数维增量：overview 已比较字段全不变）→ 有变化
  assert.equal(sameState(stateOf({ value: 100, realm: '炼气期' }), stateOf({ value: 101, realm: '炼气期' })), false)
  // 周期视图 realm 来自 maxFinal（与总值不同源）：value 不变、realm 变 → 有变化
  assert.equal(sameState(stateOf({ value: 100, realm: '炼气期' }), stateOf({ value: 100, realm: '筑基期' })), false)
  // 突破奖励 / 入定成长变化 → 有变化（评分卡对应行须刷新）
  assert.equal(sameState(stateOf({ value: 100, bonus: 0 }), stateOf({ value: 100, bonus: 30000 })), false)
  assert.equal(sameState(stateOf({ value: 100, growth: 1 }), stateOf({ value: 100, growth: 1.1 })), false)
  // score 双缺省 → 不误判为变化
  assert.equal(sameState(stateOf(undefined), stateOf(undefined)), true)
})

test('persistPlacement：唯一写入口统一全量 {x,y,h} 形状（挪位不抹高度）', () => {
  // node --test 无真 localStorage：仅验证导出存在与调用不抛（模块内 try/catch 吞掉存储异常）
  assert.equal(typeof persistPlacement, 'function')
  persistPlacement({ x: 10, y: 20 }, 600) // 不抛 = 通过
  persistPlacement(null, null)
  // 源码契约：localStorage.setItem(POS_KEY 只此一处写入；两处回调全部走 persistPlacement
  const source = readFileSync(new URL('../src/client/index.ts', import.meta.url), 'utf8')
  assert.match(source, /persistPlacement\(this\.pos, this\.height\) \/\/ 全量形状：挪位不抹掉已存高度/)
  assert.match(source, /persistPlacement\(this\.pos, this\.height\) \/\/ 全量形状：调高度不丢位置/)
})

test('defaultHeightFor / clampHeight：视口自适应 + 边界钳制', () => {
  // 软默认：常规视口 70%
  assert.equal(defaultHeightFor(1080), 756)
  assert.equal(defaultHeightFor(900), 630)
  // 下限 480 兜底小视口月视图年历可用
  assert.equal(defaultHeightFor(650), 480)
  // 上限 视口-24 同 CSS max-height；极小视口退化时仍 ≤ vh-24
  assert.equal(defaultHeightFor(400), 376)
  // clampHeight：下限 220
  assert.equal(clampHeight(100, 1080), 220)
  assert.equal(clampHeight(5000, 1080), 1056)
  // 极小视口 max<min 退化：取 220（渲染端另有 CSS max-height 兜底）
  assert.equal(clampHeight(100, 200), 220)
})

test('clampPlacement：记忆坐标过视口钳制（防跨窗口/改尺寸后展开在屏外）', () => {
  // 视口内坐标原样保留
  assert.deepEqual(clampPlacement({ x: 100, y: 80 }, 1920, 1080), { x: 100, y: 80 })
  // 旧坐标超出右/下边界（换小窗口/换显示器）：x 收进 视口宽-面板宽-8，y 收进 视口高-48（拖拽头部可见）
  assert.deepEqual(clampPlacement({ x: 2200, y: 900 }, 1600, 900), { x: 1192, y: 852 })
  // 负坐标（另一台显示器在左侧时拖出）收到下限 8
  assert.deepEqual(clampPlacement({ x: -300, y: -50 }, 1920, 1080), { x: 8, y: 8 })
  // 极小视口退化：x 上限取下限族 8~16，不产生 max<min 反转
  const tiny = clampPlacement({ x: 5000, y: 5000 }, 300, 200)
  assert.equal(tiny.x, 16)
  assert.equal(tiny.y, 152)
})

test('parseBadgePos / parseBadgeMini：坏数据不拖垮渲染，缺省回退默认形态', () => {
  // 正常坐标
  assert.deepEqual(parseBadgePos('{"x":448,"y":224}'), { x: 448, y: 224 })
  // null / 损坏 JSON / 非数字 / 非有限数 → null（未记忆，走 CSS 默认右下角）
  assert.equal(parseBadgePos(null), null)
  assert.equal(parseBadgePos('not-json'), null)
  assert.equal(parseBadgePos('{"x":"448","y":224}'), null)
  assert.equal(parseBadgePos('{"x":null,"y":224}'), null)
  assert.equal(parseBadgePos('{"x":1e999,"y":0}'), null)
  // 折叠态只认 'true'
  assert.equal(parseBadgeMini('true'), true)
  assert.equal(parseBadgeMini('false'), false)
  assert.equal(parseBadgeMini(null), false)
  assert.equal(parseBadgeMini('1'), false)
})

test('clampBadgePosition：拖动/恢复都把角标整体收进视口（4px 边距）', () => {
  const size = { w: 156, h: 46 }
  // 视口内的坐标原样保留（取整）
  assert.deepEqual(clampBadgePosition({ x: 100.4, y: 80.6 }, 1920, 1080, size), { x: 100, y: 81 })
  // 拖出右下/左上：收进 视口-尺寸-4 / 4
  assert.deepEqual(clampBadgePosition({ x: 5000, y: 5000 }, 1920, 1080, size), { x: 1760, y: 1030 })
  assert.deepEqual(clampBadgePosition({ x: -300, y: -80 }, 1920, 1080, size), { x: 4, y: 4 })
  // 折叠圆点用 30×30：右下角上限更靠边
  assert.deepEqual(clampBadgePosition({ x: 5000, y: 5000 }, 800, 600, { w: 30, h: 30 }), { x: 766, y: 566 })
  // 极小视口：上限与下限同族（4），不产生 min>max 反转
  assert.deepEqual(clampBadgePosition({ x: 99, y: 99 }, 20, 20, size), { x: 4, y: 4 })
})

test('角标位置/折叠态：渲染输出自带 style 与 data-mini（消除重绘闪烁）', () => {
  const source = readFileSync(new URL('../src/client/index.ts', import.meta.url), 'utf8')
  // 位置必须拼进 innerHTML（节点出生即最终坐标），而不是渲染后再改 style
  assert.match(source, /class="wtb-badge"\$\{style\} data-mini="\$\{mini\}"/)
  assert.match(source, /style="left:\$\{p\.x\}px;top:\$\{p\.y\}px;right:auto;bottom:auto"/)
  // 折叠态渲染时直接带 data-mini，CSS 有对应收缩规则
  assert.match(source, /\.wtb-badge\[data-mini="1"\]\{width:30px;height:30px/)
  // 手势样式：拖动期间不选中文本、不滚动页面
  assert.match(source, /\.wtb-badge\{touch-action:none;user-select:none;-webkit-user-select:none\}/)
  // 拖动阈值/长按/误点抑制常量存在且被使用
  assert.match(source, /const BADGE_DRAG_THRESHOLD = 5/)
  assert.match(source, /const BADGE_LONG_PRESS_MS = 550/)
  assert.match(source, /const BADGE_CLICK_SUPPRESS_MS = 500/)
  assert.match(source, /setPointerCapture\(e\.pointerId\)/)
  assert.match(source, /persistBadgeMini\(mini\)/)
})
