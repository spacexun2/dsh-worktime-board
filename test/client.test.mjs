import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { escapeHtml, sameState, persistPlacement, defaultHeightFor, clampHeight } from '../src/client/index.ts'

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
