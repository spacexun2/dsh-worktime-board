/**
 * dsh-worktime-board core 单元测试（node --test，零依赖）。
 * 运行：node --test test/  （node 24 原生 type-stripping 直跑 src/core.ts）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  SLOTS_PER_DAY, MINUTES_PER_SLOT,
  createRecord, setSlot, hasSlot, countSlots, segmentsOf, orSlots,
  slotOf, dayKeyOf, isXianSlot,
  summarizeThread, summarizeRanch,
  serializeRecord, deserializeRecord,
  computeRealm, realmForDays, realmAvgForDays, realmOf, realmTierOf, restTitlePrefix,
  breakthroughBonus, careerBonus, applyBreakthrough, tomatoSegs, tomatoGrowth,
  aggregateRange, calendarDays, calendarRange,
} from '../src/core.ts'

test('slotOf / dayKeyOf 本地时间映射', () => {
  const d = new Date(2026, 7, 16, 3, 27) // 08-16 03:27
  assert.equal(slotOf(d), (3 * 60 + 27) / 5 | 0) // 41
  assert.equal(dayKeyOf(d), '2026-08-16')
  const midnight = new Date(2026, 7, 16, 0, 0)
  assert.equal(slotOf(midnight), 0)
  const last = new Date(2026, 7, 16, 23, 59)
  assert.equal(slotOf(last), 287)
})

test('bitset 置位/计数/段合并', () => {
  const rec = createRecord('2026-08-16', 't1')
  assert.equal(countSlots(rec.slots), 0)
  setSlot(rec, 0)
  setSlot(rec, 1)
  setSlot(rec, 287)
  setSlot(rec, 41)
  assert.equal(hasSlot(rec, 0), true)
  assert.equal(hasSlot(rec, 2), false)
  assert.equal(countSlots(rec.slots), 4)
  const segs = segmentsOf(rec.slots)
  assert.deepEqual(segs, [{ start: 0, end: 2 }, { start: 41, end: 42 }, { start: 287, end: 288 }])
})

test('orSlots 并集（人维度不叠加）', () => {
  const a = createRecord('d', 'a')
  const b = createRecord('d', 'b')
  setSlot(a, 0); setSlot(a, 1)
  setSlot(b, 1); setSlot(b, 2)
  const union = new Uint8Array(SLOTS_PER_DAY / 8)
  orSlots(union, a.slots)
  orSlots(union, b.slots)
  assert.equal(countSlots(union), 3) // 0,1,2 并集 3 个槽而非 4
})

test('修仙槽划分（22:30–06:30，用户定稿）', () => {
  assert.equal(isXianSlot(0), true)   // 00:00
  assert.equal(isXianSlot(59), true)  // 04:55
  assert.equal(isXianSlot(60), true)  // 05:00（现在属于修仙段）
  assert.equal(isXianSlot(77), true)  // 06:25
  assert.equal(isXianSlot(78), false) // 06:30（不含）
  assert.equal(isXianSlot(269), false) // 22:25
  assert.equal(isXianSlot(270), true)  // 22:30（含）
  assert.equal(isXianSlot(287), true)  // 23:55
})

test('summarizeThread：出勤/修仙/调用/token', () => {
  const rec = createRecord('2026-08-16', 't1')
  setSlot(rec, 0)     // 修仙（00:00）
  setSlot(rec, 78)    // 养生（06:30）
  rec.calls[0] = 3
  rec.tokens[0] = 100
  rec.outputTokens = 100
  const s = summarizeThread(rec, '线程A')
  assert.equal(s.activeMinutes, 10)
  assert.equal(s.xianActive, 1)
  assert.equal(s.yangActive, 1)
  assert.equal(s.xianPct, 0.5)
  assert.equal(s.calls, 3)
  assert.equal(s.outputTokens, 100)
})

test('summarizeRanch：并集时长/并行峰值/修仙占比/热力', () => {
  const a = createRecord('2026-08-16', 'a')
  const b = createRecord('2026-08-16', 'b')
  setSlot(a, 0); setSlot(a, 1)
  setSlot(b, 1); setSlot(b, 120)
  a.calls[1] = 2
  b.tokens[1] = 500
  b.outputTokens = 500
  a.llmMs = 1000; b.toolMs = 2000
  const r = summarizeRanch('2026-08-16', [a, b])
  assert.equal(r.activeMinutes, 15)          // 3 槽并集
  assert.equal(r.peakParallel, 2)            // 槽 1 双线程
  assert.equal(r.threadCount, 2)
  assert.equal(r.calls, 2)
  assert.equal(r.outputTokens, 500)
  assert.equal(r.xianActive, 2)              // 槽 0、1 均在 22:30–06:30 修仙段
  assert.equal(r.xianPct, 2 / 3)
  assert.equal(r.llmMs, 1000)
  assert.equal(r.toolMs, 2000)
  assert.ok(Math.abs(r.llmRatio - 1 / 3) < 1e-9)
  assert.equal(r.heatSlots[1], 2)
  assert.equal(r.heatCalls[1], 2)
  assert.equal(r.heatTokens[1], 500)
  assert.equal(r.heatSlots[120], 1)
  // t7 新增：每槽输入 token + 每槽修行值（默认系数：分钟×150→每槽 750 / 调用 10 / 步骤 10 / 输入 150 / token 输入/输出统一 ÷1万）
  assert.equal(r.heatInput[1], 0)              // 未设 billedInputTokensPerSlot → 0
  assert.equal(r.heatRealm[0], 937.5)          // 修仙槽：1.25 × 750
  assert.equal(r.heatRealm[1], 962.5625)       // 修仙槽：1.25 × (750 + 2×10 + 0 + 500/10000)
  assert.equal(r.heatRealm[120], 750)          // 正常槽：750
  let sumRealm = 0
  for (let i = 0; i < 288; i++) sumRealm += r.heatRealm[i]
  assert.equal(sumRealm, 2650.0625)            // 937.5 + 962.5625 + 750
  assert.equal(sumRealm, computeRealm([a, b]).dims.minutes + computeRealm([a, b]).dims.calls
    + computeRealm([a, b]).dims.steps + computeRealm([a, b]).dims.inputs + computeRealm([a, b]).dims.tokens) // 与 computeRealm 口径一致
})

test('summarizeRanch：heatRealm 每槽修行值精确断言（含计费输入 token/步骤/修仙加成）', () => {
  const rec = createRecord('2026-08-16', 't1')
  setSlot(rec, 0) // 修仙槽
  rec.calls[0] = 4
  rec.stepsPerSlot[0] = 2
  rec.tokens[0] = 8000        // 输出
  rec.billedInputTokensPerSlot[0] = 2000 // 计费输入（2026-08-17 主口径）
  const r = summarizeRanch('2026-08-16', [rec])
  // 已知槽：1.25 × (750 + 4×10 + 2×10 + 2000/10000 + 8000/10000) = 1.25 × 811 = 1013.75
  assert.equal(r.heatRealm[0], 1013.75)
  assert.equal(r.heatRealm[1], 0) // 无活动槽 = 0
  assert.equal(r.heatInput[0], 2000)
  assert.equal(r.heatTokens[0], 8000)
  // 非修仙槽对照：同活动正常槽 → (750 + 40 + 20 + 0.2 + 0.8) = 811
  const yang = createRecord('2026-08-16', 't2')
  setSlot(yang, 78) // 06:30 正常槽
  yang.calls[78] = 4
  yang.stepsPerSlot[78] = 2
  yang.tokens[78] = 8000
  yang.billedInputTokensPerSlot[78] = 2000
  const ry = summarizeRanch('2026-08-16', [yang])
  assert.equal(ry.heatRealm[78], 811)
  // Σ heatRealm === computeRealm dims 和（未 ceil 前）
  const realm = computeRealm([rec])
  let sum = 0
  for (let i = 0; i < 288; i++) sum += r.heatRealm[i]
  assert.equal(sum, realm.dims.minutes + realm.dims.calls + realm.dims.steps + realm.dims.inputs + realm.dims.tokens)
})

test('突破奖励：每突破一境界送「下一境界门槛 × 5%」进度分（纯加法，累计只升不降）', () => {
  // 单次奖励：突破到 tier i 送 THRESHOLDS[i]×5%
  // tier1 筑基→金丹门槛 250×5%=12.5；tier6 合体→大乘门槛 20万×5%=1万；tier10 金仙→宇宙洪荒 100万×5%=5万；tier11 巅峰 → 0
  assert.equal(breakthroughBonus(1), 12.5)
  assert.equal(breakthroughBonus(2), 62.5)    // 元婴门槛 1250×0.05
  assert.equal(breakthroughBonus(6), 10000)   // 大乘门槛 20万×0.05
  assert.equal(breakthroughBonus(10), 50000)  // 宇宙洪荒门槛 100万×0.05
  assert.equal(breakthroughBonus(11), 0)
  // 累计：生涯到金仙(10) = 12.5+62.5+312.5+1562.5+5000+10000+17500+25000+35000+50000 = 144450
  assert.equal(careerBonus(1), 12.5)
  assert.equal(careerBonus(10), 144450)
  // rng 恒 1 → 永不失败（存量豁免场景）：基础值 29.5 万（大乘档 7）→ 奖励(7)=34450 → 329450 仍大乘（<35万 不连锁）
  const ok = () => 1
  const r = applyBreakthrough(295000, 0, 0, ok)
  assert.equal(r.tier, 7)
  assert.equal(r.bonus, 34450)
  assert.equal(r.value, 329450)
  assert.equal(r.failed, false)
  // 生涯已是 7：基础 30 万 → 奖励(7) 34450 → 334450 大乘（不再连锁，tier 保持 7）
  const r2 = applyBreakthrough(300000, 7, 0, ok)
  assert.equal(r2.tier, 7)
  assert.equal(r2.value, 334450)
  // 基础值 60 万 + 奖励(9) 94450 = 694450 → 真仙(9)（<70万 不升金仙）
  const r3 = applyBreakthrough(600000, 0, 0, ok)
  assert.equal(r3.tier, 9)
  assert.equal(r3.value, Math.ceil(600000 + careerBonus(9)))
  // 基础值 100 万 + 奖励(10) 144450 → 宇宙洪荒(11)
  const r4 = applyBreakthrough(1000000, 0, 0, ok)
  assert.equal(r4.tier, 11)
  assert.equal(r4.value, Math.ceil(1000000 + careerBonus(10)))
  // 零基础 → 炼气 无奖励
  const r0 = applyBreakthrough(0, 0, 0, ok)
  assert.equal(r0.tier, 0)
  assert.equal(r0.bonus, 0)
  assert.equal(r0.value, 0)
})

test('applyBreakthrough maxSteps=1（2026-08-17 一天一结算：单次结算最多突破 1 档）', () => {
  const ok = () => 1
  // 基础 29.5 万本可连锁 7 档；maxSteps=1 只推进 1 档（生涯 0 → 1 筑基）
  const r = applyBreakthrough(295000, 0, 0, ok, 1)
  assert.equal(r.tier, 1)
  assert.equal(r.bonus, 12.5)             // 仅筑基门槛奖励（金丹门槛 250×5%）
  assert.equal(r.value, 295013)           // ceil(295000 + 12.5)
  // 生涯 7 起步：基础 36 万 + 奖励 34450 = 394450 ≥ 35万门槛 → 只进 1 档（8 渡劫），不再连锁到 9
  const r2 = applyBreakthrough(360000, 7, 0, ok, 1)
  assert.equal(r2.tier, 8)
  assert.equal(r2.bonus, careerBonus(8))
  assert.equal(r2.value, 360000 + careerBonus(8))
  // 未达下一门槛：不动
  const r3 = applyBreakthrough(1000, 2, 0, ok, 1)
  assert.equal(r3.tier, 2)
  assert.equal(r3.value, 1000 + careerBonus(2))
  // 失败路径受 maxSteps 约束：基础 36 万、生涯 7、必失败 → 本应 8 的下一级 = 7（大乘 0% 进度）
  const fail = () => 0
  const rf = applyBreakthrough(360000, 7, 0, fail, 1)
  assert.equal(rf.failed, true)
  assert.equal(rf.tier, 7)
  assert.equal(rf.value, 200000) // 大乘门槛 20 万
})

test('晋升失败：回退到本应晋升最高境界的下一级 0% 进度（只退一级）', () => {
  const fail = () => 0 // rng 恒 0 → 必失败
  // 连升多级失败（大乘 7 起步，基础 36 万 → 无失败连锁到渡劫 8）：失败回退 7（大乘）0% 进度 = 20 万门槛，只退一级
  const r = applyBreakthrough(360000, 7, 0, fail)
  assert.equal(r.failed, true)
  assert.equal(r.tier, 7) // 本应 8 的下一级 = 7
  assert.equal(r.value, 200000) // 大乘期 0% 进度 = 门槛 20 万
  assert.ok(r.failPenalty > 0)
  // 单级晋升失败（真仙 9 → 基础 72 万 + 奖励 94437.5 = 814437.5 连锁到金仙 10）：失败回退 9（真仙）0% 进度
  const r1 = applyBreakthrough(720000, 9, 0, fail)
  assert.equal(r1.failed, true)
  assert.equal(r1.tier, 9) // 本应 10 的下一级 = 9
  assert.equal(r1.value, 500000) // 真仙期 0% 进度 = 门槛 50 万
  // 失败后带罚金重试：rng 恒 1 → 成功晋升且罚金勾销（基础 80 万 + 奖励 − 罚金 194450 → 750000 金仙 10）
  const r3 = applyBreakthrough(800000, 7, r.failPenalty, () => 1)
  assert.equal(r3.failed, false)
  assert.equal(r3.tier, 10) // 80万+144450−194450 = 750000 < 100万 → 金仙
  assert.equal(r3.failPenalty, 0)
})

test('入定段数 + 成长系数：每连续 25 分钟 1 段（允许断 1 槽），成长系数 = 1 + 段数 × 0.1（最终额外乘）', () => {
  // 构造 heatRealm：每槽 1000 分（正常槽口径）
  const arr = new Array(288).fill(0)
  for (let i = 0; i < 5; i++) arr[i] = 1000 // 槽 0-4：1 个入定段
  assert.equal(tomatoSegs(arr), 1)
  assert.equal(tomatoGrowth(1), 1.1)
  // 连续 10 槽 → 2 段（每 5 槽一段，非重叠）
  const arr2 = new Array(288).fill(0)
  for (let i = 0; i < 10; i++) arr2[i] = 1000
  assert.equal(tomatoSegs(arr2), 2)
  assert.equal(tomatoGrowth(2), 1.2)
  // 断 1 槽容错：4 活跃 + 1 空 + 1 活跃（5 个活跃槽夹 1 空）→ 仍 1 段
  const arrGap = new Array(288).fill(0)
  for (let i = 0; i < 4; i++) arrGap[i] = 1000
  arrGap[4] = 0 // 断 1 槽
  arrGap[5] = 1000
  assert.equal(tomatoSegs(arrGap), 1)
  // 连续断 2 槽 → 断档：4 活跃 + 2 空 + 1 活跃 → 0 段
  const arrGap2 = new Array(288).fill(0)
  for (let i = 0; i < 4; i++) arrGap2[i] = 1000
  arrGap2[4] = 0 // 断
  arrGap2[5] = 0 // 连续断 2 槽
  arrGap2[6] = 1000
  assert.equal(tomatoSegs(arrGap2), 0)
  // 断档后重计：5 槽 + 2 空 + 5 槽 → 2 段
  const arr3 = new Array(288).fill(0)
  for (let i = 0; i < 5; i++) arr3[i] = 1000
  arr3[5] = 0 // 断
  arr3[6] = 0 // 连续断 2 槽 → 断档
  for (let i = 7; i < 12; i++) arr3[i] = 1000
  assert.equal(tomatoSegs(arr3), 2)
  // 不足 5 槽不结算：4 槽 → 0 段
  const arr4 = new Array(288).fill(0)
  for (let i = 0; i < 4; i++) arr4[i] = 1000
  assert.equal(tomatoSegs(arr4), 0)
  assert.equal(tomatoGrowth(0), 1)
  // 全零 → 0
  assert.equal(tomatoSegs(new Array(288).fill(0)), 0)
  // 13 段（今日实测场景）→ ×2.3
  assert.equal(tomatoGrowth(13), 2.3)
})

test('computeRealm 纯基础值（突破奖励不内嵌，可对账）', () => {
  const rec = createRecord('2026-08-16', 't1')
  setSlot(rec, 0) // 修仙槽
  rec.calls[0] = 4
  rec.stepsPerSlot[0] = 2
  rec.userInputsPerSlot[0] = 1
  rec.tokens[0] = 8000
  rec.billedInputTokensPerSlot[0] = 2000 // 计费输入（主口径）
  // 1.25 × (750 + 4×10 + 2×10 + 1×150 + 2000/10000 + 8000/10000) = 1.25 × 961 = 1201.25
  const r = computeRealm([rec])
  assert.equal(r.value, 1202) // ceil(1201.25)
  assert.equal(r.dims.minutes, 937.5)
  assert.equal(r.dims.calls + r.dims.steps + r.dims.inputs + r.dims.tokens, 263.75) // 1.25 × (40+20+150+1)
  // 单日 1202 + 累计奖励(生涯档) = 展示总分（applyBreakthrough 叠加）
  // 基础 1202 达元婴档(3) → 奖励(3)=12.5+62.5+312.5=387.5 → 1589.5 → ceil 1590
  const br = applyBreakthrough(1202, 0, 0, () => 1)
  assert.equal(br.tier, 3)
  assert.equal(br.value, 1590)
  assert.equal(br.bonus, 387.5)
})

test('realmTierOf：境界档位（成长里程碑用）', () => {
  assert.equal(realmTierOf(0), 0)       // 炼气
  assert.equal(realmTierOf(49), 0)
  assert.equal(realmTierOf(50), 1)      // 筑基
  assert.equal(realmTierOf(250), 2)     // 金丹
  assert.equal(realmTierOf(100000), 6)  // 合体
  assert.equal(realmTierOf(1000000), 11) // 宇宙洪荒
  assert.equal(realmTierOf(1e15), 11)   // 顶部钳制
})

test('用户输入次数计分（userInputs × 150，修仙槽 ×1.25）', () => {
  const rec = createRecord('2026-08-16', 't1')
  setSlot(rec, 0) // 修仙槽
  rec.userInputsPerSlot[0] = 2 // 2 次用户输入
  const r = computeRealm([rec])
  // 分钟 750×1.25 + 输入 2×150×1.25 = 937.5 + 375 = 1312.5
  assert.equal(r.dims.inputs, 375)
  assert.equal(r.value, 1313) // ceil(1312.5)
  const s = summarizeRanch('2026-08-16', [rec])
  assert.equal(s.userInputs, 2)
  // heatRealm 口径一致：1.25 × (750 + 2×150) = 1312.5
  assert.equal(s.heatRealm[0], 1312.5)
  // 正常槽对照：750 + 2×150 = 1050
  const yang = createRecord('2026-08-16', 't2')
  setSlot(yang, 78)
  yang.userInputsPerSlot[78] = 2
  const ry = summarizeRanch('2026-08-16', [yang])
  assert.equal(ry.heatRealm[78], 1050)
})

test('序列化往返（含 stepsPerSlot）', () => {
  const rec = createRecord('2026-08-16', 't9')
  setSlot(rec, 3); setSlot(rec, 200)
  rec.calls[3] = 7
  rec.stepsPerSlot[3] = 7
  rec.stepsPerSlot[200] = 65535
  rec.tokens[200] = 12345
  rec.inputTokensPerSlot[200] = 45678
  rec.billedInputTokensPerSlot[200] = 67890
  rec.userInputsPerSlot[3] = 9
  rec.llmMs = 42; rec.turns = 5; rec.inputTokens = 999; rec.billedInputTokens = 1111; rec.userInputs = 3
  const back = deserializeRecord(serializeRecord(rec))
  assert.equal(back.day, rec.day)
  assert.equal(back.threadId, rec.threadId)
  assert.equal(hasSlot(back, 3), true)
  assert.equal(hasSlot(back, 200), true)
  assert.equal(hasSlot(back, 4), false)
  assert.equal(back.calls[3], 7)
  assert.equal(back.stepsPerSlot[3], 7)
  assert.equal(back.stepsPerSlot[200], 65535)
  assert.equal(back.tokens[200], 12345)
  assert.equal(back.inputTokensPerSlot[200], 45678)
  assert.equal(back.billedInputTokensPerSlot[200], 67890)
  assert.equal(back.userInputsPerSlot[3], 9)
  assert.equal(back.llmMs, 42)
  assert.equal(back.turns, 5)
  assert.equal(back.inputTokens, 999)
  assert.equal(back.billedInputTokens, 1111)
  assert.equal(back.userInputs, 3)
  // 旧数据无 userInputs / billed 字段 → 反序列化兜底 0
  const legacy = deserializeRecord({
    ...serializeRecord(rec), userInputsPerSlot: undefined, userInputs: undefined,
    billedInputTokensPerSlot: undefined, billedInputTokens: undefined,
  })
  assert.equal(legacy.userInputs, 0)
  assert.equal(legacy.userInputsPerSlot[3], 0)
  assert.equal(legacy.billedInputTokens, 0)
  assert.equal(legacy.billedInputTokensPerSlot[200], 0)
})

test('牛马值：积分公式（245min/792calls/544steps/计费输入77.9万+输出62.4万tok 全修仙 → value=62813 炼虚期）', () => {
  const rec = createRecord('2026-08-16', 't1')
  for (let slot = 0; slot < 49; slot++) setSlot(rec, slot) // 245min = 49 槽，全在修仙段（0-48 < 60）
  rec.calls[0] = 792
  rec.stepsPerSlot[1] = 544
  rec.tokens[2] = 624000        // 输出 token
  rec.billedInputTokensPerSlot[2] = 779000 // 计费输入 token（输入 77.9万 /1万；输出 62.4万 /1万）
  const r = computeRealm([rec])
  // Σ = 1.25 × (49×750 + 7920 + 5440 + 779000/10000 + 624000/10000) = 1.25 × 50250.3 = 62812.875
  assert.equal(r.value, 62813) // ceil(62812.875)
  assert.equal(r.realm, '炼虚期') // 62813 ∈ [31250, 100000)
  assert.equal(r.dims.minutes, 45937.5) // 49×750×1.25
  assert.equal(r.dims.calls, 9900)      // 792×10×1.25
  assert.equal(r.dims.steps, 6800)      // 544×10×1.25
  assert.equal(r.dims.tokens, 175.375)  // (779000/10000 + 624000/10000)×1.25
})

test('境界映射（变比阈值表，用户定稿；阈值 = [50,250,1250,6250,31250,100000,200000,350000,500000,700000,1000000]）', () => {
  assert.equal(realmOf(0), '炼气期')
  assert.equal(realmOf(49), '炼气期')
  assert.equal(realmOf(50), '筑基期')
  assert.equal(realmOf(249), '筑基期')
  assert.equal(realmOf(250), '金丹期')
  assert.equal(realmOf(1249), '金丹期')
  assert.equal(realmOf(1250), '元婴期')
  assert.equal(realmOf(6249), '元婴期')
  assert.equal(realmOf(6250), '化神期')
  assert.equal(realmOf(31249), '化神期')
  assert.equal(realmOf(31250), '炼虚期')
  assert.equal(realmOf(99999), '炼虚期')
  assert.equal(realmOf(100000), '合体期')
  assert.equal(realmOf(199999), '合体期')
  assert.equal(realmOf(200000), '大乘期')
  assert.equal(realmOf(349999), '大乘期')
  assert.equal(realmOf(350000), '渡劫期')
  assert.equal(realmOf(499999), '渡劫期')
  assert.equal(realmOf(500000), '真仙')
  assert.equal(realmOf(699999), '真仙')
  assert.equal(realmOf(700000), '金仙')
  assert.equal(realmOf(999999), '金仙')
  assert.equal(realmOf(1000000), '宇宙洪荒')
  assert.equal(realmOf(1e15), '宇宙洪荒') // 顶部钳制
})

test('修仙加成 1.25 精确断言（同活动修仙/正常槽比值）', () => {
  const xian = createRecord('d', 'xian')
  const yang = createRecord('d', 'yang')
  setSlot(xian, 0)   // 00:00 修仙槽
  setSlot(yang, 78)  // 06:30 正常槽
  xian.calls[0] = 4; xian.stepsPerSlot[0] = 2; xian.tokens[0] = 8000; xian.billedInputTokensPerSlot[0] = 2000
  yang.calls[78] = 4; yang.stepsPerSlot[78] = 2; yang.tokens[78] = 8000; yang.billedInputTokensPerSlot[78] = 2000
  const rx = computeRealm([xian])
  const ry = computeRealm([yang])
  assert.equal(rx.dims.minutes, 937.5)         // 750×1.25
  assert.equal(ry.dims.minutes, 750)
  assert.equal(rx.dims.calls, 50)              // 4×10×1.25
  assert.equal(ry.dims.calls, 40)              // 4×10
  assert.equal(rx.dims.steps, 25)              // 2×10×1.25
  assert.equal(ry.dims.steps, 20)
  assert.equal(rx.dims.tokens, 1.25)           // (2000/10000 + 8000/10000)×1.25
  assert.equal(ry.dims.tokens, 1)              // 0.2 + 0.8
  assert.equal(rx.value, Math.ceil(ry.value * 1.25)) // 1013.75 vs 811（ceil(1013.75)=1014）
})

test('computeRealm：并行线程分钟并集（同槽只计一次，调用/步骤/token 仍 Σ）', () => {
  const a = createRecord('d', 'a')
  const b = createRecord('d', 'b')
  setSlot(a, 78)
  setSlot(b, 78)
  a.calls[78] = 3
  b.calls[78] = 5
  b.stepsPerSlot[78] = 2
  const r = computeRealm([a, b])
  assert.equal(r.dims.minutes, 750) // 并集：同槽只计一次（非 1500）；78 为正常槽无加成
  assert.equal(r.dims.calls, 80)    // (3+5)×10
  assert.equal(r.dims.steps, 20)    // 2×10
  assert.equal(r.value, 850)        // ceil(750+80+20)
})

test('realmForDays：跨天 Σ dims + 空天跳过', () => {
  const mk = (id) => {
    const rec = createRecord('2026-08-16', id)
    for (let slot = 0; slot < 49; slot++) setSlot(rec, slot) // 全修仙 49 槽
    rec.calls[0] = 792
    rec.stepsPerSlot[1] = 544
    rec.tokens[2] = 624000        // 输出 62.4万
    rec.billedInputTokensPerSlot[2] = 779000 // 计费输入 77.9万（合计 140.3万 → /1万 = 140.3）
    return rec
  }
  const day1 = mk('t1')
  const day2 = mk('t2')
  const r = realmForDays([[day1], [], [day2]]) // 中间空天应跳过
  assert.equal(r.dims.minutes, 91875)  // 2 × 45937.5
  assert.equal(r.dims.calls, 19800)    // 2 × 9900
  assert.equal(r.dims.steps, 13600)    // 2 × 6800
  assert.equal(r.dims.tokens, 350.75)  // 2 × 175.375
  assert.equal(r.value, 125626)        // ceil(91875 + 19800 + 13600 + 350.75)
  assert.equal(r.realm, '合体期')       // 变比表：125626 ∈ [100000, 200000)
  const single = realmForDays([[day1]])
  assert.equal(single.value, 62813)
  assert.equal(single.realm, '炼虚期')  // 变比表：62813 ∈ [31250, 100000)
  assert.equal(realmForDays([]).realm, '炼气期') // 空 → 0/炼气期
})

test('realmAvgForDays：周期活跃日均（Σ dims ÷ 活跃天数，≥1 防除零）', () => {
  const mk = (id) => {
    const rec = createRecord('2026-08-16', id)
    for (let slot = 0; slot < 49; slot++) setSlot(rec, slot) // 全修仙 49 槽（单日 62813）
    rec.calls[0] = 792
    rec.stepsPerSlot[1] = 544
    rec.tokens[2] = 624000
    rec.billedInputTokensPerSlot[2] = 779000
    return rec
  }
  const day1 = mk('t1')
  const day2 = mk('t2')
  // 两天满样本 + 空天：活跃 2 天 → 日均 = 62813
  const two = realmAvgForDays([[day1], [], [day2]])
  assert.equal(two.value, 62813)
  assert.equal(two.realm, '炼虚期')
  assert.equal(two.dims.minutes, 45937.5) // 91875 / 2
  assert.equal(two.dims.tokens, 175.375)  // 350.75 / 2
  // 单活跃天：日均 = 当日（62813）
  const one = realmAvgForDays([[day1], []])
  assert.equal(one.value, 62813)
  assert.equal(one.dims.calls, 9900)
  // 三天全活跃：日均不变
  const three = realmAvgForDays([[day1], [day2], [day1]])
  assert.equal(three.value, 62813)
  assert.equal(three.dims.steps, 6800)   // 20400 / 3
  // 空 groups：活跃天数 = 0 → 除数钳 1 → 0 / 炼气期（无 NaN）
  const empty = realmAvgForDays([])
  assert.equal(empty.value, 0)
  assert.equal(empty.realm, '炼气期')
  assert.equal(Number.isNaN(empty.dims.minutes), false)
})

test('作息彩蛋前缀（不进评分）', () => {
  assert.equal(restTitlePrefix(0.6), '🔥 修仙')
  assert.equal(restTitlePrefix(0.05), '🌿 养生')
  assert.equal(restTitlePrefix(0.3), '')
})

test('aggregateRange 跨天聚合', () => {
  const mk = (day, activeMinutes, calls, xianPct) => ({
    day, activeMinutes, calls, inputTokens: 0, outputTokens: 0, llmMs: 0, toolMs: 0,
    xianPct,
  })
  const agg = aggregateRange([
    mk('2026-08-14', 60, 10, 0.1),
    mk('2026-08-15', 0, 0, 0),
    mk('2026-08-16', 120, 20, 0.5),
  ])
  assert.equal(agg.activeDays, 2)
  assert.equal(agg.totalActiveMinutes, 180)
  assert.equal(agg.totalCalls, 30)
  assert.equal(agg.avgXianPct, 0.3)
  assert.equal(agg.trend.length, 2)
})

test('零数据不 NaN（空记录 → 炼气期）', () => {
  const r = summarizeRanch('2026-08-16', [])
  assert.equal(r.activeMinutes, 0)
  assert.equal(r.peakParallel, 0)
  assert.equal(r.xianPct, 0)
  assert.equal(Number.isNaN(r.avgParallel), false)
  const realm = computeRealm([])
  assert.equal(realm.value, 0)
  assert.equal(realm.realm, '炼气期')
  assert.equal(Number.isNaN(realm.value), false)
})

test('calendarDays：周/月日历日序列（含今日、补零日、跨月跨年）', () => {
  const rec = createRecord('2026-08-16', 't1')
  setSlot(rec, 0) // 修仙槽（00:00）
  rec.calls[0] = 3
  rec.tokens[0] = 500
  rec.outputTokens = 500
  const ranch = summarizeRanch('2026-08-16', [rec])
  const map = new Map([['2026-08-16', ranch]])
  // 周：7 项，升序，首日 = today-6，末日 = today
  const week = calendarDays('2026-08-16', 7, map)
  assert.equal(week.length, 7)
  assert.deepEqual(week.map((d) => d.day), [
    '2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14', '2026-08-15', '2026-08-16',
  ])
  assert.equal(week[0].activeMinutes, 0) // 无出勤日补零
  assert.equal(week[0].calls, 0)
  assert.equal(week[0].tokens, 0)
  assert.equal(week[0].xianPct, 0)
  assert.equal(week[6].day, '2026-08-16') // 有记录日填 ranch 数据
  assert.equal(week[6].activeMinutes, 5)
  assert.equal(week[6].calls, 3)
  assert.equal(week[6].tokens, 500)
  assert.equal(week[6].xianPct, 1) // 修仙槽 → 占比 1
  // 月：30 项，跨月（7 月 31 天）
  const month = calendarDays('2026-08-16', 30, map)
  assert.equal(month.length, 30)
  assert.equal(month[0].day, '2026-07-18')
  assert.equal(month[29].day, '2026-08-16')
  assert.equal(month[0].activeMinutes, 0)
  assert.equal(month[29].activeMinutes, 5)
  // 跨年
  const y = calendarDays('2026-01-03', 7, new Map())
  assert.deepEqual(y.map((d) => d.day), [
    '2025-12-28', '2025-12-29', '2025-12-30', '2025-12-31', '2026-01-01', '2026-01-02', '2026-01-03',
  ])
  // 全零 map → 全补零（无 NaN）
  const empty = calendarDays('2026-08-16', 7, new Map())
  assert.equal(empty.length, 7)
  assert.ok(empty.every((d) => d.activeMinutes === 0 && d.calls === 0 && d.tokens === 0 && d.xianPct === 0))
})

test('calendarRange：固定窗口（学年 26.8.1–27.7.31，含两端、跨年、补零）', () => {
  const rec = createRecord('2026-08-16', 't1')
  setSlot(rec, 0)
  rec.calls[0] = 2
  rec.tokens[0] = 300
  rec.outputTokens = 300
  const ranch = summarizeRanch('2026-08-16', [rec])
  const map = new Map([['2026-08-16', ranch]])
  const year = calendarRange('2026-08-01', '2027-07-31', map)
  // 学年窗口 = 365 天（2026-08-01 起），升序含两端
  assert.equal(year.length, 365)
  assert.equal(year[0].day, '2026-08-01')
  assert.equal(year[year.length - 1].day, '2027-07-31')
  // 跨年连续性：8 月 → 次年 7 月
  const augIdx = year.findIndex((d) => d.day === '2026-08-31')
  assert.equal(year[augIdx + 1].day, '2026-09-01')
  const decIdx = year.findIndex((d) => d.day === '2026-12-31')
  assert.equal(year[decIdx + 1].day, '2027-01-01')
  // 有记录日填数据，其余补零
  const hit = year.find((d) => d.day === '2026-08-16')
  assert.equal(hit.activeMinutes, 5)
  assert.equal(hit.calls, 2)
  assert.equal(year[0].activeMinutes, 0)
  assert.ok(year.every((d) => d.xianPct === 0 || d.xianPct === 1))
})

test('humanInputs：人输入维度（序列化往返 / 旧数据缺省 0 / ranch 聚合）', () => {
  const rec = createRecord('2026-08-16', 't1')
  setSlot(rec, 0)
  rec.userInputs = 5
  rec.userInputsPerSlot[0] = 5
  rec.humanInputs = 3
  rec.humanInputsPerSlot[0] = 3
  // 序列化往返
  const back = deserializeRecord(serializeRecord(rec))
  assert.equal(back.humanInputs, 3)
  assert.equal(back.humanInputsPerSlot[0], 3)
  assert.equal(back.userInputs, 5)
  // 旧数据（v7 无 humanInputs 字段）→ 缺省 0，userInputs 不受影响
  const legacy = serializeRecord(rec)
  delete legacy.humanInputs
  delete legacy.humanInputsPerSlot
  const old = deserializeRecord(legacy)
  assert.equal(old.humanInputs, 0)
  assert.equal(old.humanInputsPerSlot[0], 0)
  assert.equal(old.userInputs, 5)
  // ranch 聚合：humanInputs 与 userInputs 分开统计
  const ranch = summarizeRanch('2026-08-16', [rec])
  assert.equal(ranch.userInputs, 5)
  assert.equal(ranch.humanInputs, 3)
})
