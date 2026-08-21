/**
 * dsh-worktime-board — host 半场（牛马时间看板）。
 *
 * 轻量化设计：
 *  - 实时折叠 O(1) 置位，落盘 60s 一次（退出时强制 flush）；
 *  - 历史回填 = 游标续传：每线程记录 lastEventTime，回填只处理日志中
 *    time > 游标 的事件（幂等、增量、可中断续跑），延迟 5s 启动、逐帧
 *    限速（setImmediate 让出事件循环 + 文件间 50ms 间隔），不卡启动；
 *  - buildRange 结果缓存 2s（与轮询同频，避免重复计算）；
 *  - 数据文件 $DSH_HOME/worktime-board/data.json（≤90 天，~1.6MB 上限）。
 *
 * 计算：线程维度（出勤/甘特/构成）+ 人维度（牧场并集/并行/修仙养生/牛马值积分制+境界）。
 * 子 agent 会话（origin==='subagent'，header.parentSession）沿父链归并到顶层线程统计
 * （v5：parentMap/rootOf + 按源会话游标续传 + mergePass 兜底）。
 * 路由：GET /plugins/dsh-worktime/state?range=day|week|month（client 轮询）。
 * 工具：worktime_summary（当前线程或牧场汇总）。
 */
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
export declare const name = "dsh-worktime-board";
export declare const inject: string[];
export interface Config {
    retentionDays: number;
    flushSeconds: number;
    backfillDelayMs: number;
    backfillFileGapMs: number;
}
export declare const Config: z<Schemastery.ObjectS<{
    retentionDays: z<number, number>;
    flushSeconds: z<number, number>;
    backfillDelayMs: z<number, number>;
    backfillFileGapMs: z<number, number>;
}>, Schemastery.ObjectT<{
    retentionDays: z<number, number>;
    flushSeconds: z<number, number>;
    backfillDelayMs: z<number, number>;
    backfillFileGapMs: z<number, number>;
}>>;
/** sessionQuery 服务最小形状（dsh-session-query-sqlite 提供）。 */
interface SessionQueryLike {
    listSessions(signal?: AbortSignal): Promise<Array<{
        header: {
            id: string;
            cwd?: string;
            parentSession?: string;
            origin?: string;
        };
    }>>;
    readTitleSnapshots?(ids: string[], signal?: AbortSignal): Promise<Array<{
        status: 'fulfilled' | 'rejected';
        value?: {
            title?: unknown;
        };
    }>>;
}
type AppContext = Context & {
    webServer: {
        register(opts: {
            kind: 'prefix';
            path: string;
            handler: (req: any, res: any) => void;
        }): () => void;
    };
    tools: {
        register(tool: {
            name: string;
            description: string;
            parameters?: unknown;
            output?: {
                schema: unknown;
                render(args: unknown, value: any): unknown[];
            };
            execute(args: any, ctx?: any): unknown;
        }): () => void;
    };
    sessionQuery: SessionQueryLike;
    /** @deepseek-ai/dsh-workspace 提供（服务名 workspaceRegistry，非 workspace）。 */
    workspaceRegistry: {
        archivedSessionIds: string[];
    };
};
export declare function apply(ctx: AppContext, config: Config): void;
export {};
