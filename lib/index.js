import { appendFileSync, copyFileSync, mkdirSync, readFileSync, renameSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { zstdDecompressSync } from 'node:zlib';
import z from '@deepseek-ai/schemastery';
import { SLOTS_PER_DAY, createRecord, dayKeyOf, deserializeRecord, orSlots, serializeRecord, slotOf, summarizeRanch, summarizeThread, computeRealm, restTitlePrefix, calendarDays, calendarRange, setRealmCoeffs, getRealmCoeffs, periodSettle, tomatoSegs, tomatoGrowth, realmOf, } from './core.js';
export const name = '@dsh-external/dsh-worktime-board';
export const inject = ['webServer', 'tools', 'sessionQuery', 'workspaceRegistry'];
export const Config = z.object({
    retentionDays: z.number().min(1).max(730).default(400), // 年历需要一年数据（用户定稿 400 天）
    flushSeconds: z.number().min(10).default(60),
    backfillDelayMs: z.number().min(0).default(5000),
    backfillFileGapMs: z.number().min(0).default(50),
});
const dshHome = () => {
    const env = process.env.DSH_HOME;
    return env && env.trim() !== '' ? env : join(homedir(), '.dsh');
};
/** zstd 帧魔数。 */
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
export function apply(ctx, config) {
    const SHORT = 'dsh-worktime-board';
    const dataDir = join(dshHome(), 'worktime-board');
    const dataFile = join(dataDir, 'data.json');
    const logFile = join(dshHome(), 'super-injector', SHORT + '.log');
    /** 计分系数配置文件：$DSH_HOME/worktime-board/config.json
     *  { "minutePerMin": 200, "callPts": 10, "stepPts": 10, "tokenDiv": 100 }
     *  改配置后热重载（dev_reload_package / 重启）即生效，无需改代码。 */
    const coeffFile = join(dataDir, 'config.json');
    const loadCoeffs = () => {
        try {
            const raw = readFileSync(coeffFile, 'utf8')
                .replace(/\/\/.*$/gm, '') // 支持 // 行注释（配置文件可写说明）
                .replace(/\/\*[\s\S]*?\*\//g, ''); // 支持 /* */ 块注释
            const parsed = JSON.parse(raw);
            const num = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined;
            setRealmCoeffs({
                minutePerMin: num(parsed.minutePerMin),
                callPts: num(parsed.callPts),
                stepPts: num(parsed.stepPts),
                userInputPts: num(parsed.userInputPts),
                inputTokenDiv: num(parsed.inputTokenDiv),
                outputTokenDiv: num(parsed.outputTokenDiv),
                breakthroughPct: num(parsed.breakthroughPct),
                breakthroughFailPct: num(parsed.breakthroughFailPct),
                tomatoGrowthPerSeg: num(parsed.tomatoGrowthPerSeg),
            });
        }
        catch { /* 无配置文件或解析失败 → 默认系数 */ }
    };
    loadCoeffs();
    const log = (msg) => {
        try {
            mkdirSync(dirname(logFile), { recursive: true });
            appendFileSync(logFile, `[${new Date().toISOString()}] ${msg}\n`);
        }
        catch { /* 日志失败静默 */ }
    };
    // ── 内存态 ─────────────────────────────────────────────────
    const byDay = new Map();
    const titles = new Map();
    /** 实时折叠游标：源会话 id → 实时已折叠的最大事件 time（展示 lastActiveAt 用，不持久化）。 */
    const liveCursor = new Map();
    /** 回填去重水印：源会话 id → 回填已处理的最大事件 time（持久化；只被 foldLogFile 推进，
     *  不被实时事件推进——修复：schema 重建后实时事件不再把水印推到 now 导致回填全跳过）。 */
    const backfillCursor = new Map();
    /** 数据 schema 版本：bump 后触发一次全量重建（清空 byDay/cursor → 重扫）。v7：新增 userInputs 维度；v8：新增 humanInputs（人输入）维度；
     *  v9：无格式变化——触发全量重建以修复 v8 重建时回填水印被实时事件污染导致的历史数据丢失（liveCursor/backfillCursor 分离）；
     *  v10：新增计费输入维度（billedInputTokens/billedInputTokensPerSlot = uncached + cacheRead + cacheWrite，2026-08-17 与 live-stats 对齐）；
     *  v10 另修复：backfillComplete 后重载间隙漏计（改为增量追平）与重建中止双计（flushPendingLive 推进回填水印）。
     *  v11：单次结算最多突破 1 档（一天一结算）；score.realm 按最终 value 映射；周/月成长系数用日均段数。
     *  v12：突破奖励**按周期独立结算**（periodSettle，无生涯历史状态 careerMaxTier/failPenalty/failedCount——用户定稿：非历史最高逻辑）。 */
    const SCHEMA_VERSION = 12;
    /** 顶层线程判定：只有 session- 前缀的会话才是顶层线程（子 agent 是裸 uuid）。 */
    const isTopLevel = (id) => id.startsWith('session-');
    /** 会话 → 父会话（子 agent 归并用）：仅 origin==='subagent' 且有 parentSession 的会话入表。 */
    const parentMap = new Map();
    /** 子 agent → 顶层父线程：沿 parentSession 链上溯到 session- 会话；孤儿（无父/链断/环）保持自身。 */
    function rootOf(id) {
        let cur = id;
        const seen = new Set([cur]);
        for (;;) {
            const parent = parentMap.get(cur);
            if (parent === undefined || parent === cur || seen.has(parent))
                break;
            seen.add(parent);
            cur = parent;
            if (isTopLevel(cur))
                break;
        }
        return cur;
    }
    /** 线程展示游标：自身 + 所有后代子 agent 的最大事件 time（实时/回填双水印取最大）。 */
    function lastActiveOf(threadId) {
        let max = Math.max(liveCursor.get(threadId) ?? 0, backfillCursor.get(threadId) ?? 0);
        for (const [childId] of parentMap) {
            if (rootOf(childId) !== threadId)
                continue;
            const v = Math.max(liveCursor.get(childId) ?? 0, backfillCursor.get(childId) ?? 0);
            if (v > max)
                max = v;
        }
        return max;
    }
    let backfillComplete = false;
    let backfillDone = 0;
    let backfillTotal = 0;
    let backfillBusy = false;
    /** 上次回填/增量追平完成时间（v10：增量追平只重扫此后改动过的文件，防重载间隙漏计且省扫描）。 */
    let lastBackfillAt = 0;
    /** 重建模式（schema 升级/首次运行）：回填完成前实时事件先入 pendingLive 缓冲，
     *  回填完成后按 backfillCursor 水印过滤放行——防回填与实时重复计数，也防回填跳过未折叠历史。 */
    let rebuildMode = false;
    const pendingLive = [];
    const PENDING_LIVE_MAX = 20000;
    let dirty = false;
    let lastFlushAt = 0;
    /** buildRange 缓存：range → { at, value }。 */
    const rangeCache = new Map();
    function recordFor(day, threadId) {
        let dayMap = byDay.get(day);
        if (dayMap === undefined) {
            dayMap = new Map();
            byDay.set(day, dayMap);
        }
        let rec = dayMap.get(threadId);
        if (rec === undefined) {
            rec = createRecord(day, threadId);
            dayMap.set(threadId, rec);
        }
        return rec;
    }
    function load() {
        try {
            const parsed = JSON.parse(readFileSync(dataFile, 'utf8'));
            if (parsed.meta?.schemaVersion !== SCHEMA_VERSION) {
                // 一次性迁移：旧版数据重建（游标续传无法补已折叠段的 llmMs）
                log(`schema v${parsed.meta?.schemaVersion ?? 0} → v${SCHEMA_VERSION}：全量重建`);
                // 保险（用户定稿）：重建前备份旧数据，任何一次升级都可回滚
                try {
                    const bak = dataFile + '.v' + (parsed.meta?.schemaVersion ?? 0) + '.bak';
                    copyFileSync(dataFile, bak);
                    log('backed up old data → ' + bak);
                }
                catch { /* 备份失败不阻塞重建 */ }
                backfillComplete = false;
                rebuildMode = true; // 回填期间实时事件先缓冲，防重复计数
                return;
            }
            for (const s of parsed.records) {
                let dayMap = byDay.get(s.day);
                if (dayMap === undefined) {
                    dayMap = new Map();
                    byDay.set(s.day, dayMap);
                }
                dayMap.set(s.threadId, deserializeRecord(s));
            }
            backfillComplete = parsed.meta?.backfillComplete === true;
            if (parsed.meta?.cursor) {
                for (const [id, t] of Object.entries(parsed.meta.cursor))
                    backfillCursor.set(id, t);
            }
            log(`loaded ${parsed.records.length} records (backfillComplete=${backfillComplete})`);
        }
        catch {
            // 首次运行无数据文件：同重建模式，回填完成前缓冲实时事件
            backfillComplete = false;
            rebuildMode = true;
        }
    }
    function flush() {
        try {
            const cutoff = Date.now() - config.retentionDays * 86400000;
            const cutoffKey = dayKeyOf(new Date(cutoff));
            for (const [day, dayMap] of [...byDay]) {
                if (day < cutoffKey)
                    byDay.delete(day);
                else if (dayMap.size === 0)
                    byDay.delete(day);
                else {
                    // 防御：清理子 agent（非顶层）残留记录
                    for (const threadId of [...dayMap.keys()]) {
                        if (!isTopLevel(threadId))
                            dayMap.delete(threadId);
                    }
                    if (dayMap.size === 0)
                        byDay.delete(day);
                }
            }
            const records = [];
            for (const dayMap of byDay.values()) {
                for (const rec of dayMap.values())
                    records.push(serializeRecord(rec));
            }
            const payload = JSON.stringify({
                records,
                meta: {
                    backfillComplete,
                    cursor: Object.fromEntries(backfillCursor),
                    schemaVersion: SCHEMA_VERSION,
                },
            });
            mkdirSync(dataDir, { recursive: true });
            const tmp = dataFile + '.tmp';
            writeFileSync(tmp, payload);
            renameSync(tmp, dataFile);
            dirty = false;
        }
        catch (e) {
            log('flush error: ' + String(e));
        }
    }
    function markDirty() {
        dirty = true;
        if (Date.now() - lastFlushAt >= config.flushSeconds * 1000) {
            lastFlushAt = Date.now();
            flush();
        }
    }
    // ── 事件折叠（O(1)，实时） ──────────────────────────────────
    /** 源会话 → 未闭合 step/start 时间（llmMs 配对；按源会话键控，并发子 agent 互不覆盖）。 */
    const pendingStep = new Map();
    /** callId（源会话前缀） → 调用开始时间（toolMs 配对）。 */
    const pendingTool = new Map();
    /** 源会话 → 上一个 step 的 turn（turns 计数）。 */
    const lastTurn = new Map();
    const eventHandler = (session, event) => {
        const t = typeof event.time === 'number' && event.time > 0 ? event.time : Date.now();
        const srcId = session?.id ?? 'unknown';
        if (rebuildMode && pendingLive.length < PENDING_LIVE_MAX) {
            pendingLive.push({ srcId, t, event }); // 重建模式：回填完成前缓冲，防重复计数
            return;
        }
        foldLive(srcId, t, event);
    };
    /** 实时折叠（O(1)）：无条件计数，只推进 liveCursor（不碰 backfillCursor 回填水印）。 */
    const foldLive = (srcId, t, event) => {
        const threadId = rootOf(srcId);
        if (!isTopLevel(threadId))
            return; // 只统计顶层线程；子 agent 事件归并到父线程，孤儿（无父链）忽略
        const prev = liveCursor.get(threadId);
        if (prev === undefined || t > prev)
            liveCursor.set(threadId, t);
        if (srcId !== threadId) {
            // 源会话水印同步推进：展示用（回填去重走 backfillCursor，互不干扰）
            const srcPrev = liveCursor.get(srcId);
            if (srcPrev === undefined || t > srcPrev)
                liveCursor.set(srcId, t);
        }
        const day = dayKeyOf(new Date(t));
        const rec = recordFor(day, threadId);
        const slot = slotOf(new Date(t));
        rec.slots[slot >> 3] |= 1 << (slot & 7);
        switch (event.type) {
            case 'step/start':
                pendingStep.set(srcId, t); // 按源会话配对：并发子 agent 互不覆盖
                break;
            case 'assistant/message': {
                const stepAt = pendingStep.get(srcId);
                if (stepAt !== undefined) {
                    rec.llmMs += Math.max(0, t - stepAt);
                    pendingStep.delete(srcId);
                }
                const usage = event.data?.usage;
                if (usage && typeof usage === 'object') {
                    const out = typeof usage.outputTokens === 'number' && usage.outputTokens > 0 ? usage.outputTokens : 0;
                    const inp = typeof usage.inputTokens === 'number' && usage.inputTokens > 0 ? usage.inputTokens : 0;
                    // 计费输入 = 未缓存输入 + 缓存命中读/写（与 live-stats billed 口径一致）
                    const cacheRead = typeof usage.cacheReadTokens === 'number' && usage.cacheReadTokens > 0 ? usage.cacheReadTokens : 0;
                    const cacheWrite = typeof usage.cacheWriteTokens === 'number' && usage.cacheWriteTokens > 0 ? usage.cacheWriteTokens : 0;
                    const billedIn = inp + cacheRead + cacheWrite;
                    if (out > 0) {
                        const next = rec.tokens[slot] + out;
                        rec.tokens[slot] = next > 0xffffffff ? 0xffffffff : next;
                        rec.outputTokens += out;
                    }
                    if (inp > 0) {
                        rec.inputTokens += inp;
                        const nextIn = rec.inputTokensPerSlot[slot] + inp;
                        rec.inputTokensPerSlot[slot] = nextIn > 0xffffffff ? 0xffffffff : nextIn;
                    }
                    if (billedIn > 0) {
                        rec.billedInputTokens += billedIn;
                        const nextB = rec.billedInputTokensPerSlot[slot] + billedIn;
                        rec.billedInputTokensPerSlot[slot] = nextB > 0xffffffff ? 0xffffffff : nextB;
                    }
                }
                break;
            }
            case 'tool/call':
                if (rec.calls[slot] < 65535)
                    rec.calls[slot] += 1;
                pendingTool.set(srcId + ':' + String(event.data?.callId), t);
                break;
            case 'tool/result': {
                const callAt = pendingTool.get(srcId + ':' + String(event.data?.message?.source?.callId));
                if (callAt !== undefined) {
                    rec.toolMs += Math.max(0, t - callAt);
                    pendingTool.delete(srcId + ':' + String(event.data?.message?.source?.callId));
                }
                break;
            }
            case 'user/message':
                // 用户输入次数（积分制输入次数维）：按源会话计数，每槽记录
                rec.userInputs += 1;
                if (rec.userInputsPerSlot[slot] < 65535)
                    rec.userInputsPerSlot[slot] += 1;
                // 人输入（展示口径，不计分）：source.kind==='user' 才是真人 prompt；
                // 插件注入 / 跨会话投递 / 子 agent 委托（kind 非 user）不计
                if (event.data?.source?.kind === 'user') {
                    rec.humanInputs += 1;
                    if (rec.humanInputsPerSlot[slot] < 65535)
                        rec.humanInputsPerSlot[slot] += 1;
                }
                break;
            case 'step/end': {
                pendingStep.delete(srcId);
                rec.steps += 1;
                if (rec.stepsPerSlot[slot] < 65535)
                    rec.stepsPerSlot[slot] += 1;
                const turn = Number(event.data?.turn);
                if (Number.isFinite(turn) && lastTurn.get(srcId) !== turn) {
                    lastTurn.set(srcId, turn);
                    rec.turns += 1;
                }
                break;
            }
            default: break;
        }
        markDirty();
    };
    ctx.on('session/event', eventHandler);
    ctx.on('session/created', (session) => {
        const h = session?.header;
        if (h && h.origin === 'subagent' && typeof h.parentSession === 'string' && h.parentSession !== '' && h.parentSession !== h.id && typeof h.id === 'string') {
            parentMap.set(h.id, h.parentSession);
        }
    });
    // ── 历史回填（游标续传 + 限速渐进，幂等） ────────────────────
    /** 重建模式收尾：回填完成后放行缓冲的实时事件。已被回填覆盖（t ≤ 回填水印）的跳过，防重复计数；
     *  v10 修复：被放行折叠的事件同时推进回填水印——重建中止后二次回填（cursor 仍为 0）不会把已折叠事件再计一次。 */
    function flushPendingLive() {
        rebuildMode = false;
        if (pendingLive.length === 0)
            return;
        const q = pendingLive.splice(0);
        log(`flush pending live events: ${q.length}`);
        const advanced = new Map();
        for (const p of q) {
            if (p.t <= (backfillCursor.get(p.srcId) ?? 0))
                continue;
            foldLive(p.srcId, p.t, p.event);
            const cur = advanced.get(p.srcId) ?? 0;
            if (p.t > cur)
                advanced.set(p.srcId, p.t);
        }
        for (const [id, t] of advanced) {
            const prev = backfillCursor.get(id) ?? 0;
            if (t > prev)
                backfillCursor.set(id, t);
        }
    }
    async function backfill() {
        // v10：backfillComplete 后不整体跳过——转为增量追平（foldLogFile 按游标幂等，
        // 重载/重启间隙到达但未被折叠的新事件在此补收；只重扫 lastBackfillAt 后改动过的文件）。
        if (backfillBusy)
            return;
        const incremental = backfillComplete;
        backfillBusy = true;
        try {
            const parentOk = await refreshTitles(); // 前置：确保 parentMap 就绪（子 agent 归并依赖）
            if (!parentOk) {
                // parentMap 不可用：中止回填且不置 complete（下次重启/重载可重试），
                // 避免子 agent 历史永久丢失（reviewer 找茬【中】）
                log('backfill aborted: parentMap unavailable (listSessions failed)');
                flushPendingLive(); // 回填未执行：缓冲事件直接放行（v10：已推进回填水印，二次回填不会双计）
                return;
            }
            const roots = [];
            const sessionsRoot = join(dshHome(), 'sessions');
            let workspaces = [];
            try {
                workspaces = readdirSync(sessionsRoot);
            }
            catch {
                return;
            }
            for (const ws of workspaces) {
                const wsDir = join(sessionsRoot, ws);
                let ids = [];
                try {
                    ids = readdirSync(wsDir);
                }
                catch {
                    continue;
                }
                for (const id of ids) {
                    // 收集所有会话日志（含子 agent 目录：fold 时经 rootOf 归并到父线程）
                    const logPath = join(wsDir, id, 'session.jsonl.zstd');
                    try {
                        if (statSync(logPath).size > 0)
                            roots.push(logPath);
                    }
                    catch { /* 无日志文件 */ }
                }
            }
            // 小文件优先（快速完成小线程），再按 mtime 新→旧
            const files = roots
                .map((p) => ({ p, size: statSync(p).size, mtime: statSync(p).mtimeMs }))
                .sort((a, b) => a.size - b.size || b.mtime - a.mtime);
            backfillTotal = files.length;
            backfillDone = 0;
            const minTime = Date.now() - config.retentionDays * 86400000;
            for (const file of files) {
                if (file.mtime < minTime) {
                    backfillDone++;
                    continue;
                } // 超保留期，跳过
                if (incremental && file.mtime < lastBackfillAt) {
                    backfillDone++;
                    continue;
                } // 增量：只扫新改动文件
                try {
                    await foldLogFile(file.p, minTime);
                }
                catch (e) {
                    log(`backfill file error ${file.p}: ${String(e).slice(0, 120)}`);
                }
                backfillDone++;
                if (config.backfillFileGapMs > 0)
                    await sleep(config.backfillFileGapMs);
            }
            backfillComplete = true;
            lastBackfillAt = Date.now();
            flush();
            log(`backfill ${incremental ? 'catch-up' : 'complete'}: ${files.length} files`);
            flushPendingLive(); // 回填完成：放行缓冲的实时事件（按回填水印过滤防重复）
        }
        finally {
            backfillBusy = false;
        }
    }
    /** 解码一个 .jsonl.zstd（逐帧、限速），只折叠 time > 回填水印 的事件（幂等）。
     *  子 agent 文件按 rootOf 归并到父线程，水印按源会话续传（父/子文件互不覆盖，
     *  并发子 agent 时间窗不互相吞并）。 */
    async function foldLogFile(path, minTime) {
        const sourceId = threadIdOf(path);
        const threadId = rootOf(sourceId);
        if (!isTopLevel(threadId))
            return; // 防御：孤儿子 agent（无法归并到顶层线程）不折叠
        const cursorAt = backfillCursor.get(sourceId) ?? 0;
        const buf = readFileSync(path);
        let offset = 0;
        let first = true;
        let stepAt = 0;
        const tools = new Map();
        while (offset < buf.length) {
            const idx = buf.indexOf(ZSTD_MAGIC, offset);
            if (idx < 0)
                break;
            const next = buf.indexOf(ZSTD_MAGIC, idx + 4);
            const end = next < 0 ? buf.length : next;
            let text;
            try {
                text = zstdDecompressSync(buf.subarray(idx, end)).toString('utf8');
            }
            catch {
                offset = end;
                continue;
            }
            for (const line of text.split('\n')) {
                if (line.trim() === '')
                    continue;
                let ev = null;
                try {
                    ev = JSON.parse(line);
                }
                catch {
                    continue;
                }
                if (ev === null)
                    continue;
                const t = typeof ev?.time === 'number' ? ev.time : 0;
                if (t <= 0 || t <= cursorAt || t < minTime)
                    continue;
                const day = dayKeyOf(new Date(t));
                const rec = recordFor(day, threadId);
                const slot = slotOf(new Date(t));
                rec.slots[slot >> 3] |= 1 << (slot & 7);
                switch (ev.type) {
                    case 'step/start':
                        stepAt = t;
                        break;
                    case 'assistant/message': {
                        if (stepAt > 0) {
                            rec.llmMs += Math.max(0, t - stepAt);
                            stepAt = 0;
                        }
                        const usage = ev.data?.usage;
                        if (usage && typeof usage === 'object') {
                            const out = typeof usage.outputTokens === 'number' && usage.outputTokens > 0 ? usage.outputTokens : 0;
                            const inp = typeof usage.inputTokens === 'number' && usage.inputTokens > 0 ? usage.inputTokens : 0;
                            const cacheRead = typeof usage.cacheReadTokens === 'number' && usage.cacheReadTokens > 0 ? usage.cacheReadTokens : 0;
                            const cacheWrite = typeof usage.cacheWriteTokens === 'number' && usage.cacheWriteTokens > 0 ? usage.cacheWriteTokens : 0;
                            const billedIn = inp + cacheRead + cacheWrite;
                            if (out > 0) {
                                rec.tokens[slot] = Math.min(0xffffffff, rec.tokens[slot] + out);
                                rec.outputTokens += out;
                            }
                            if (inp > 0) {
                                rec.inputTokens += inp;
                                rec.inputTokensPerSlot[slot] = Math.min(0xffffffff, rec.inputTokensPerSlot[slot] + inp);
                            }
                            if (billedIn > 0) {
                                rec.billedInputTokens += billedIn;
                                rec.billedInputTokensPerSlot[slot] = Math.min(0xffffffff, rec.billedInputTokensPerSlot[slot] + billedIn);
                            }
                        }
                        break;
                    }
                    case 'tool/call':
                        if (rec.calls[slot] < 65535)
                            rec.calls[slot] += 1;
                        tools.set(String(ev.data?.callId), t);
                        break;
                    case 'tool/result': {
                        const callAt = tools.get(String(ev.data?.message?.source?.callId));
                        if (callAt !== undefined) {
                            rec.toolMs += Math.max(0, t - callAt);
                            tools.delete(String(ev.data?.message?.source?.callId));
                        }
                        break;
                    }
                    case 'user/message':
                        rec.userInputs += 1;
                        if (rec.userInputsPerSlot[slot] < 65535)
                            rec.userInputsPerSlot[slot] += 1;
                        if (ev.data?.source?.kind === 'user') {
                            rec.humanInputs += 1;
                            if (rec.humanInputsPerSlot[slot] < 65535)
                                rec.humanInputsPerSlot[slot] += 1;
                        }
                        break;
                    case 'step/end': {
                        stepAt = 0;
                        rec.steps += 1;
                        if (rec.stepsPerSlot[slot] < 65535)
                            rec.stepsPerSlot[slot] += 1;
                        const turn = Number(ev.data?.turn);
                        if (Number.isFinite(turn) && lastTurn.get(sourceId) !== turn) {
                            lastTurn.set(sourceId, turn);
                            rec.turns += 1;
                        }
                        break;
                    }
                    default: break;
                }
            }
            backfillCursor.set(sourceId, Math.max(backfillCursor.get(sourceId) ?? 0, lastTimeIn(text, cursorAt)));
            offset = end;
            if (first || (offset & 0x3ffff) === 0)
                await sleep(0); // 每 ~256KB 让出事件循环
            first = false;
        }
        markDirty();
    }
    /** 从解码文本提取最大事件 time（比逐行解析轻：正则扫 time 字段）。 */
    function lastTimeIn(text, floor) {
        let max = floor;
        const re = /"time":(\d{10,})/g;
        let m;
        while ((m = re.exec(text)) !== null) {
            const v = Number(m[1]);
            if (v > max)
                max = v;
        }
        return max;
    }
    function threadIdOf(logPath) {
        const parts = logPath.split(/[\\/]/);
        // …/sessions/<ws>/<id>/session.jsonl.zstd → id
        return parts.length >= 2 ? parts[parts.length - 2] : logPath;
    }
    function sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
    // ── 线程标题缓存 + 子 agent 父链 ────────────────────────────
    /** 成功 true；listSessions 抛错返回 false（调用方据此决定是否中止回填）。 */
    async function refreshTitles() {
        try {
            const records = await ctx.sessionQuery.listSessions();
            // 重建 parentMap：子 agent 会话 → 父会话（rootOf 链路上溯用）
            parentMap.clear();
            for (const r of records) {
                const h = r.header;
                if (h.origin === 'subagent' && typeof h.parentSession === 'string' && h.parentSession !== '' && h.parentSession !== h.id) {
                    parentMap.set(h.id, h.parentSession);
                }
            }
            mergePass(); // parentMap 就绪后归并残留子记录（幂等）
            const ids = records.map((r) => r.header.id);
            for (const id of ids)
                if (!titles.has(id))
                    titles.set(id, id);
            if (typeof ctx.sessionQuery.readTitleSnapshots === 'function') {
                try {
                    const snapshots = await ctx.sessionQuery.readTitleSnapshots(ids);
                    snapshots.forEach((s, i) => {
                        if (s.status !== 'fulfilled')
                            return;
                        const t = s.value?.title;
                        const label = typeof t === 'string' ? t : (t !== null && typeof t === 'object' && 'title' in t ? String(t.title) : '');
                        if (label !== '')
                            titles.set(ids[i], label);
                    });
                }
                catch { /* 标题快照失败不阻塞（parentMap 已就绪，不影响回填判定） */ }
            }
            return true;
        }
        catch {
            // 仅 listSessions 失败返回 false：parentMap 未就绪，backfill 据此中止且不置 complete
            return false;
        }
    }
    /** 归并 byDay 中残留的子 agent 记录到父线程（防御：正常路径经 rootOf 不产生子记录）。
     *  slots 按位 OR，calls/tokens/llmMs/toolMs/turns/steps/inputTokens/outputTokens 求和，
     *  删除原子记录；子 agent cursor 经 lastActiveOf 展示并入（不写根游标，避免污染根文件去重水印）。 */
    function mergePass() {
        for (const [day, dayMap] of byDay) {
            for (const [id, rec] of [...dayMap]) {
                if (!parentMap.has(id))
                    continue;
                const root = rootOf(id);
                if (!isTopLevel(root))
                    continue; // 孤儿链不归并（flush 防御清理兜底）
                const target = recordFor(day, root);
                orSlots(target.slots, rec.slots);
                for (let slot = 0; slot < SLOTS_PER_DAY; slot++) {
                    target.calls[slot] = Math.min(65535, target.calls[slot] + rec.calls[slot]);
                    target.stepsPerSlot[slot] = Math.min(65535, target.stepsPerSlot[slot] + rec.stepsPerSlot[slot]);
                    target.tokens[slot] = Math.min(0xffffffff, target.tokens[slot] + rec.tokens[slot]);
                    target.inputTokensPerSlot[slot] = Math.min(0xffffffff, target.inputTokensPerSlot[slot] + rec.inputTokensPerSlot[slot]);
                    target.billedInputTokensPerSlot[slot] = Math.min(0xffffffff, target.billedInputTokensPerSlot[slot] + rec.billedInputTokensPerSlot[slot]);
                    target.userInputsPerSlot[slot] = Math.min(65535, target.userInputsPerSlot[slot] + rec.userInputsPerSlot[slot]);
                    target.humanInputsPerSlot[slot] = Math.min(65535, target.humanInputsPerSlot[slot] + rec.humanInputsPerSlot[slot]);
                }
                target.llmMs += rec.llmMs;
                target.toolMs += rec.toolMs;
                target.turns += rec.turns;
                target.steps += rec.steps;
                target.userInputs += rec.userInputs;
                target.humanInputs += rec.humanInputs;
                target.inputTokens += rec.inputTokens;
                target.billedInputTokens += rec.billedInputTokens;
                target.outputTokens += rec.outputTokens;
                dayMap.delete(id);
            }
        }
    }
    // ── 聚合计算（2s 缓存） ─────────────────────────────────────
    function recordsOfDay(day) {
        return [...(byDay.get(day) ?? new Map()).values()];
    }
    function daySummaries() {
        const out = [];
        const today = dayKeyOf(new Date());
        for (const [day, dayMap] of byDay) {
            if (day > today)
                continue;
            const records = [...dayMap.values()];
            if (records.length === 0)
                continue;
            out.push({ day, ranch: summarizeRanch(day, records) });
        }
        return out.sort((a, b) => a.day.localeCompare(b.day));
    }
    function buildRange(range, date) {
        const cacheKey = range + '|' + (date ?? '');
        const cached = rangeCache.get(cacheKey);
        if (cached !== undefined && Date.now() - cached.at < 2000)
            return cached.value;
        const all = daySummaries();
        // day 口径：默认严格今天（无 date 参数时不回退"最新有数据日"——凌晨今天无活动时
        // 不应把昨天数据显示成"今日"）；date 参数指定历史日（有记录用记录，无记录补空）
        let days;
        if (range === 'day') {
            const target = (date !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(date)) ? date : dayKeyOf(new Date());
            const found = all.find((d) => d.day === target);
            days = found !== undefined ? [found] : [{ day: target, ranch: summarizeRanch(target, []) }];
        }
        else {
            days = range === 'week' ? all.slice(-7) : all.slice(-30);
        }
        const activeDaysList = days.filter((d) => d.ranch.activeMinutes > 0);
        const activeDays = activeDaysList.length;
        const day = days[days.length - 1]?.day ?? dayKeyOf(new Date());
        const records = recordsOfDay(day);
        // 线程明细（v17：周/月仅切换热力图，统计始终为当日/所选日期明细——不再跨天聚合）
        const archivedSet = new Set(ctx.workspaceRegistry.archivedSessionIds ?? []);
        const threads = records.map((rec) => {
            const s = summarizeThread(rec, titles.get(rec.threadId) ?? shortId(rec.threadId));
            return {
                ...s,
                lastActiveAt: lastActiveOf(rec.threadId),
                archived: archivedSet.has(rec.threadId),
                activeDays: 1,
            };
        }).sort((a, b) => b.activeMinutes - a.activeMinutes);
        // 补归档空行：归档但本 range 无出勤的线程也列出（activeMinutes=0，client 显示"未出勤"），
        // 让"含归档"切换始终可见（用户反馈：day 视图识别不到归档内容）。
        for (const id of archivedSet) {
            if (!isTopLevel(id))
                continue;
            if (threads.some((t) => t.threadId === id))
                continue;
            threads.push({
                threadId: id,
                title: titles.get(id) ?? shortId(id),
                activeMinutes: 0,
                segments: [],
                calls: 0,
                outputTokens: 0,
                inputTokens: 0,
                uncachedInputTokens: 0,
                llmMs: 0,
                toolMs: 0,
                turns: 0,
                steps: 0,
                xianActive: 0,
                yangActive: 0,
                xianPct: 0,
                lastActiveAt: 0,
                archived: true,
                activeDays: 0,
            });
        }
        // 概览（用户反馈：周/月小卡片也要周期总值而非当日/平均）：
        // day = 当日口径；week/month = 周期聚合总值（Σ 各活跃日），日均 = 总值 ÷ 活跃天数
        const todayRanch = days.length > 0 ? days[days.length - 1].ranch : summarizeRanch(day, records);
        let overview;
        if (range === 'day') {
            overview = {
                activeMinutes: todayRanch.activeMinutes,
                peakParallel: todayRanch.peakParallel,
                calls: todayRanch.calls,
                inputTokens: todayRanch.inputTokens,
                outputTokens: todayRanch.outputTokens,
                llmMs: todayRanch.llmMs,
                toolMs: todayRanch.toolMs,
                llmRatio: todayRanch.llmRatio,
                toolRatio: todayRanch.toolRatio,
                xianPct: todayRanch.xianPct,
                activeDays: 1,
                turns: todayRanch.turns,
                steps: todayRanch.steps,
                userInputs: todayRanch.userInputs,
                humanInputs: todayRanch.humanInputs,
                avgActiveMinutes: todayRanch.activeMinutes,
            };
        }
        else {
            let activeDays = 0, activeMinutes = 0, peakParallel = 0, calls = 0, inputTokens = 0;
            let outputTokens = 0, llmMs = 0, toolMs = 0, turns = 0, steps = 0, userInputs = 0, humanInputs = 0;
            let xianActive = 0;
            for (const d of days) {
                const r = d.ranch;
                if (r.activeMinutes <= 0)
                    continue;
                activeDays++;
                activeMinutes += r.activeMinutes;
                if (r.peakParallel > peakParallel)
                    peakParallel = r.peakParallel;
                calls += r.calls;
                inputTokens += r.inputTokens;
                outputTokens += r.outputTokens;
                llmMs += r.llmMs;
                toolMs += r.toolMs;
                turns += r.turns;
                steps += r.steps;
                userInputs += r.userInputs;
                humanInputs += r.humanInputs;
                xianActive += r.xianActive;
            }
            const denom = llmMs + toolMs;
            const xianSlots = activeMinutes / 5; // MINUTES_PER_SLOT=5
            overview = {
                activeMinutes,
                peakParallel,
                calls,
                inputTokens,
                outputTokens,
                llmMs,
                toolMs,
                llmRatio: denom === 0 ? 0 : llmMs / denom,
                toolRatio: denom === 0 ? 0 : toolMs / denom,
                xianPct: xianSlots === 0 ? 0 : Math.min(1, xianActive / xianSlots),
                activeDays,
                turns,
                steps,
                userInputs,
                humanInputs,
                avgActiveMinutes: activeDays === 0 ? 0 : Math.round(activeMinutes / activeDays),
            };
        }
        // 牛马值（v17：日视图 = 当日完整评分；周/月视图 = 周期总修仙值 + 周期内最高境界——不做日均/归一化）
        // 突破奖励按当日独立结算（v12）：突破次数 = 当日最终境界档位，奖励 = 该档位累计门槛奖励；无生涯状态、不冻结
        // 入定成长：每连续 25 分钟（1 段）成长系数 +0.1，最终修仙值额外乘 (1 + 段数 × 0.1)
        const baseDay = computeRealm(records);
        const segsDay = tomatoSegs(todayRanch.heatRealm);
        const growthDay = tomatoGrowth(segsDay);
        const settleDay = periodSettle(baseDay.value, growthDay);
        const scoreDay = { ...baseDay, value: (baseDay.value + settleDay.bonus) * growthDay };
        const dayScore = {
            ...scoreDay,
            realm: realmOf(scoreDay.value), // 境界按最终 value（含突破奖励/入定成长）映射，与总分显示一致
            coeffs: getRealmCoeffs(), // 计分系数下发（client 公式文案动态显示）
            bonus: settleDay.bonus, // 当日突破奖励（基础值之上叠加；client 展示"突破奖励"行）
            rangeTier: settleDay.tier, // 当日突破档数（client 展示"突破 N 次"）
            growth: growthDay, // 入定成长系数（当日口径）
            segs: segsDay, // 入定段数（当日口径）
        };
        let score = dayScore;
        if (range !== 'day') {
            // 周/月视图（用户定稿）：周期总修仙值 = Σ 各活跃日最终值；最高境界 = 周期内各日最终值的最大档位
            let total = 0;
            let maxFinal = 0;
            let activeDays = 0;
            for (const d of days) {
                if (d.ranch.activeMinutes <= 0)
                    continue;
                activeDays++;
                const base = computeRealm(recordsOfDay(d.day));
                const g = tomatoGrowth(tomatoSegs(d.ranch.heatRealm));
                const st = periodSettle(base.value, g);
                const fin = (base.value + st.bonus) * g;
                total += fin;
                if (fin > maxFinal)
                    maxFinal = fin;
            }
            score = {
                value: Math.round(total),
                realm: realmOf(maxFinal),
                activeDays,
            };
        }
        // 修仙前缀取 range 的修仙占比
        const xianPct = overview.xianPct;
        // 热力（随 range 联动）：日 = 24h 槽；周/月 = 日历日序列（week=近 7 日历日、month=近 30 日历日，
        // 含今日，无出勤日补零——用户反馈：固定日历日窗口，不从最早记录日平铺）
        // 月视图额外附年历（用户定稿）：近 365 个日历日每日基础修行值（GitHub 贡献风格色块）
        const finalRealmOf = (day, ranch) => {
            // 某日最终值（与分数卡境界同口径：基础分 + 当日突破奖励，再乘入定成长）
            // ——年历/热力修仙值维度显示，避免“年历金仙 / 当日宇宙洪荒”这类不一致
            const base = computeRealm(recordsOfDay(day));
            const g = tomatoGrowth(tomatoSegs(ranch?.heatRealm ?? []));
            const st = periodSettle(base.value, g);
            return (base.value + st.bonus) * g;
        };
        const ranchBy = new Map(days.map((d) => [d.day, d.ranch]));
        const heat = range === 'day' ? {
            kind: 'day',
            heatSlots: Array.from(todayRanch.heatSlots),
            heatCalls: Array.from(todayRanch.heatCalls),
            heatTokens: Array.from(todayRanch.heatTokens),
            heatInput: Array.from(todayRanch.heatInput),
            heatRealm: Array.from(todayRanch.heatRealm),
        } : {
            kind: 'days',
            days: calendarDays(dayKeyOf(new Date()), range === 'week' ? 7 : 30, ranchBy)
                .map((d) => ({ ...d, realm: finalRealmOf(d.day, ranchBy.get(d.day)) })), // 该日最终修仙值（无记录日 = 0）
            ...(range === 'month' ? {
                // 年历（用户定稿：26.8.1–27.7.31 这类学年窗口，含今日的 8月1日~次年7月31日，不再滚动 365 天）
                // 用户反馈：年历境界应与当日分数卡一致 → 用最终值（含突破奖励/入定成长）而非基础值
                year: (() => {
                    const w = schoolYearWindow(new Date());
                    const yearBy = new Map(all.filter((d) => d.day >= w.start && d.day <= w.end).map((d) => [d.day, d.ranch]));
                    return calendarRange(w.start, w.end, yearBy)
                        .map((d) => ({ ...d, realm: finalRealmOf(d.day, yearBy.get(d.day)) })); // 该日最终修仙值（无记录日 = 0）
                })(),
            } : {}),
        };
        const value = {
            day,
            range,
            overview,
            threads,
            score,
            restPrefix: restTitlePrefix(xianPct),
            heat,
            backfill: { complete: backfillComplete, done: backfillDone, total: backfillTotal },
        };
        rangeCache.set(cacheKey, { at: Date.now(), value });
        return value;
    }
    // ── 路由 ────────────────────────────────────────────────────
    const disposeRoute = ctx.webServer.register({
        kind: 'prefix',
        path: '/plugins/dsh-worktime',
        handler: (req, res) => {
            const json = (status, body) => {
                res.statusCode = status;
                res.setHeader('content-type', 'application/json');
                res.end(JSON.stringify(body));
            };
            try {
                const url = String(req?.url ?? '/');
                const path = url.split('?')[0] ?? '/';
                if (path !== '/plugins/dsh-worktime/state' && path !== '/plugins/dsh-worktime/state/') {
                    json(404, { ok: false, error: 'not found' });
                    return;
                }
                const q = new URLSearchParams(url.split('?')[1] ?? '');
                const range = (q.get('range') === 'week' || q.get('range') === 'month') ? q.get('range') : 'day';
                const date = q.get('date') ?? undefined; // 仅 day 口径生效：查看指定历史日（无记录日返回空数据）
                json(200, { ok: true, ...buildRange(range, date) });
            }
            catch (e) {
                json(500, { ok: false, error: String(e) });
            }
        },
    });
    // ── 工具 worktime_summary ───────────────────────────────────
    const disposeTool = ctx.tools.register({
        name: 'worktime_summary',
        description: '牛马时间看板：返回当前线程（或牧场=全部线程）的出勤统计、时间构成与牛马值/境界。range: day|week|month。',
        parameters: {
            type: 'object',
            properties: {
                range: { type: 'string', enum: ['day', 'week', 'month'], description: '统计范围，默认 day' },
                ranch: { type: 'boolean', description: 'true = 牧场（全部线程）汇总；默认当前线程' },
            },
        },
        output: {
            schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
            render: (_args, value) => [{ type: 'text', text: value.text }],
        },
        execute: async (args) => {
            try {
                const range = args?.range === 'week' || args?.range === 'month' ? args.range : 'day';
                const built = buildRange(range);
                const o = built.overview;
                const target = args?.ranch === true ? o : built.threads[0] ?? null;
                if (target === null || o.activeMinutes === 0 && args?.ranch === true)
                    return { text: `${range} 无出勤记录` };
                const title = args?.ranch === true ? '牧场' : `线程 ${target.title ?? target.threadId}`;
                const xianPct = args?.ranch === true ? o.xianPct : target.xianPct ?? 0;
                const activeMin = args?.ranch === true ? o.activeMinutes : target.activeMinutes;
                const lines = [
                    `【${title} · ${range}】`,
                    `出勤 ${Math.round((activeMin / 60) * 10) / 10} 小时${args?.ranch === true && range !== 'day' ? `（活跃 ${o.activeDays} 天）` : ''}`,
                ];
                if (args?.ranch === true) {
                    lines.push(`并行峰值 ${o.peakParallel} · 修仙时段 ${Math.round(xianPct * 100)}%`);
                    lines.push(`调用 ${o.calls} · 输出 ${fmtWan(o.outputTokens)} · 输入 ${fmtWan(o.inputTokens)}`);
                    lines.push(`思考(LLM) ${Math.round(o.llmRatio * 100)}% / 工具 ${Math.round(o.toolRatio * 100)}%`);
                }
                if (built.backfill?.complete === false) {
                    lines.push(`（历史数据整理中 ${built.backfill.done}/${built.backfill.total}…）`);
                }
                return { text: lines.join('\n') };
            }
            catch (e) {
                return { text: 'worktime_summary 失败: ' + String(e) };
            }
        },
    });
    // ── 生命周期 ────────────────────────────────────────────────
    load();
    void refreshTitles();
    setTimeout(() => { void backfill(); }, config.backfillDelayMs);
    // v10：增量追平定时器——重载/重启间隙未折叠的新事件每 5 分钟补收一次（backfill 增量模式只扫新文件）
    const CATCHUP_INTERVAL_MS = 5 * 60 * 1000;
    const catchupTimer = setInterval(() => { void backfill(); }, CATCHUP_INTERVAL_MS);
    const flushTimer = setInterval(() => { flush(); }, Math.max(30000, config.flushSeconds * 1000));
    const titleTimer = setInterval(() => { void refreshTitles(); }, 300000);
    ctx.effect(() => () => {
        clearInterval(flushTimer);
        clearInterval(titleTimer);
        clearInterval(catchupTimer);
        disposeRoute();
        disposeTool();
        flush();
        ctx.logger?.info?.('[' + name + '] 已卸载，数据已落盘');
    });
    ctx.logger?.info?.('[' + name + '] 牛马时间看板启动（retention=' + config.retentionDays + 'd, backfill delay=' + config.backfillDelayMs + 'ms）');
}
function shortId(id) {
    return id.length > 16 ? id.slice(0, 8) + '…' + id.slice(-4) : id;
}
function fmtWan(n) {
    if (n >= 10000)
        return (n / 10000).toFixed(1) + ' 万';
    return String(n);
}
/** 学年窗口（年历用，用户定稿：26.8.1–27.7.31 这类 8月1日~次年7月31日）：返回含 now 的学年起止。 */
function schoolYearWindow(now) {
    const y = now.getFullYear();
    const startY = now.getMonth() + 1 >= 8 ? y : y - 1; // 8 月起进入新学年
    return { start: `${startY}-08-01`, end: `${startY + 1}-07-31` };
}
//# sourceMappingURL=index.js.map