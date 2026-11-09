import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { escapeHtml, sameState, persistPlacement, defaultHeightFor, clampHeight, clampPlacement } from '../src/client/index.ts'

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

test('clampPlacement：拖拽越界回归——起点+delta 越界后仍落在 [8, vw-panelW-8] x [8, vh-48]', () => {
  // 与 clampPlacement 内部同源的 panelW：min(400, max(220, vw-24))
  const bounds = (vw, vh) => {
    const panelW = Math.min(400, Math.max(220, vw - 24))
    return { minX: 8, maxX: Math.max(8, vw - panelW - 8), minY: 8, maxY: Math.max(8, vh - 48) }
  }
  // 宽屏：向右下拖 9999px 顶到边界，向左上拖 9999px 收到下限（拖不丢面板）
  assert.deepEqual(clampPlacement({ x: 300 + 9999, y: 200 + 9999 }, 1440, 900), { x: 1032, y: 852 })
  assert.deepEqual(clampPlacement({ x: 300 - 9999, y: 200 - 9999 }, 1440, 900), { x: 8, y: 8 })
  // 多视口 × 多方向：任意越界 delta 的结果都必须整体在屏内、且 header 至少留 48px
  const viewports = [[1440, 900], [1024, 768], [390, 844], [320, 480]]
  const deltas = [[9999, 0], [-9999, 0], [0, 9999], [0, -9999], [9999, 9999], [-9999, -9999], [0, 0]]
  for (const [vw, vh] of viewports) {
    const b = bounds(vw, vh)
    for (const [dx, dy] of deltas) {
      const p = clampPlacement({ x: 300 + dx, y: 200 + dy }, vw, vh)
      assert.ok(p.x >= b.minX && p.x <= b.maxX, `${vw}x${vh} d(${dx},${dy}) x=${p.x} 越界`)
      assert.ok(p.y >= b.minY && p.y <= b.maxY, `${vw}x${vh} d(${dx},${dy}) y=${p.y} 越界`)
      // 右边缘不出屏（maxX >= minX 的常规视口）
      assert.ok(p.x + Math.min(400, Math.max(220, vw - 24)) <= vw, `${vw}x${vh} 右边缘出屏`)
    }
  }
})

test('面板拖拽：move/up 均经 clampPlacement 钳制，坏坐标不再写进 localStorage', () => {
  const source = readFileSync(new URL('../src/client/index.ts', import.meta.url), 'utf8')
  // move：起点 + 实时 delta 先钳制再写 style
  assert.match(source, /const p = clampPlacement\(\{ x: startLeft \+ ev\.clientX - startX, y: startTop \+ ev\.clientY - startY \}, window\.innerWidth, window\.innerHeight\)/)
  assert.match(source, /root\.style\.left = `\$\{p\.x\}px`/)
  assert.match(source, /root\.style\.top = `\$\{p\.y\}px`/)
  // 旧实现（裸 delta 直写）必须已消失
  assert.doesNotMatch(source, /root\.style\.left = `\$\{startLeft \+ ev\.clientX - startX\}px`/)
  // up：落盘前再钳一次
  assert.match(source, /this\.pos = clampPlacement\(\{ x: root\.offsetLeft, y: root\.offsetTop \}, window\.innerWidth, window\.innerHeight\)/)
})

test('面板把手（grip）：head 首子元素 + 可拖拽 + touch-action:none', () => {
  const source = readFileSync(new URL('../src/client/index.ts', import.meta.url), 'utf8')
  // 标记：grip 是 .wtb-head 的第一个子元素
  assert.match(source, /<div class="wtb-head">\s*<div class="wtb-grip" aria-hidden="true"><\/div>/)
  // CSS：把手本体（含 touch-action:none，触屏不让浏览器把拖动当滚动手势）与抓握条
  assert.match(source, /\.wtb-grip\{[^}]*position:absolute[^}]*left:50%[^}]*cursor:grab[^}]*touch-action:none[^}]*\}/)
  assert.match(source, /\.wtb-grip::after\{content:"";width:44px;height:4px;border-radius:2px;background:currentColor;opacity:\.28\}/)
  assert.match(source, /\.wtb-grip:active::after\{opacity:\.6\}/)
  // 触屏：.wtb-head 也要 touch-action:none，否则 pointer 流被浏览器滚动手势取消
  assert.match(source, /\.wtb-head\{[^}]*touch-action:none[^}]*\}/)
  // 把手不能被任何 pointerdown 排除列表拦掉（否则抓手不响应拖拽）
  const selectors = [...source.matchAll(/closest\('([^']+)'\)/g)].map((m) => m[1])
  assert.ok(selectors.length >= 2)
  for (const sel of selectors) assert.doesNotMatch(sel, /wtb-grip/)
})

test('面板主题：核心表面走宿主变量（暗色兜底值不变）+ 浅色补丁限定 body:not([data-ds-dark-theme])', () => {
  const source = readFileSync(new URL('../src/client/index.ts', import.meta.url), 'utf8')
  // .wtb-panel：底色/描边/文字色改用宿主变量，兜底仍是原暗色
  assert.match(source, /\.wtb-panel\{[^}]*background:var\(--dsw-alias-bg-layer-1,rgba\(24,24,30,\.96\)\)/)
  assert.match(source, /\.wtb-panel\{[^}]*border:1px solid var\(--dsw-alias-border-l2,rgba\(255,255,255,\.09\)\)/)
  assert.match(source, /\.wtb-panel\{[^}]*color:var\(--dsw-alias-label-primary,#f0e6d2\)/)
  // .wtb-head：底色/分隔线同源
  assert.match(source, /\.wtb-head\{[^}]*background:var\(--dsw-alias-bg-layer-2,rgba\(255,255,255,\.04\)\)/)
  assert.match(source, /\.wtb-head\{[^}]*border-bottom:1px solid var\(--dsw-alias-border-l1,rgba\(255,255,255,\.06\)\)/)
  // 浅色补丁：每条都带 body:not([data-ds-dark-theme]) 前缀（暗色宿主零影响），条数受控
  const light = source.match(/^body:not\(\[data-ds-dark-theme\]\) \.wtb-[^\r\n]+$/gm) ?? []
  assert.ok(light.length >= 8 && light.length <= 24, `浅色补丁条数异常：${light.length}`)
  // 只覆盖真实存在的类：.wtb-muted 在本文件里不存在，不得出现在补丁中
  assert.doesNotMatch(source, /data-ds-dark-theme\]\) \.wtb-muted/)
})
