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
export declare const SLOTS_PER_DAY = 288;
export declare const MINUTES_PER_SLOT = 5;
/** 修仙槽：22:30–24:00（270–287）+ 00:00–06:30（0–77），共 96 槽。 */
export declare const XIAN_SLOT_COUNT = 96;
export declare const XIAN_START_SLOT: number;
/** 每线程每天的记录（持久化形态：slots/calls/stepsPerSlot/tokens/inputTokensPerSlot 转紧凑数组/字符串）。 */
export interface DayThreadRecord {
    day: string;
    threadId: string;
    slots: Uint8Array;
    calls: Uint16Array;
    stepsPerSlot: Uint16Array;
    tokens: Uint32Array;
    inputTokensPerSlot: Uint32Array;
    billedInputTokensPerSlot: Uint32Array;
    userInputsPerSlot: Uint16Array;
    humanInputsPerSlot: Uint16Array;
    llmMs: number;
    toolMs: number;
    turns: number;
    steps: number;
    userInputs: number;
    humanInputs: number;
    inputTokens: number;
    billedInputTokens: number;
    outputTokens: number;
}
export interface SerializedRecord {
    day: string;
    threadId: string;
    slots: string;
    calls: number[];
    stepsPerSlot: number[];
    tokens: number[];
    inputTokensPerSlot: number[];
    billedInputTokensPerSlot: number[];
    userInputsPerSlot: number[];
    humanInputsPerSlot: number[];
    llmMs: number;
    toolMs: number;
    turns: number;
    steps: number;
    userInputs: number;
    humanInputs: number;
    inputTokens: number;
    billedInputTokens: number;
    outputTokens: number;
}
export declare function createRecord(day: string, threadId: string): DayThreadRecord;
/** 本地时间 → 当日槽号（0..287）。 */
export declare function slotOf(date: Date): number;
/** 本地日键 'YYYY-MM-DD'。 */
export declare function dayKeyOf(date: Date): string;
export declare function setSlot(rec: DayThreadRecord, slot: number): void;
export declare function hasSlot(rec: DayThreadRecord, slot: number): boolean;
/** 位图 OR（人维度并集）。 */
export declare function orSlots(target: Uint8Array, source: Uint8Array): void;
export declare function countSlots(slots: Uint8Array): number;
/** 连续活跃段（用于甘特条）：返回 [{ start, end }]（槽号，end 不含）。 */
export declare function segmentsOf(slots: Uint8Array): Array<{
    start: number;
    end: number;
}>;
/** 修仙槽判定：槽在 22:30–24:00 或 00:00–06:30（含 22:30，不含 06:30）。 */
export declare function isXianSlot(slot: number): boolean;
/** 单线程日汇总。 */
export interface ThreadDaySummary {
    threadId: string;
    title: string;
    activeMinutes: number;
    segments: Array<{
        start: number;
        end: number;
    }>;
    calls: number;
    outputTokens: number;
    inputTokens: number;
    uncachedInputTokens: number;
    llmMs: number;
    toolMs: number;
    turns: number;
    steps: number;
    xianActive: number;
    yangActive: number;
    xianPct: number;
}
export declare function summarizeThread(rec: DayThreadRecord, title: string): ThreadDaySummary;
/** 人维度（牧场）日汇总。 */
export interface RanchDaySummary {
    day: string;
    unionSlots: Uint8Array;
    activeMinutes: number;
    peakParallel: number;
    avgParallel: number;
    xianActive: number;
    yangActive: number;
    xianPct: number;
    threadCount: number;
    calls: number;
    inputTokens: number;
    uncachedInputTokens: number;
    outputTokens: number;
    llmMs: number;
    toolMs: number;
    turns: number;
    steps: number;
    userInputs: number;
    humanInputs: number;
    llmRatio: number;
    toolRatio: number;
    heatSlots: Uint32Array;
    heatCalls: Uint32Array;
    heatTokens: Uint32Array;
    heatInput: Uint32Array;
    heatRealm: Float64Array;
}
export declare function summarizeRanch(day: string, records: DayThreadRecord[]): RanchDaySummary;
/** 序列化（storage-json / 文件落盘）。 */
export declare function serializeRecord(rec: DayThreadRecord): SerializedRecord;
export declare function deserializeRecord(s: SerializedRecord): DayThreadRecord;
/** ── 牛马值（积分制 + 修仙境界） ─────────────────────────── */
export interface RealmDims {
    minutes: number;
    calls: number;
    steps: number;
    inputs: number;
    tokens: number;
}
export interface RealmResult {
    value: number;
    realm: string;
    dims: RealmDims;
}
/** 计分系数（可配置：setRealmCoeffs 运行时覆盖；默认 = 2026-08-17 用户定稿：分钟×150、调用×10、步骤×10、输入×150、token 输入/输出统一 ÷1万）。 */
export interface RealmCoeffs {
    minutePerMin: number;
    callPts: number;
    stepPts: number;
    userInputPts: number;
    inputTokenDiv: number;
    outputTokenDiv: number;
    breakthroughPct: number;
    breakthroughFailPct: number;
    tomatoGrowthPerSeg: number;
}
export declare function setRealmCoeffs(c: Partial<RealmCoeffs>): void;
export declare function getRealmCoeffs(): RealmCoeffs;
/** 境界阈值表（下限含；用户定稿原始变比曲线，2026-08-17 token ÷1万 后恢复）：
 *  炼气 <50 / 筑基 50-250 / 金丹 250-1250 / 元婴 1250-6250 / 化神 6250-31250 /
 *  炼虚 31250-100000 / 合体 100000-200000 / 大乘 200000-350000 / 渡劫 350000-500000 /
 *  真仙 500000-700000 / 金仙 700000-1000000 / 宇宙洪荒 1000000+ */
export declare const REALM_THRESHOLDS: number[];
/** 牛马值 → 境界：value ≥ 阈值即升档（50→筑基、250→金丹…1000000→宇宙洪荒）；value=0 → 炼气期。 */
export declare function realmOf(value: number): string;
/** 境界档位（0=炼气 … 11=宇宙洪荒）：成长系数里程碑用（只升不降）。 */
export declare function realmTierOf(value: number): number;
/** 积分制牛马值：每活跃槽得分 = (修仙槽?1.25:1) × (1000 + calls×10 + steps×10 + 输入×100 + (输入+输出)token/100)，Σ 全部槽（无上限）。
 *  分钟分按**并集槽**计（先 OR 全部记录位图，再数活跃槽）——与展示口径"放牧时长（并行不叠加）"一致，
 *  避免"时长 4h35 → 4625"这种用户算不出来的口径差；调用/步骤/输入/token 按各线程真实总量 Σ。
 *  突破奖励不在本函数内（applyBreakthrough 单独叠加，保持基础值可对账）。 */
export declare function computeRealm(records: DayThreadRecord[]): RealmResult;
/** 单次突破奖励：突破到 tier 档境界时，送「下一境界门槛 × breakthroughPct」分；宇宙洪荒（tier 11）无下一境界 → 0。
 *  例：突破到筑基（tier 1）→ 金丹门槛 250 × 20% = 50 分；突破到金仙（tier 10）→ 宇宙洪荒门槛 100万 × 20% = 20万。 */
export declare function breakthroughBonus(tier: number): number;
/** 累计突破奖励：生涯最高境界档 tier 的奖励总和（突破 1..tier 各次之和，只升不降）。 */
export declare function careerBonus(tier: number): number;
/** 应用突破奖励：基础值 + 累计奖励；若加奖励后跨越新境界 → 连锁突破（奖励叠加，直到不再升档）。
 *  maxSteps（2026-08-17 一天一结算）：单次结算最多推进 maxSteps 档（默认 Infinity 保持连锁语义；buildRange 传 1 →
 *  突破拆到逐日结算，生涯档位随时间逐档增长，避免一次结算把生涯直接灌到最高档）。
 *  晋升失败机制（用户定稿）：突破尝试有 breakthroughFailPct 概率失败 → 回退到「本应晋升的最高境界的下一级」0% 进度
 *  （只退一级，规避连升多级掉太多；罚金累计到 failPenalty，成功突破后勾销）。
 *  存量数据豁免：rng 传恒 1（如历史回填中）即永不失败——失败只作用于实时新晋升。
 *  返回最终总分（含奖励扣罚）、生涯最高档、累计奖励、罚金、是否失败。纯函数（rng 可注入，可单测）。 */
export declare function applyBreakthrough(baseValue: number, careerTier: number, failPenalty?: number, rng?: () => number, maxSteps?: number): {
    value: number;
    tier: number;
    bonus: number;
    failPenalty: number;
    failed: boolean;
};
/** 入定段数（用户定稿）：每「连续工作 25 分钟」记 1 段——5 个活跃槽（5 分钟/槽），允许中间断 1 个槽（5 分钟容错），
 *  连续断 2 槽才断档重计；纯函数可从历史 heatRealm 精确重算。成长系数 = 1 + 段数 × tomatoGrowthPerSeg。 */
export declare function tomatoSegs(heatRealm: Float64Array | number[]): number;
/** 入定成长系数：1 + 段数 × tomatoGrowthPerSeg。 */
export declare function tomatoGrowth(segs: number): number;
/** 跨天累计牛马值（境界按周期）：每天 records 分别 computeRealm 得 dims，Σ 各天 dims 得 value
 *  （跨天槽不重叠；分钟并集按天分组算——直接 Σ 各天 dims 即可），再 realmOf。
 *  空天（[]）自动跳过；groups 为空 → value 0 / 炼气期。 */
export declare function realmForDays(groups: DayThreadRecord[][]): RealmResult;
/** 周期**活跃日均**牛马值（用户定稿：境界 = "平均每个干活日的修行强度"，三周期同一把尺子）：
 *  Σ 各活跃日 dims ÷ 活跃天数，再 realmOf；dims/value 均为日均口径。
 *  活跃天数 = 周期内有出勤（slots 非空）的天数，≥1 防除零；空天（[]）自动不计。
 *  realmForDays 保持 Σ 语义（本函数在其结果上归一化）；groups 为空 → value 0 / 炼气期。 */
export declare function realmAvgForDays(groups: DayThreadRecord[][]): RealmResult;
/** 作息彩蛋称号前缀（不进评分）：修仙 ≥50% / 养生 ≥90%。 */
export declare function restTitlePrefix(xianPct: number): string;
/** 周/月跨天聚合：输入每天 RanchDaySummary 列表，输出汇总。 */
export declare function aggregateRange(days: Array<RanchDaySummary & {
    day: string;
}>): {
    activeDays: number;
    totalActiveMinutes: number;
    totalCalls: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalLlmMs: number;
    totalToolMs: number;
    avgXianPct: number;
    trend: Array<{
        day: string;
        activeMinutes: number;
        score: number;
    }>;
};
/** 日历日序列（热力周/月对齐，用户反馈：固定日历日窗口、不平铺）：
 *  从 today 往前 n 个日历日（含今日，升序），每天一项 { day, activeMinutes, calls, tokens, inputTokens, xianPct }；
 *  tokens = 输出 token、inputTokens = 输入 token（热力 token 维度 = 输入+输出）；
 *  有记录用该日 ranch 数据，无记录补零。 */
export declare function calendarDays(today: string, n: number, ranchByDay: Map<string, RanchDaySummary>): Array<{
    day: string;
    activeMinutes: number;
    calls: number;
    tokens: number;
    inputTokens: number;
    xianPct: number;
}>;
/** 固定起止日历日序列（年历用，升序含两端）：同 calendarDays 的口径，但指定 [from, to] 窗口。 */
export declare function calendarRange(from: string, to: string, ranchByDay: Map<string, RanchDaySummary>): Array<{
    day: string;
    activeMinutes: number;
    calls: number;
    tokens: number;
    inputTokens: number;
    xianPct: number;
}>;
