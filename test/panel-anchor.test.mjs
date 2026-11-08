// panel-anchor.test.mjs — PR②「面板锚点自适应」回归：象限选择 + 视口钳制 + 窄屏抽屉
//
// 被测纯函数（src/client/index.ts 导出，零 DOM 依赖）：
//   panelAnchorGeometry(badge, vw, vh, desiredHeight) → { mode, x, y, width, height, originX, originY }
//   panelOriginPct(badge, box) → transform-origin 百分比（指向角标中心）
//   fallbackBadgeRect(vw, vh) → 取不到角标 DOM 时的兜底矩形
//
// 覆盖：右下/左下/右上/左上四象限的展开方向、贴边角标的 12px 钳制、390×844 手机抽屉、
//       抽屉 80vh 高度上限、极小视口的下限优先退化、transform-origin 指向与越界 clamp。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  panelAnchorGeometry,
  panelOriginPct,
  fallbackBadgeRect,
} from '../src/client/index.ts'

/** 视口边距（与 src/client/index.ts 的 VIEWPORT_MARGIN 同源）。 */
const MARGIN = 12
/** 与 pctOfStyle 同规则：百分比取 1 位小数（消掉浮点零头再比对）。 */
const round1 = (v) => Math.round(v * 10) / 10
/** 角标矩形夹具：按 CSS .wtb-badge 的 120×46 尺寸给出右下角，反推四边。 */
const badgeOf = (right, bottom) => ({ right, bottom, left: right - 120, top: bottom - 46 })

/** 面板必须完整落在视口边距内（1e-6 容差吸收浮点误差）。 */
const assertInside = (geo, vw, vh, label) => {
  assert.ok(geo.x >= MARGIN - 1e-6, `${label}: x=${geo.x} 越过左边距`)
  assert.ok(geo.y >= MARGIN - 1e-6, `${label}: y=${geo.y} 越过上边距`)
  assert.ok(geo.x + geo.width <= vw - MARGIN + 1e-6, `${label}: 右边缘 ${geo.x + geo.width} 越过 ${vw - MARGIN}`)
  assert.ok(geo.y + geo.height <= vh - MARGIN + 1e-6, `${label}: 下边缘 ${geo.y + geo.height} 越过 ${vh - MARGIN}`)
}

// [标签, 角标矩形, 视口宽, 视口高, 期望高度]
const FLOAT_CASES = [
  ['右下角（默认位）', badgeOf(1264, 784), 1280, 800, 560],
  ['左下角', badgeOf(200, 946), 1920, 1080, 756],
  ['左上角', badgeOf(160, 106), 1280, 800, 560],
  ['右上角', badgeOf(1264, 66), 1280, 800, 560],
  ['贴边角标（极端拖拽）', badgeOf(698, 6), 700, 600, 480],
]

test('anchor: 四象限展开方向 + 面板完整落在视口边距内', () => {
  const rows = []
  for (const [label, badge, vw, vh, desired] of FLOAT_CASES) {
    const geo = panelAnchorGeometry(badge, vw, vh, desired)
    assert.equal(geo.mode, 'float', `${label}: 宽屏必须是浮层`)
    assertInside(geo, vw, vh, label)
    const cx = (badge.left + badge.right) / 2
    const cy = (badge.top + badge.bottom) / 2
    if (cx >= vw / 2) {
      // 右半边：面板右边缘贴角标右边缘（向左展开）；贴边被 clamp 时右边缘只在边距内
      assert.equal(geo.x + geo.width, Math.min(badge.right, vw - MARGIN), `${label}: 右对齐失败`)
    } else {
      assert.equal(geo.x, Math.max(badge.left, MARGIN), `${label}: 左对齐失败`)
    }
    if (cy >= vh / 2) {
      // 下半边：面板底边贴角标顶边（向上展开）
      assert.equal(geo.y + geo.height, Math.min(badge.top, vh - MARGIN), `${label}: 向上展开失败`)
    } else {
      assert.equal(geo.y, Math.max(badge.bottom, MARGIN), `${label}: 向下展开失败`)
    }
    rows.push({
      用例: label, 视口: `${vw}×${vh}`, 期望高: desired,
      面板: `${geo.x},${geo.y} ${geo.width}×${geo.height}`,
      原点: `${geo.originX.toFixed(1)}% ${geo.originY.toFixed(1)}%`,
    })
  }
  console.table(rows)
})

test('anchor: 精确坐标（1280×800 右下角默认位）', () => {
  const geo = panelAnchorGeometry(badgeOf(1264, 784), 1280, 800, 560)
  // 右边缘 = 角标右边缘 1264（right:16px 语义不变）；底边 = 角标顶边 738（不再压住角标原位）
  assert.deepEqual(geo, {
    mode: 'float',
    x: 864,
    y: 178,
    width: 400,
    height: 560,
    originX: round1(85),
    originY: round1(100),
  })
  // 浮点零头（340/400*100 = 85.00000000000001）由 style 侧的 1 位小数收敛，这里按同规则比对
  assert.equal(round1(geo.originX), 85)
  assert.equal(round1(geo.originY), 100)
})

test('anchor: 窄屏 ≤640 回落底部抽屉（390×844 手机）', () => {
  const geo = panelAnchorGeometry(badgeOf(374, 828), 390, 844, Math.round(844 * 0.8))
  assert.deepEqual(geo, {
    mode: 'drawer',
    x: 0,
    y: 169,
    width: 390,
    height: 675,
    originX: 50,
    originY: 100,
  })
  // 贴底：底边 = 视口底（y + height === vh），上滑入场从 100% 处起跳
  assert.equal(geo.y + geo.height, 844)
})

test('anchor: 抽屉高度受 80vh 与 220 下限双向夹紧', () => {
  const tall = panelAnchorGeometry(badgeOf(374, 828), 390, 844, 1000)
  assert.equal(tall.height, Math.round(844 * 0.8))
  assert.equal(tall.y, 844 - tall.height)
  const tiny = panelAnchorGeometry(badgeOf(374, 828), 390, 844, 100)
  assert.equal(tiny.height, 220) // 下限优先
  // 极小视口：220 下限会超过视口，交给 CSS max-height:80vh 兜底裁切（与 clampHeight 同哲学）
  const micro = panelAnchorGeometry(badgeOf(284, 184), 300, 200, 220)
  assert.equal(micro.height, 220)
  assert.equal(micro.y, 0)
})

test('anchor: 400px 宽度在窄屏回落（浮层宽度 = min(400, 视口-24)）', () => {
  // 680 是刚过抽屉阈值的窄浮层：400 宽仍放得下，右对齐角标
  const geo = panelAnchorGeometry(badgeOf(664, 584), 680, 600, 420)
  assert.equal(geo.mode, 'float')
  assert.equal(geo.width, 400)
  assertInside(geo, 680, 600, '680 宽窄浮层')
  // 650 → 仍是浮层（阈值是 ≤640），宽度依旧收敛在 400
  assert.equal(panelAnchorGeometry(badgeOf(634, 584), 650, 600, 420).width, 400)
})

test('origin: transform-origin 指向角标中心（越界百分比 clamp 到 0/100）', () => {
  // 角标中心落在面板盒内部 → 百分比直接按比例
  assert.deepEqual(
    panelOriginPct({ left: 60, top: 130, right: 140, bottom: 170 }, { x: 0, y: 0, width: 400, height: 300 }),
    { x: 25, y: 50 },
  )
  // 角标在面板左上外侧 → 双轴 clamp 到 0
  assert.deepEqual(
    panelOriginPct({ left: -200, top: -200, right: -120, bottom: -160 }, { x: 0, y: 0, width: 400, height: 300 }),
    { x: 0, y: 0 },
  )
  // 角标在面板右下外侧 → 双轴 clamp 到 100
  assert.deepEqual(
    panelOriginPct({ left: 800, top: 800, right: 880, bottom: 840 }, { x: 0, y: 0, width: 400, height: 300 }),
    { x: 100, y: 100 },
  )
})

test('fallback: 取不到角标 DOM 时按 CSS 右下角默认位兜底', () => {
  assert.deepEqual(fallbackBadgeRect(1280, 800), { right: 1264, bottom: 784, left: 1144, top: 738 })
  // 兜底矩形喂给锚点算法 → 与真实角标同一象限（圆角外的行为一致）
  const geo = panelAnchorGeometry(fallbackBadgeRect(1920, 1080), 1920, 1080, 756)
  assert.equal(geo.x + geo.width, 1904)
  assert.equal(geo.y + geo.height, 1018)
})
