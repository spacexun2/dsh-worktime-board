/**
 * dsh-worktime-board — 纯逻辑核心（零依赖，可 node --test 单测）。
 *
 * 数据模型：每线程每天 288 个 5 分钟槽。
 *   slots:  活动位图（36 字节）
 *   calls:  每槽工具调用计数（Uint16Array 288）
 *   tokens: 每槽输出 token 计数（Uint32Array 288）
 *   + 官方 stats 摘要（llmMs/toolMs/turns/steps）与 usage 累计（input/output tokens）
 *
 * 人维度（牧场）= 当日所有线程 slots 按位 OR：放牧时长=并集（并行不叠加）、
 * 并行度=每槽活跃线程数、修仙/养生=深夜槽(22:30–06:30)活跃占比。
 * 牛马值=积分制（分钟/调用/步骤/token 按槽计分，修仙槽×1.25，无上限），境界按变比阈值映射（用户最终定稿）。
 */
export const SLOTS_PER_DAY = 288; // 24h × 12（5 分钟/槽）
export const MINUTES_PER_SLOT = 5;
/** 修仙槽：22:30–24:00（270–287）+ 00:00–06:30（0–77），共 96 槽。 */
export const XIAN_SLOT_COUNT = 96; // 22:30–06:30 = 8 小时 = 96 槽
export const XIAN_START_SLOT = (22 * 12) + 6; // 270（22:30）
export function createRecord(day, threadId) {
    return {
        day,
        threadId,
        slots: new Uint8Array(SLOTS_PER_DAY / 8),
        calls: new Uint16Array(SLOTS_PER_DAY),
        stepsPerSlot: new Uint16Array(SLOTS_PER_DAY),
        tokens: new Uint32Array(SLOTS_PER_DAY),
        inputTokensPerSlot: new Uint32Array(SLOTS_PER_DAY),
        billedInputTokensPerSlot: new Uint32Array(SLOTS_PER_DAY),
        userInputsPerSlot: new Uint16Array(SLOTS_PER_DAY),
        humanInputsPerSlot: new Uint16Array(SLOTS_PER_DAY),
        llmMs: 0,
        toolMs: 0,
        turns: 0,
        steps: 0,
        userInputs: 0,
        humanInputs: 0,
        inputTokens: 0,
        billedInputTokens: 0,
        outputTokens: 0,
    };
}
/** 本地时间 → 当日槽号（0..287）。 */
export function slotOf(date) {
    const minutes = date.getHours() * 60 + date.getMinutes();
    return Math.min(SLOTS_PER_DAY - 1, Math.floor(minutes / MINUTES_PER_SLOT));
}
/** 本地日键 'YYYY-MM-DD'。 */
export function dayKeyOf(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}
export function setSlot(rec, slot) {
    rec.slots[slot >> 3] |= 1 << (slot & 7);
}
export function hasSlot(rec, slot) {
    return (rec.slots[slot >> 3] & (1 << (slot & 7))) !== 0;
}
/** 位图 OR（人维度并集）。 */
export function orSlots(target, source) {
    for (let i = 0; i < target.length; i++)
        target[i] |= source[i];
}
export function countSlots(slots) {
    let n = 0;
    for (let i = 0; i < slots.length; i++) {
        let b = slots[i];
        while (b !== 0) {
            b &= b - 1;
            n++;
        }
    }
    return n;
}
/** 连续活跃段（用于甘特条）：返回 [{ start, end }]（槽号，end 不含）。 */
export function segmentsOf(slots) {
    const out = [];
    let start = -1;
    for (let slot = 0; slot < SLOTS_PER_DAY; slot++) {
        const on = hasSlotBits(slots, slot);
        if (on && start < 0)
            start = slot;
        if (!on && start >= 0) {
            out.push({ start, end: slot });
            start = -1;
        }
    }
    if (start >= 0)
        out.push({ start, end: SLOTS_PER_DAY });
    return out;
}
function hasSlotBits(slots, slot) {
    return (slots[slot >> 3] & (1 << (slot & 7))) !== 0;
}
/** 修仙槽判定：槽在 22:30–24:00 或 00:00–06:30（含 22:30，不含 06:30）。 */
export function isXianSlot(slot) {
    return slot >= XIAN_START_SLOT || slot < (6 * 12) + 6; // 22:30–06:30（含 22:30，不含 06:30）
}
export function summarizeThread(rec, title) {
    const active = countSlots(rec.slots);
    let xian = 0;
    let calls = 0;
    let tokens = 0;
    for (let slot = 0; slot < SLOTS_PER_DAY; slot++) {
        if (!hasSlotBits(rec.slots, slot))
            continue;
        if (isXianSlot(slot))
            xian++;
        calls += rec.calls[slot];
        tokens += rec.tokens[slot];
    }
    return {
        threadId: rec.threadId,
        title,
        activeMinutes: active * MINUTES_PER_SLOT,
        segments: segmentsOf(rec.slots),
        calls,
        outputTokens: rec.outputTokens,
        inputTokens: rec.billedInputTokens, // 计费输入（主口径）
        uncachedInputTokens: rec.inputTokens, // 未缓存输入（对照）
        llmMs: rec.llmMs,
        toolMs: rec.toolMs,
        turns: rec.turns,
        steps: rec.steps,
        xianActive: xian,
        yangActive: active - xian,
        xianPct: active === 0 ? 0 : xian / active,
    };
}
export function summarizeRanch(day, records) {
    const union = new Uint8Array(SLOTS_PER_DAY / 8);
    const perSlot = new Uint8Array(SLOTS_PER_DAY);
    const heatCalls = new Uint32Array(SLOTS_PER_DAY);
    const heatTokens = new Uint32Array(SLOTS_PER_DAY);
    const heatInput = new Uint32Array(SLOTS_PER_DAY);
    const heatSteps = new Uint32Array(SLOTS_PER_DAY); // 内部：heatRealm 计算用
    const heatInputs = new Uint32Array(SLOTS_PER_DAY); // 内部：每槽用户输入（heatRealm 计算用）
    const heatHuman = new Uint32Array(SLOTS_PER_DAY); // 内部：每槽人输入（展示用）
    const heatSlots = new Uint32Array(SLOTS_PER_DAY);
    const heatRealm = new Float64Array(SLOTS_PER_DAY);
    let llmMs = 0, toolMs = 0, turns = 0, steps = 0;
    let inputTokens = 0, uncachedInputTokens = 0, outputTokens = 0, calls = 0;
    for (const rec of records) {
        orSlots(union, rec.slots);
        for (let slot = 0; slot < SLOTS_PER_DAY; slot++) {
            if (hasSlotBits(rec.slots, slot))
                perSlot[slot]++;
            heatCalls[slot] += rec.calls[slot];
            heatTokens[slot] += rec.tokens[slot];
            heatInput[slot] += rec.billedInputTokensPerSlot[slot]; // 热力输入 = 计费输入（与主口径一致）
            heatSteps[slot] += rec.stepsPerSlot[slot];
            heatInputs[slot] += rec.userInputsPerSlot[slot];
            heatHuman[slot] += rec.humanInputsPerSlot[slot];
        }
        llmMs += rec.llmMs;
        toolMs += rec.toolMs;
        turns += rec.turns;
        steps += rec.steps;
        uncachedInputTokens += rec.inputTokens;
        inputTokens += rec.billedInputTokens;
        outputTokens += rec.outputTokens;
        for (let slot = 0; slot < SLOTS_PER_DAY; slot++)
            calls += rec.calls[slot];
    }
    // 用户输入总数 = Σ 每槽（与 heatRealm 口径强一致；总量字段冗余仅为兼容）
    let userInputs = 0;
    for (let slot = 0; slot < SLOTS_PER_DAY; slot++)
        userInputs += heatInputs[slot];
    let humanInputs = 0;
    for (let slot = 0; slot < SLOTS_PER_DAY; slot++)
        humanInputs += heatHuman[slot];
    const active = countSlots(union);
    let xian = 0;
    let peak = 0;
    let sumParallel = 0;
    let activeSlots = 0;
    for (let slot = 0; slot < SLOTS_PER_DAY; slot++) {
        const n = perSlot[slot];
        if (n > 0) {
            if (isXianSlot(slot))
                xian++;
            if (n > peak)
                peak = n;
            sumParallel += n;
            activeSlots++;
            heatSlots[slot] = n;
            // 每槽修行值（与 computeRealm 每槽口径一致）：分钟 1000 按并集槽（perSlot>0 ⟺ union 置位）、
            // 调用/步骤/输入/token 按各线程该槽真实总量 Σ，修仙槽 ×1.25
            const mult = isXianSlot(slot) ? XIAN_MULT : 1;
            heatRealm[slot] = (slotMinutePts() + heatCalls[slot] * COEFFS.callPts + heatSteps[slot] * COEFFS.stepPts
                + heatInputs[slot] * COEFFS.userInputPts
                + heatInput[slot] / COEFFS.inputTokenDiv + heatTokens[slot] / COEFFS.outputTokenDiv) * mult;
        }
    }
    const llmRatio = llmMs + toolMs === 0 ? 0 : llmMs / (llmMs + toolMs);
    const toolRatio = llmMs + toolMs === 0 ? 0 : toolMs / (llmMs + toolMs);
    return {
        day,
        unionSlots: union,
        activeMinutes: active * MINUTES_PER_SLOT,
        peakParallel: peak,
        avgParallel: activeSlots === 0 ? 0 : sumParallel / activeSlots,
        xianActive: xian,
        yangActive: active - xian,
        xianPct: active === 0 ? 0 : xian / active,
        threadCount: records.length,
        calls,
        inputTokens,
        uncachedInputTokens,
        outputTokens,
        llmMs,
        toolMs,
        turns,
        steps,
        userInputs,
        humanInputs,
        llmRatio,
        toolRatio,
        heatSlots,
        heatCalls,
        heatTokens,
        heatInput,
        heatRealm,
    };
}
/** 序列化（storage-json / 文件落盘）。 */
export function serializeRecord(rec) {
    const bytes = Buffer.from(rec.slots);
    return {
        day: rec.day,
        threadId: rec.threadId,
        slots: bytes.toString('base64'),
        calls: Array.from(rec.calls),
        stepsPerSlot: Array.from(rec.stepsPerSlot),
        tokens: Array.from(rec.tokens),
        inputTokensPerSlot: Array.from(rec.inputTokensPerSlot),
        billedInputTokensPerSlot: Array.from(rec.billedInputTokensPerSlot),
        userInputsPerSlot: Array.from(rec.userInputsPerSlot),
        humanInputsPerSlot: Array.from(rec.humanInputsPerSlot),
        llmMs: rec.llmMs,
        toolMs: rec.toolMs,
        turns: rec.turns,
        steps: rec.steps,
        userInputs: rec.userInputs,
        humanInputs: rec.humanInputs,
        inputTokens: rec.inputTokens,
        billedInputTokens: rec.billedInputTokens,
        outputTokens: rec.outputTokens,
    };
}
export function deserializeRecord(s) {
    const rec = createRecord(s.day, s.threadId);
    const bytes = Buffer.from(s.slots, 'base64');
    rec.slots.set(bytes.subarray(0, SLOTS_PER_DAY / 8));
    rec.calls.set(s.calls.slice(0, SLOTS_PER_DAY));
    rec.stepsPerSlot.set(s.stepsPerSlot.slice(0, SLOTS_PER_DAY));
    rec.tokens.set(s.tokens.slice(0, SLOTS_PER_DAY));
    rec.inputTokensPerSlot.set(s.inputTokensPerSlot.slice(0, SLOTS_PER_DAY));
    rec.billedInputTokensPerSlot.set((s.billedInputTokensPerSlot ?? []).slice(0, SLOTS_PER_DAY)); // 旧数据无此字段 → 全 0
    rec.userInputsPerSlot.set((s.userInputsPerSlot ?? []).slice(0, SLOTS_PER_DAY)); // 旧数据无此字段 → 全 0
    rec.humanInputsPerSlot.set((s.humanInputsPerSlot ?? []).slice(0, SLOTS_PER_DAY));
    rec.llmMs = s.llmMs;
    rec.toolMs = s.toolMs;
    rec.turns = s.turns;
    rec.steps = s.steps;
    rec.userInputs = s.userInputs ?? 0;
    rec.humanInputs = s.humanInputs ?? 0;
    rec.inputTokens = s.inputTokens;
    rec.billedInputTokens = s.billedInputTokens ?? 0; // 旧数据无此字段 → 0（schema bump 会触发全量重建补齐）
    rec.outputTokens = s.outputTokens;
    return rec;
}
/** 修仙槽加成（22:30–06:30，复用 isXianSlot）。 */
const XIAN_MULT = 1.25;
let COEFFS = {
    minutePerMin: 150, // 分钟×150（每槽 750）
    callPts: 10,
    stepPts: 10,
    userInputPts: 150, // 输入次数×150
    inputTokenDiv: 10000, // token 分：输入 token ÷ inputTokenDiv（默认 1 万，2026-08-17 用户定稿）
    outputTokenDiv: 10000, // token 分：输出 token ÷ outputTokenDiv（默认 1 万，2026-08-17 用户定稿）
    breakthroughPct: 0.05, // 送下一境界门槛的 5%
    breakthroughFailPct: 0.01, // 晋升失败率 1%
    tomatoGrowthPerSeg: 0.1, // 每 25 分钟段成长系数 +0.1
};
/** 每槽分钟分 = 每分钟分 × 槽长（5 分钟）。 */
const slotMinutePts = () => COEFFS.minutePerMin * MINUTES_PER_SLOT;
export function setRealmCoeffs(c) {
    COEFFS = { ...COEFFS, ...c };
}
export function getRealmCoeffs() {
    return { ...COEFFS };
}
/** 境界名（12 档）。 */
const REALMS = [
    '炼气期', '筑基期', '金丹期', '元婴期', '化神期',
    '炼虚期', '合体期', '大乘期', '渡劫期', '真仙', '金仙', '宇宙洪荒',
];
/** 境界阈值表（下限含；用户定稿原始变比曲线，2026-08-17 token ÷1万 后恢复）：
 *  炼气 <50 / 筑基 50-250 / 金丹 250-1250 / 元婴 1250-6250 / 化神 6250-31250 /
 *  炼虚 31250-100000 / 合体 100000-200000 / 大乘 200000-350000 / 渡劫 350000-500000 /
 *  真仙 500000-700000 / 金仙 700000-1000000 / 宇宙洪荒 1000000+ */
export const REALM_THRESHOLDS = [50, 250, 1250, 6250, 31250, 100000, 200000, 350000, 500000, 700000, 1000000];
/** 牛马值 → 境界：value ≥ 阈值即升档（50→筑基、250→金丹…1000000→宇宙洪荒）；value=0 → 炼气期。 */
export function realmOf(value) {
    let idx = 0;
    for (let i = 0; i < REALM_THRESHOLDS.length; i++) {
        if (value >= REALM_THRESHOLDS[i])
            idx = i + 1;
        else
            break;
    }
    return REALMS[idx];
}
/** 境界档位（0=炼气 … 11=宇宙洪荒）：成长系数里程碑用（只升不降）。 */
export function realmTierOf(value) {
    let idx = 0;
    for (let i = 0; i < REALM_THRESHOLDS.length; i++) {
        if (value >= REALM_THRESHOLDS[i])
            idx = i + 1;
        else
            break;
    }
    return Math.min(idx, REALMS.length - 1);
}
/** 积分制牛马值：每活跃槽得分 = (修仙槽?1.25:1) × (1000 + calls×10 + steps×10 + 输入×100 + (输入+输出)token/100)，Σ 全部槽（无上限）。
 *  分钟分按**并集槽**计（先 OR 全部记录位图，再数活跃槽）——与展示口径"放牧时长（并行不叠加）"一致，
 *  避免"时长 4h35 → 4625"这种用户算不出来的口径差；调用/步骤/输入/token 按各线程真实总量 Σ。
 *  突破奖励不在本函数内（applyBreakthrough 单独叠加，保持基础值可对账）。 */
export function computeRealm(records) {
    let minutes = 0;
    let calls = 0;
    let steps = 0;
    let inputs = 0;
    let tokens = 0;
    // 并集位图（分钟分口径）：OR 所有记录的 slots
    const union = new Uint8Array(SLOTS_PER_DAY / 8);
    for (const rec of records)
        orSlots(union, rec.slots);
    for (let slot = 0; slot < SLOTS_PER_DAY; slot++) {
        if (hasSlotBits(union, slot)) {
            const mult = isXianSlot(slot) ? XIAN_MULT : 1;
            minutes += slotMinutePts() * mult;
        }
    }
    for (const rec of records) {
        for (let slot = 0; slot < SLOTS_PER_DAY; slot++) {
            if (!hasSlotBits(rec.slots, slot))
                continue;
            const mult = isXianSlot(slot) ? XIAN_MULT : 1;
            calls += rec.calls[slot] * COEFFS.callPts * mult;
            steps += rec.stepsPerSlot[slot] * COEFFS.stepPts * mult;
            inputs += rec.userInputsPerSlot[slot] * COEFFS.userInputPts * mult;
            tokens += (rec.billedInputTokensPerSlot[slot] / COEFFS.inputTokenDiv + rec.tokens[slot] / COEFFS.outputTokenDiv) * mult;
        }
    }
    const value = Math.ceil(minutes + calls + steps + inputs + tokens); // 向上取整（手算样本：7862.5→7863、8836.25→8837）
    return { value, realm: realmOf(value), dims: { minutes, calls, steps, inputs, tokens } };
}
/** 单次突破奖励：突破到 tier 档境界时，送「下一境界门槛 × breakthroughPct」分；宇宙洪荒（tier 11）无下一境界 → 0。
 *  例：突破到筑基（tier 1）→ 金丹门槛 250 × 20% = 50 分；突破到金仙（tier 10）→ 宇宙洪荒门槛 100万 × 20% = 20万。 */
export function breakthroughBonus(tier) {
    if (tier >= 11)
        return 0; // 已至巅峰无下一境界
    return REALM_THRESHOLDS[tier] * COEFFS.breakthroughPct;
}
/** 累计突破奖励：生涯最高境界档 tier 的奖励总和（突破 1..tier 各次之和，只升不降）。 */
export function careerBonus(tier) {
    let sum = 0;
    for (let i = 1; i <= tier; i++)
        sum += breakthroughBonus(i);
    return sum;
}
/** 应用突破奖励：基础值 + 累计奖励；若加奖励后跨越新境界 → 连锁突破（奖励叠加，直到不再升档）。
 *  晋升失败机制（用户定稿）：突破尝试有 breakthroughFailPct 概率失败 → 回退到「本应晋升的最高境界的下一级」0% 进度
 *  （只退一级，规避连升多级掉太多；罚金累计到 failPenalty，成功突破后勾销）。
 *  存量数据豁免：rng 传恒 1（如历史回填中）即永不失败——失败只作用于实时新晋升。
 *  返回最终总分（含奖励扣罚）、生涯最高档、累计奖励、罚金、是否失败。纯函数（rng 可注入，可单测）。 */
export function applyBreakthrough(baseValue, careerTier, failPenalty = 0, rng = Math.random) {
    // 先无失败连锁出「本应晋升的最高境界」targetTier
    let tier = careerTier;
    let bonus = careerBonus(tier);
    let score = baseValue + bonus - failPenalty;
    for (;;) {
        if (tier >= 11)
            break;
        const gate = REALM_THRESHOLDS[tier]; // 下一境界门槛
        if (score < gate)
            break;
        tier++;
        failPenalty = 0; // 无失败假设下罚金全勾销
        bonus = careerBonus(tier);
        score = baseValue + bonus - failPenalty;
    }
    const targetTier = tier;
    const targetBonus = bonus;
    const targetScore = score;
    let failed = false;
    if (targetTier > careerTier && rng() < COEFFS.breakthroughFailPct) {
        // 晋升失败：回退到本应达到最高档的下一级（targetTier - 1）的 0% 进度
        const fallbackTier = Math.max(careerTier, targetTier - 1);
        const curGate = fallbackTier === 0 ? 0 : REALM_THRESHOLDS[fallbackTier - 1];
        const fallbackBonus = careerBonus(fallbackTier);
        const fallbackScore = baseValue + fallbackBonus;
        failPenalty = Math.max(0, fallbackScore - curGate);
        return { value: Math.ceil(curGate), tier: fallbackTier, bonus: fallbackBonus, failPenalty, failed: true };
    }
    return { value: Math.ceil(targetScore), tier: targetTier, bonus: targetBonus, failPenalty: 0, failed };
}
/** 入定段数（用户定稿）：每「连续工作 25 分钟」记 1 段——5 个活跃槽（5 分钟/槽），允许中间断 1 个槽（5 分钟容错），
 *  连续断 2 槽才断档重计；纯函数可从历史 heatRealm 精确重算。成长系数 = 1 + 段数 × tomatoGrowthPerSeg。 */
export function tomatoSegs(heatRealm) {
    let streak = 0; // 段内活跃槽数
    let gaps = 0; // 段内连续断槽数
    let count = 0;
    for (let slot = 0; slot < SLOTS_PER_DAY; slot++) {
        const v = heatRealm[slot] ?? 0;
        if (v > 0) {
            streak++;
            gaps = 0;
            if (streak >= 5) {
                count++;
                streak = 0;
                gaps = 0;
            }
        }
        else if (streak > 0) {
            gaps++;
            if (gaps >= 2) { // 连续断 2 槽 → 断档
                streak = 0;
                gaps = 0;
            }
        }
    }
    return count;
}
/** 入定成长系数：1 + 段数 × tomatoGrowthPerSeg。 */
export function tomatoGrowth(segs) {
    return 1 + segs * COEFFS.tomatoGrowthPerSeg;
}
/** 跨天累计牛马值（境界按周期）：每天 records 分别 computeRealm 得 dims，Σ 各天 dims 得 value
 *  （跨天槽不重叠；分钟并集按天分组算——直接 Σ 各天 dims 即可），再 realmOf。
 *  空天（[]）自动跳过；groups 为空 → value 0 / 炼气期。 */
export function realmForDays(groups) {
    let minutes = 0;
    let calls = 0;
    let steps = 0;
    let inputs = 0;
    let tokens = 0;
    for (const records of groups) {
        const r = computeRealm(records);
        minutes += r.dims.minutes;
        calls += r.dims.calls;
        steps += r.dims.steps;
        inputs += r.dims.inputs;
        tokens += r.dims.tokens;
    }
    const value = Math.ceil(minutes + calls + steps + inputs + tokens);
    return { value, realm: realmOf(value), dims: { minutes, calls, steps, inputs, tokens } };
}
/** 周期**活跃日均**牛马值（用户定稿：境界 = "平均每个干活日的修行强度"，三周期同一把尺子）：
 *  Σ 各活跃日 dims ÷ 活跃天数，再 realmOf；dims/value 均为日均口径。
 *  活跃天数 = 周期内有出勤（slots 非空）的天数，≥1 防除零；空天（[]）自动不计。
 *  realmForDays 保持 Σ 语义（本函数在其结果上归一化）；groups 为空 → value 0 / 炼气期。 */
export function realmAvgForDays(groups) {
    const total = realmForDays(groups);
    let activeDays = 0;
    for (const records of groups) {
        if (records.some((rec) => countSlots(rec.slots) > 0))
            activeDays++;
    }
    const days = Math.max(1, activeDays);
    const dims = {
        minutes: total.dims.minutes / days,
        calls: total.dims.calls / days,
        steps: total.dims.steps / days,
        inputs: total.dims.inputs / days,
        tokens: total.dims.tokens / days,
    };
    const value = Math.ceil(dims.minutes + dims.calls + dims.steps + dims.inputs + dims.tokens);
    return { value, realm: realmOf(value), dims };
}
/** 作息彩蛋称号前缀（不进评分）：修仙 ≥50% / 养生 ≥90%。 */
export function restTitlePrefix(xianPct) {
    if (xianPct >= 0.5)
        return '🔥 修仙';
    if (xianPct <= 0.1)
        return '🌿 养生';
    return '';
}
/** 周/月跨天聚合：输入每天 RanchDaySummary 列表，输出汇总。 */
export function aggregateRange(days) {
    const trend = days
        .filter((d) => d.activeMinutes > 0)
        .map((d) => ({ day: d.day, activeMinutes: d.activeMinutes, score: 0 }));
    const totalActiveMinutes = days.reduce((s, d) => s + d.activeMinutes, 0);
    const totalCalls = days.reduce((s, d) => s + d.calls, 0);
    const totalInputTokens = days.reduce((s, d) => s + d.inputTokens, 0);
    const totalOutputTokens = days.reduce((s, d) => s + d.outputTokens, 0);
    const totalLlmMs = days.reduce((s, d) => s + d.llmMs, 0);
    const totalToolMs = days.reduce((s, d) => s + d.toolMs, 0);
    const activeDays = days.filter((d) => d.activeMinutes > 0).length;
    const withXian = days.filter((d) => d.activeMinutes > 0);
    const avgXianPct = withXian.length === 0 ? 0 : withXian.reduce((s, d) => s + d.xianPct, 0) / withXian.length;
    return {
        activeDays,
        totalActiveMinutes,
        totalCalls,
        totalInputTokens,
        totalOutputTokens,
        totalLlmMs,
        totalToolMs,
        avgXianPct,
        trend,
    };
}
/** 日历日序列（热力周/月对齐，用户反馈：固定日历日窗口、不平铺）：
 *  从 today 往前 n 个日历日（含今日，升序），每天一项 { day, activeMinutes, calls, tokens, inputTokens, xianPct }；
 *  tokens = 输出 token、inputTokens = 输入 token（热力 token 维度 = 输入+输出）；
 *  有记录用该日 ranch 数据，无记录补零。 */
export function calendarDays(today, n, ranchByDay) {
    return calendarRange(addDaysKey(today, -(n - 1)), today, ranchByDay);
}
/** 固定起止日历日序列（年历用，升序含两端）：同 calendarDays 的口径，但指定 [from, to] 窗口。 */
export function calendarRange(from, to, ranchByDay) {
    const out = [];
    let cur = from;
    let guard = 2000;
    while (cur <= to && guard-- > 0) {
        const ranch = ranchByDay.get(cur);
        out.push(ranch === undefined ? { day: cur, activeMinutes: 0, calls: 0, tokens: 0, inputTokens: 0, xianPct: 0 } : {
            day: cur,
            activeMinutes: ranch.activeMinutes,
            calls: ranch.calls,
            tokens: ranch.outputTokens,
            inputTokens: ranch.inputTokens,
            xianPct: ranch.xianPct,
        });
        cur = addDaysKey(cur, 1);
    }
    return out;
}
/** 'YYYY-MM-DD' 加减天数（本地时间，跨月/跨年自动进位）。 */
function addDaysKey(day, delta) {
    const [y, m, d] = day.split('-').map(Number);
    return dayKeyOf(new Date(y, m - 1, d + delta));
}
//# sourceMappingURL=core.js.map