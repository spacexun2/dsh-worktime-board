window.__ModuleLoader__.load({
	id: "@dsh-external/dsh-worktime-board",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		//#region src/client/index.ts
		/**
		* @dsh-external/dsh-worktime-board — client（牛马修仙看板浮动面板）。
		*
		* 形态：body portal（参考 agent-teams ActivityPanel）。右下角小方块 → 点开展开
		* 面板 → 头部拖动（localStorage 记忆）→ 日/周/月 Tab（概览/热力联动）。
		* 信息架构：概览随 range 变化；热力日=24h 柱状、周=每天柱状、月=按自然周聚合（hover tooltip）；
		* 线程区可排序（时长↓/时间↓）、默认 TOP5、可展开全部、含归档按钮常开；
		* 评分 = 积分制无上限（修仙值 + 修仙境界）；作息/时间构成用大白话纯文字行（修仙时段 / 思考 vs 工具），无彩条。
		* 实现：vanilla DOM + 注入 <style>，零运行时依赖。
		*/
		const inject = ["slots", "sessions"];
		const STATE_URL = "/plugins/dsh-worktime/state";
		const POLL_MS_OPEN = 5e3;
		const POLL_MS_CLOSED = 3e4;
		const CSS_ID = "dsh-worktime-board/client.css";
		const POS_KEY = "dsh-worktime-board.pos";
		/** 会话标题来自持久化会话数据；插入 innerHTML 前必须同时转义文本与属性上下文。 */
		function escapeHtml(value) {
			return String(value).replace(/[&<>"']/g, (char) => ({
				"&": "&amp;",
				"<": "&lt;",
				">": "&gt;",
				"\"": "&quot;",
				"'": "&#39;"
			})[char]);
		}
		function injectCss() {
			if (document.querySelector(`style[data-plugin-css="${CSS_ID}"]`) !== null) return;
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-worktime-board";
			tag.dataset.pluginCss = CSS_ID;
			tag.textContent = `
.wtb-root{position:fixed;z-index:2147483000;font-family:var(--dsw-font-family,ui-sans-serif,system-ui);color:var(--dsw-alias-label-primary,#e6e6e6)}
.wtb-badge{position:fixed;right:16px;bottom:16px;z-index:2147483000;display:flex;align-items:center;gap:9px;height:46px;padding:0 8px 0 6px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));border-radius:14px;cursor:pointer;color:var(--dsw-alias-label-primary,#f0e6d2);background:var(--dsw-alias-bg-overlay,rgba(24,24,30,.92));backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);box-shadow:0 6px 20px rgba(0,0,0,.35)}
.wtb-badgeIcon{width:32px;height:32px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:16px;line-height:1;flex:none;background:var(--dsw-alias-bg-elevated,rgba(255,255,255,.07));box-shadow:inset 0 1px 0 rgba(255,255,255,.08);position:relative;overflow:hidden}
.wtb-badgeIcon span{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;opacity:0;animation:wtb-emoji 1500s infinite}
.wtb-badge[data-phase="idle"] .wtb-badgeIcon span{animation:none;opacity:1}
@keyframes wtb-emoji{0%{opacity:1}19.9%{opacity:1}20%{opacity:0}100%{opacity:0}}
.wtb-badgeMeta{display:flex;flex-direction:column;line-height:1.2;min-width:0}
.wtb-badgeVal{font-size:16px;font-weight:800;color:#fff;font-variant-numeric:tabular-nums;white-space:nowrap}
.wtb-badgeLabel{font-size:10px;color:#9a9a9a;letter-spacing:1px;white-space:nowrap}
.wtb-badgeSwitch{flex:none;width:22px;height:22px;border-radius:7px;display:flex;align-items:center;justify-content:center;font-size:11px;color:#8a8a8a;border:1px solid rgba(255,255,255,.1);background:transparent;cursor:pointer}
.wtb-badgeSwitch:hover{color:#fff;border-color:rgba(255,255,255,.3)}
.wtb-panel{position:fixed;width:400px;max-width:calc(100vw - 24px);max-height:calc(100vh - 24px);display:flex;flex-direction:column;background:rgba(24,24,30,.96);border:1px solid rgba(255,255,255,.09);border-radius:14px;box-shadow:0 12px 44px rgba(0,0,0,.6);overflow:hidden}
.wtb-head{position:relative;display:flex;align-items:center;gap:8px;padding:10px 12px;background:rgba(255,255,255,.04);cursor:grab;user-select:none;border-bottom:1px solid rgba(255,255,255,.06)}
.wtb-head:active{cursor:grabbing}
.wtb-title{font-size:13px;font-weight:700;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wtb-tabs{display:flex;gap:4px;margin-left:4px}
.wtb-tab{border:none;background:transparent;color:var(--dsw-alias-label-tertiary,#9a9a9a);font-size:12px;padding:4px 8px;border-radius:6px;cursor:pointer}
.wtb-tab[data-active="true"]{background:rgba(255,255,255,.12);color:#fff}
.wtb-dateWrap{display:flex;align-items:center;gap:4px;margin-left:auto}
.wtb-dateBtn{border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.08);color:#fff;font-size:12px;padding:2px 8px;border-radius:6px;cursor:pointer;white-space:nowrap}
.wtb-dateBtn:hover{background:rgba(255,255,255,.18)}
.wtb-today{border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.08);color:#fff;font-size:11px;padding:2px 8px;border-radius:6px;cursor:pointer;white-space:nowrap}
.wtb-today:hover{background:rgba(255,255,255,.18)}
.wtb-calendar{position:absolute;top:calc(100% + 4px);right:30px;z-index:10;background:#1e1f26;border:1px solid rgba(255,255,255,.15);border-radius:10px;padding:8px;box-shadow:0 8px 24px rgba(0,0,0,.5);width:216px}
.wtb-calHead{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px}
.wtb-calTitle{font-size:12px;color:#fff;font-weight:600}
.wtb-calNav{border:none;background:rgba(255,255,255,.08);color:#fff;width:22px;height:22px;border-radius:6px;cursor:pointer;font-size:14px;line-height:1}
.wtb-calNav:hover{background:rgba(255,255,255,.18)}
.wtb-calGrid{display:grid;grid-template-columns:repeat(7,1fr);gap:2px}
.wtb-calDow{font-size:10px;color:#9a9a9a;text-align:center;padding:2px 0}
.wtb-calCell{border:none;background:transparent;color:#e8e8e8;font-size:12px;height:24px;border-radius:6px;cursor:pointer;font-variant-numeric:tabular-nums}
.wtb-calCell:hover{background:rgba(255,255,255,.14)}
.wtb-calCell-sel{background:#ffb347;color:#1e1f26;font-weight:700}
.wtb-calCell-today{box-shadow:inset 0 0 0 1px #ffb347}
.wtb-calCell-future{opacity:.35;cursor:default}
.wtb-calCell-future:hover{background:transparent}
.wtb-close{border:none;background:transparent;color:#9a9a9a;font-size:16px;cursor:pointer;padding:2px 6px;border-radius:6px}
.wtb-close:hover{background:rgba(255,255,255,.1);color:#fff}
.wtb-body{overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:12px;flex:1;min-height:0}
.wtb-sec + .wtb-sec{border-top:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.08));padding-top:12px}
.wtb-values{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.wtb-valItem{background:rgba(255,255,255,.04);border-radius:8px;padding:12px;display:flex;flex-direction:column;align-items:center;gap:4px;min-width:0;text-align:center}
.wtb-valItem-toggle{cursor:pointer}
.wtb-valItem-toggle:hover{background:rgba(255,255,255,.09);box-shadow:inset 0 0 0 1px rgba(77,208,225,.35)}
.wtb-valIcon{font-size:15px;line-height:1;margin-bottom:2px}
.wtb-valNum{font-size:18px;font-weight:700;color:#fff;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wtb-valLabel{font-size:13px;color:#9a9a9a}
.wtb-verse{display:flex;flex-direction:column;gap:10px;margin-top:8px;font-size:13px;color:#9a9a9a;line-height:1.6}
.wtb-compPair{display:flex;flex-direction:column;gap:7px;min-width:0;padding:10px 12px;background:rgba(255,255,255,.04);border-radius:8px}
.wtb-compTop{display:grid;grid-template-columns:1fr 1fr;gap:12px;align-items:baseline;font-size:13px;color:#c9c9c9}
.wtb-compName{display:flex;align-items:baseline;gap:6px;min-width:0}
.wtb-compName-right{justify-content:flex-end}
.wtb-compLabel{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wtb-compName b{flex:none;font-weight:700;color:#fff;font-variant-numeric:tabular-nums;font-size:13px}
.wtb-compPct{flex:none;font-weight:800;font-variant-numeric:tabular-nums;font-size:13px}
.wtb-compDot{width:8px;height:8px;border-radius:50%;flex:none}
.wtb-compBar{display:flex;height:12px;border-radius:6px;background:rgba(255,255,255,.07);overflow:hidden}
.wtb-compFill{height:100%;transition:width .3s}
.wtb-scoreCard{display:flex;flex-direction:column;gap:8px;background:rgba(255,255,255,.05);border-radius:12px;padding:12px;margin-bottom:10px}
.wtb-score{display:flex;align-items:flex-end;gap:10px;cursor:pointer;flex-wrap:nowrap}
.wtb-score:hover{opacity:.85}
.wtb-scoreChevron{color:#9a9a9a;font-size:12px;flex:none;padding-bottom:4px}
.wtb-realmPeriods{display:flex;gap:6px;margin-top:2px}
.wtb-realmPeriodRow{display:flex;align-items:center;gap:8px;font-size:12px;color:#b9b9b9}
.wtb-realmPeriodLabel{flex:none;color:#e8e8e8;font-weight:600}
.wtb-realmPeriodBtn{border:1px solid rgba(255,255,255,.14);background:transparent;color:#c9c9c9;font-size:12px;padding:2px 10px;border-radius:6px;cursor:pointer;letter-spacing:.5px}
.wtb-realmPeriodBtn[data-active="true"]{background:rgba(255,255,255,.16);color:#fff}
.wtb-scoreNumWrap{display:flex;flex-direction:column;align-items:flex-start;gap:1px;flex:none}
.wtb-scoreNum{font-size:44px;font-weight:800;line-height:1;color:#ffb347;font-variant-numeric:tabular-nums;white-space:nowrap}
.wtb-scoreNumTag{font-size:11px;font-weight:700;color:#9a9a9a;letter-spacing:2px;white-space:nowrap}
.wtb-scoreMeta{display:flex;flex-direction:column;gap:2px;font-size:12px;color:var(--dsw-alias-label-secondary,#c9c9c9);min-width:0;margin-left:auto;align-items:flex-end}
.wtb-scoreTitle{font-size:15px;font-weight:700;color:#fff;white-space:nowrap}
.wtb-dims{display:grid;grid-template-columns:1fr 1fr;gap:4px 10px;padding:4px 0 0}
.wtb-dim{display:flex;align-items:baseline;gap:6px;font-size:12px;color:#b9b9b9;background:rgba(255,255,255,.045);border-radius:6px;padding:4px 8px}
.wtb-dimLabel{flex:none;min-width:32px;color:#e8e8e8;font-weight:600}
.wtb-dimActual{flex:1;text-align:right;color:#fff;font-variant-numeric:tabular-nums;white-space:nowrap}
.wtb-dimPts{font-weight:800;color:#ffd76d}
.wtb-dimBonus{display:flex;align-items:baseline;gap:6px;font-size:12px;color:#e8e8e8;background:linear-gradient(90deg,rgba(255,179,71,.16),rgba(255,179,71,.04));border-radius:6px;padding:4px 8px;margin-top:2px}
.wtb-dimBonus b{font-weight:800;color:#ffd76d;font-variant-numeric:tabular-nums}
.wtb-dimBonusNote{font-size:11px;color:#9a9a9a}
.wtb-dimTomato{background:linear-gradient(90deg,rgba(92,214,168,.16),rgba(92,214,168,.04))}
.wtb-dimTomato b{color:#5cd6a8}
.wtb-dimFail{background:linear-gradient(90deg,rgba(255,107,107,.18),rgba(255,107,107,.05))}
.wtb-dimFail b{color:#ff8a8a}
.wtb-dimFailNote{font-size:11px;font-weight:700;color:#ff8a8a}
.wtb-quip{font-size:14px;color:#9a9a9a;line-height:1.6;word-break:break-word;min-height:22px}
.wtb-realmDetail{display:flex;flex-direction:column;gap:8px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:10px;padding:10px 12px}
.wtb-realmCurrent{font-size:14px;font-weight:700;color:#fff}
.wtb-realmCurrent b{color:#ffb347}
.wtb-realmPeriodHint{font-size:12px;font-weight:400;color:#9a9a9a;margin-left:6px}
.wtb-realmTable{display:flex;flex-direction:column;gap:2px}
.wtb-realmRow{display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:12px;color:#b9b9b9;padding:2px 6px;border-radius:6px}
.wtb-realmRow-current{background:rgba(255,179,71,.15);color:#ffd27d;font-weight:700}
.wtb-realmRow-current .wtb-realmDigits{color:#ffb347}
.wtb-realmDigits{font-size:13px;color:#9a9a9a}
.wtb-realmProgress{display:flex;flex-direction:column;gap:4px;font-size:12px;color:#e8e8e8}
.wtb-realmProgressTop{display:flex;align-items:baseline;gap:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wtb-realmProgressPct{margin-left:auto;font-weight:800;color:#ffd76d;font-variant-numeric:tabular-nums}
.wtb-realmProgressBar{height:7px;border-radius:4px;background:rgba(255,255,255,.07);overflow:hidden}
.wtb-realmProgressFill{height:100%;border-radius:4px;background:linear-gradient(90deg,#ffd76d,#ffb347);transition:width .3s}
.wtb-realmFormula{font-size:13px;color:#9a9a9a;line-height:1.6}
.wtb-resize{height:8px;flex:none;cursor:ns-resize;touch-action:none;display:flex;align-items:center;justify-content:center;background:transparent}
.wtb-resize::after{content:'';width:40px;height:3px;border-radius:2px;background:rgba(255,255,255,.16)}
.wtb-resize:hover{background:rgba(255,255,255,.05)}
.wtb-resize:hover::after{background:rgba(255,255,255,.4)}
.wtb-sectionTitle{font-size:14px;font-weight:700;color:#e8e8e8;margin-bottom:6px}
.wtb-threadRow{display:grid;grid-template-columns:96px 1fr 56px 64px 44px;align-items:center;gap:8px;padding:6px 8px;border-radius:8px;cursor:pointer;font-size:13px}
.wtb-threadRow:hover{background:rgba(255,255,255,.07)}
.wtb-threadHead{display:grid;grid-template-columns:96px 1fr 56px 64px 44px;align-items:center;gap:8px;padding:0 8px 3px;font-size:10px;color:#8a8a8a;font-weight:600;letter-spacing:.5px;text-align:left}
.wtb-threadHead .wtb-thc{text-align:right}
.wtb-threadName{width:96px;flex:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#d8d8d8}
.wtb-threadName[data-archived="true"]{color:#8a8a8a;text-decoration:line-through}
.wtb-threadBar{flex:1;height:14px;background:rgba(255,255,255,.05);border-radius:4px;position:relative;overflow:hidden}
.wtb-threadSeg{position:absolute;top:0;bottom:0;background:linear-gradient(90deg,#7d9cff,#5cd6a8);border-radius:2px;opacity:.85}
.wtb-threadDur,.wtb-threadCalls,.wtb-threadAgo{text-align:right;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums}
.wtb-threadDur{color:#e8e8e8;font-weight:600}
.wtb-threadCalls{color:#b9b9b9}
.wtb-threadAgo{color:#7c7c7c}
.wtb-absent{color:#6f6f6f}
.wtb-sortRow{display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap}
.wtb-sortBtn{border:1px solid rgba(255,255,255,.14);background:transparent;color:#c9c9c9;font-size:12px;padding:3px 12px;border-radius:7px;cursor:pointer;letter-spacing:.5px}
.wtb-sortBtn[data-active="true"]{background:rgba(255,255,255,.16);color:#fff}
.wtb-linkBtn{border:none;background:transparent;color:#7d9cff;font-size:12px;cursor:pointer;padding:3px 6px}
.wtb-linkBtn[disabled],.wtb-sortBtn[disabled]{color:#6a6a6a;cursor:not-allowed;opacity:.55}
.wtb-heat{display:flex;flex-direction:column;gap:6px;position:relative}
.wtb-heatStats{display:flex;gap:16px;font-size:11px;color:#9a9a9a;padding:0 2px}
.wtb-heatStats b{color:#e8e8e8;font-variant-numeric:tabular-nums}
.wtb-heatBar{display:flex;gap:2px;height:84px;align-items:flex-end;margin-top:16px}
.wtb-heatCol{flex:1;border-radius:2px 2px 0 0;background:rgba(255,255,255,.05);min-height:2px;position:relative}
.wtb-heatColVal{position:absolute;top:-15px;left:50%;transform:translateX(-50%);font-size:10px;font-weight:600;color:#e8e8e8;font-variant-numeric:tabular-nums;white-space:nowrap;pointer-events:none;line-height:1}
.wtb-heatCol{flex:1;border-radius:2px 2px 0 0;background:rgba(255,255,255,.05);min-height:2px;position:relative}
.wtb-heatCol[data-xian="true"]{background:rgba(143,111,216,.9)}
.wtb-heatCol[data-xian="false"]{background:rgba(92,214,168,.85)}
.wtb-heatCol-empty{min-height:5px;background:rgba(255,255,255,.08);opacity:.55}
.wtb-heatCol[data-realm="true"]{background:linear-gradient(180deg,#ffd76d,#c9962e)}
.wtb-heatCol[data-realm="false"]{background:rgba(255,255,255,.09)}
.wtb-heatAxis{display:flex;justify-content:space-between;font-size:12px;color:#7c7c7c}
.wtb-year{display:flex;flex-direction:column;gap:8px}
.wtb-yearMonths{display:grid;grid-template-columns:repeat(6,1fr);gap:10px}
.wtb-yearMonth{display:flex;flex-direction:column;gap:3px;min-width:0}
.wtb-yearMonthLabel{font-size:10px;color:#8a8a8a;text-align:center}
.wtb-yearMonthGrid{display:grid;grid-template-rows:repeat(7,14px);grid-auto-flow:column;grid-auto-columns:14px;gap:2px;width:max-content;margin:0 auto}
.wtb-yearCell{width:12px;height:12px;border-radius:2px;cursor:pointer}
.wtb-yearCell-void{background:transparent;cursor:default}
.wtb-yearCell-future{background:transparent;box-shadow:inset 0 0 0 1px rgba(255,255,255,.08)}
.wtb-yearDetail{display:flex;flex-direction:column;gap:7px;padding:8px 10px;background:rgba(255,255,255,.04);border-radius:6px;min-height:20px}
.wtb-yearDetailHead{display:flex;align-items:center;justify-content:space-between;gap:10px}
.wtb-yearDetailDay{font-weight:700;color:#fff;font-size:12px;letter-spacing:.5px}
.wtb-yearDetailTier{display:flex;align-items:center;gap:6px;font-size:11px;font-weight:600;color:#ffd76d}
.wtb-yearDetailStats{display:grid;grid-template-columns:repeat(5,1fr);gap:6px}
.wtb-yearStat{display:flex;flex-direction:column;gap:2px;min-width:0}
.wtb-yearStatLabel{font-size:10px;color:#8a8a8a;white-space:nowrap}
.wtb-yearStat b{font-size:12px;color:#fff;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wtb-yearDetailEmpty{color:#8a8a8a;font-size:12px;padding:2px 0}
.wtb-yearDot{width:10px;height:10px;border-radius:50%;flex:none}
.wtb-yearLegend{display:flex;align-items:center;gap:8px;font-size:10px;color:#9a9a9a;flex-wrap:wrap}
.wtb-yearLegendItem{display:flex;align-items:center;gap:3px}
.wtb-yearLegendItem .wtb-yearCell{width:10px;height:10px;cursor:default}
.wtb-tip{position:absolute;z-index:9999;display:none;min-width:150px;max-width:280px;padding:10px 12px;border-radius:10px;background:#14141c !important;border:1px solid rgba(255,255,255,.16);color:#fff !important;font-size:12px;line-height:1.4;pointer-events:none;box-shadow:0 8px 24px rgba(0,0,0,.6)}
.wtb-tip.wtb-tip-show{display:block}
.wtb-tipTitle{font-size:12px;font-weight:700;color:#fff}
.wtb-tipSep{height:1px;background:rgba(255,255,255,.12);margin:7px 0 6px}
.wtb-tipRow{display:flex;align-items:center;gap:7px;font-size:12px;line-height:1;color:#cfcfcf}
.wtb-tipRow + .wtb-tipRow{margin-top:7px}
.wtb-tipDot{width:7px;height:7px;border-radius:50%;flex:none}
.wtb-tipVal{font-weight:700;font-size:13px;margin-left:auto;font-variant-numeric:tabular-nums}
.wtb-tipEmpty{font-size:12px;color:#8a8a8a;padding:2px 0}
.wtb-tipLabel{color:#cfcfcf}
.wtb-heatSwitch{display:flex;gap:8px;margin-bottom:6px;flex-wrap:wrap}
.wtb-heatBtn{border:1px solid rgba(255,255,255,.14);background:transparent;color:#c9c9c9;font-size:12px;padding:3px 12px;border-radius:7px;cursor:pointer;letter-spacing:.5px}
.wtb-heatBtn[data-active="true"]{background:rgba(255,255,255,.16);color:#fff}
.wtb-board{display:grid;grid-template-columns:26px 1fr 46px 52px 58px;align-items:center;gap:8px;padding:6px 8px;border-radius:8px;font-size:12px;background:rgba(255,255,255,.04)}
.wtb-boardRank{font-size:15px;flex:none;text-align:center}
.wtb-boardName{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#d8d8d8}
.wtb-boardScore{text-align:right;font-weight:800;color:#ffd76d;font-variant-numeric:tabular-nums}
.wtb-boardDur{text-align:right;color:#c9c9c9;font-variant-numeric:tabular-nums}
.wtb-boardCalls{text-align:right;color:#9a9a9a;font-variant-numeric:tabular-nums}
.wtb-boardHead{display:grid;grid-template-columns:26px 1fr 46px 52px 58px;align-items:center;gap:8px;padding:0 8px 3px;font-size:10px;color:#8a8a8a;font-weight:600;letter-spacing:.5px;text-align:left}
.wtb-boardHead .wtb-thc{text-align:right}
.wtb-boardHead .wtb-boardHeadRank{text-align:center}
.wtb-notes{display:flex;flex-direction:column;gap:4px;font-size:14px;color:#9a9a9a;line-height:1.7}
.wtb-noteItem{font-size:14px}
.wtb-noteSub{padding-left:18px;font-size:13px;border-left:2px solid rgba(255,255,255,.08);margin-left:2px}
.wtb-notes .wtb-sectionTitle{margin-bottom:0}
.wtb-noteK{font-weight:700}
.wtb-noteK-blue{color:#6d8dff}.wtb-noteK-orange{color:#ffb347}.wtb-noteK-purple{color:#b394ec}.wtb-noteK-green{color:#5cd6a8}.wtb-noteK-red{color:#ff8a8a}.wtb-noteK-gold{color:#ffd76d}
.wtb-empty{padding:24px;text-align:center;color:#8a8a8a;font-size:13px}
.wtb-rangeStats{display:flex;gap:10px;flex-wrap:wrap;font-size:12px;color:#cfcfcf}
.wtb-rangeStats b{color:#fff}
`;
			document.head.appendChild(tag);
		}
		function fmtDur(minutes) {
			const days = Math.floor(minutes / 1440);
			const h = Math.floor(minutes % 1440 / 60);
			const m = Math.round(minutes % 60);
			if (days > 0) return `${days}天${h}h${m > 0 ? m.toString().padStart(2, "0") : ""}`;
			if (h === 0) return `${m}m`;
			return `${h}h${m > 0 ? m.toString().padStart(2, "0") : ""}`;
		}
		function fmtWan(n) {
			if (n >= 1e8) return (n / 1e8).toFixed(1) + "亿";
			if (n >= 1e4) return (n / 1e4).toFixed(1) + "万";
			return String(n);
		}
		/** '2026-08-01' → '26.8.1'（年历窗口标题用）。 */
		function fmtShortRange(from, to) {
			const f = (d) => {
				const [y, m, dd] = d.split("-").map(Number);
				return `${String(y).slice(2)}.${m}.${dd}`;
			};
			return `${f(from)} – ${f(to)}`;
		}
		/** 大数可读化（境界门槛/区间用）：亿/万/原值（整数，去尾零）。 */
		function fmtGate(n) {
			if (n >= 1e8) return `${(n / 1e8).toFixed(1).replace(/\.0$/, "")}亿`;
			if (n >= 1e4) return `${(n / 1e4).toFixed(1).replace(/\.0$/, "")}万`;
			return String(n);
		}
		const TIP_COLORS = {
			duration: "#7d9cff",
			calls: "#ffb347",
			tokens: "#b394ec",
			realm: "#ffd76d",
			xian: "#5cd6a8"
		};
		/** 悬停卡片 HTML：标题 + 分隔线 + 每行一条彩色数值（圆点 + 标签 + 同色粗体数字）；无任何数值行时显示"无活动"灰字。 */
		function tipCardHtml(title, rows) {
			if (rows.length === 0) return `<div class="wtb-tipTitle">${title}</div><div class="wtb-tipSep"></div><div class="wtb-tipEmpty">无活动</div>`;
			return `<div class="wtb-tipTitle">${title}</div><div class="wtb-tipSep"></div>` + rows.map((r) => `<div class="wtb-tipRow"><span class="wtb-tipDot" style="background:${r.color}"></span><span class="wtb-tipLabel">${r.label}</span><span class="wtb-tipVal" style="color:${r.color}">${r.text}</span></div>`).join("");
		}
		const DEFAULT_COEFFS = {
			minutePerMin: 150,
			callPts: 15,
			stepPts: 15,
			userInputPts: 150,
			inputTokenDiv: 1e4,
			outputTokenDiv: 1e4,
			breakthroughPct: .05,
			breakthroughFailPct: .01,
			tomatoGrowthPerSeg: .1
		};
		function coeffsOf(s) {
			const c = s?.coeffs;
			return {
				minutePerMin: typeof c?.minutePerMin === "number" ? c.minutePerMin : DEFAULT_COEFFS.minutePerMin,
				callPts: typeof c?.callPts === "number" ? c.callPts : DEFAULT_COEFFS.callPts,
				stepPts: typeof c?.stepPts === "number" ? c.stepPts : DEFAULT_COEFFS.stepPts,
				userInputPts: typeof c?.userInputPts === "number" ? c.userInputPts : DEFAULT_COEFFS.userInputPts,
				inputTokenDiv: typeof c?.inputTokenDiv === "number" ? c.inputTokenDiv : DEFAULT_COEFFS.inputTokenDiv,
				outputTokenDiv: typeof c?.outputTokenDiv === "number" ? c.outputTokenDiv : DEFAULT_COEFFS.outputTokenDiv,
				breakthroughPct: typeof c?.breakthroughPct === "number" ? c.breakthroughPct : DEFAULT_COEFFS.breakthroughPct,
				breakthroughFailPct: typeof c?.breakthroughFailPct === "number" ? c.breakthroughFailPct : DEFAULT_COEFFS.breakthroughFailPct,
				tomatoGrowthPerSeg: typeof c?.tomatoGrowthPerSeg === "number" ? c.tomatoGrowthPerSeg : DEFAULT_COEFFS.tomatoGrowthPerSeg
			};
		}
		/** 修仙境界（12 档，与 host 一致）。 */
		const REALMS = [
			"炼气",
			"筑基",
			"金丹",
			"元婴",
			"化神",
			"炼虚",
			"合体",
			"大乘",
			"渡劫",
			"真仙",
			"金仙",
			"宇宙洪荒"
		];
		/** 境界变比阈值表（下限含，30 万起点，2026-08-17 v16：×15 展示尺度 + 顺眼圆整）：<30万 炼气 / 30万 筑基 / 60万 金丹 / 90万 元婴 / 135万 化神 / 195万 炼虚 / 270万 合体 / 360万 大乘 / 480万 渡劫 / 630万 真仙 / 810万 金仙 / 999万+ 宇宙洪荒。 */
		const REALM_THRESHOLDS = [
			3e5,
			6e5,
			9e5,
			135e4,
			195e4,
			27e5,
			36e5,
			48e5,
			63e5,
			81e5,
			999e4
		];
		/** 修仙值 → 境界（本地兜底，与 host 阈值表一致）：value ≥ 阈值即升档。 */
		function realmIdxOf(value) {
			let idx = 0;
			for (let i = 0; i < REALM_THRESHOLDS.length; i++) if (value >= REALM_THRESHOLDS[i]) idx = i + 1;
			else break;
			return Math.min(idx, REALMS.length - 1);
		}
		function realmOfLocal(value) {
			return REALMS[realmIdxOf(value)];
		}
		/** 境界视觉：颜色由素到绚丽、字号随境界递增（炼气 18px → 宇宙洪荒 40px）。 */
		const REALM_STYLE = [
			{
				color: "#9aa0a6",
				size: 18
			},
			{
				color: "#7d9cff",
				size: 20
			},
			{
				color: "#ffd27d",
				size: 22
			},
			{
				color: "#5cd6a8",
				size: 24
			},
			{
				color: "#b394ec",
				size: 26
			},
			{
				color: "#f48fb1",
				size: 28
			},
			{
				color: "#ff8a5c",
				size: 30
			},
			{
				color: "#ff6b6b",
				size: 32
			},
			{
				color: "#c77dff",
				size: 34
			},
			{
				color: "#ffd700",
				size: 36
			},
			{
				color: "#ffbf00",
				size: 38
			},
			{
				color: "#ff9ef5",
				size: 40
			}
		];
		/** 境界名 → 视觉样式（宇宙洪荒用绚丽渐变文字）。host 下发可能带"期"后缀（如"炼虚期"），归一化去后缀再匹配。
		*  cap：可选字号上限（分数卡一行放不下时压缩，如 40px 宇宙洪荒 + 7 位数字会换行）。 */
		function realmStyleCss(realm, cap) {
			const norm = realm.replace(/期$/, "");
			const idx = REALMS.indexOf(norm);
			const s = idx >= 0 ? REALM_STYLE[idx] : REALM_STYLE[0];
			const size = cap !== void 0 ? Math.min(s.size, cap) : s.size;
			if (norm === "宇宙洪荒") return `font-size:${size}px;background:linear-gradient(90deg,#ff6ec7,#ffd700,#7d9cff);-webkit-background-clip:text;background-clip:text;color:transparent`;
			return `font-size:${size}px;color:${s.color}`;
		}
		const REALM_QUIPS = {
			炼气: ["刚入门的道友，丹田还空着", "万丈高楼平地起，先从报错练起"],
			筑基: ["筑基已成，工具链算是立住了", "地基打牢，后面才不塌方"],
			金丹: ["金丹凝成，调用如剑气纵横", "内丹已成，快捷键都快冒烟了"],
			元婴: ["元婴出窍，一个顶俩", "分身之术初成，全仓库尽收眼底"],
			化神: ["化神老怪，代码见了绕道走", "神识覆盖全仓库，bug 无处遁形"],
			炼虚: ["炼虚合道，人机合一", "虚实之间，只有键盘声"],
			合体: ["合体大能，一气化三清", "三清归位，一个顶三个"],
			大乘: ["大乘之境，只差一步飞升", "功德圆满，就差最后一哆嗦"],
			渡劫: ["渡劫关头，小心 CI 天雷", "天劫将至，测试还没写完"],
			真仙: ["真仙下凡，bug 闻风丧胆", "仙人之躯，百毒不侵——但记得吃饭"],
			金仙: ["金仙之躯，万法不侵", "金身已成，CPU 都要甘拜下风"],
			宇宙洪荒: ["宇宙洪荒，大道之巅", "洪荒之力，拉磨也拉出了星辰大海"]
		};
		/** 劝慰后缀（按境界档位，大乘期起，越长越卷；`——`连接在境界句后）。 */
		const CARE_SUFFIX = {
			大乘: "——修仙虽好，走火入魔不值当，身体是本钱",
			渡劫: "——修仙虽好，走火入魔不值当；代码明天还在，身体只有一副，道友珍重",
			真仙: "——修仙虽好，走火入魔不值当；代码明天还在，身体只有一副，道友珍重。飞升虽好，也要按时吃饭",
			金仙: "——修仙虽好，走火入魔不值当；代码明天还在，身体只有一副，道友珍重。飞升虽好，也要按时吃饭；仙人也是凡人变的",
			宇宙洪荒: "——修仙虽好，走火入魔不值当；代码明天还在，身体只有一副，道友珍重。飞升虽好，也要按时吃饭；卷到洪荒之巅，别忘了最初只是想好好写代码"
		};
		/** 时段句：小时区间 [from, to)，from>to 表示跨午夜；实际判断用 minutesOfDay（修仙 22:30–06:30）；越晚越长，带身体劝慰温度。 */
		const PERIOD_QUIPS = [
			[
				23,
				5,
				["凌晨的代码最香，但身体是本钱——熬夜修仙一时爽，明日血压两行泪，道友早歇", "夜深人静，bug 也安静了——但你的眼睛需要休息，代码明天还在"]
			],
			[
				5,
				8,
				["晨光熹微，开工前记得吃早饭", "鸡鸣即起，道友早，先喝口水"]
			],
			[
				8,
				18,
				["阳光正好，久坐记得起身走走", "阳光正好，适合干活（才怪），记得喝水"]
			],
			[
				18,
				23,
				["夕阳无限好，只是要加班——记得喝水，眼睛也歇歇", "华灯初上，今天的活也快收尾了，伸个懒腰"]
			]
		];
		function pickQuip(pool) {
			return pool[Math.floor(Math.random() * pool.length)] ?? pool[0];
		}
		/** 时段桶 id（调侃句缓存 key 用）：xian=22:30–06:30 / dawn=06:30–08:00 / day=08:00–18:00 / eve=18:00–22:30。 */
		function periodBucket(minutesOfDay) {
			if (minutesOfDay >= 1350 || minutesOfDay < 390) return "xian";
			if (minutesOfDay < 480) return "dawn";
			if (minutesOfDay < 1080) return "day";
			return "eve";
		}
		function quipForPeriod(minutesOfDay) {
			let pool = PERIOD_QUIPS[0][2];
			if (minutesOfDay >= 390 && minutesOfDay < 480) pool = PERIOD_QUIPS[1][2];
			else if (minutesOfDay >= 480 && minutesOfDay < 1080) pool = PERIOD_QUIPS[2][2];
			else if (minutesOfDay >= 1080 && minutesOfDay < 1350) pool = PERIOD_QUIPS[3][2];
			return pickQuip(pool);
		}
		const QUIP_CACHE_MS = 3e5;
		let quipLineCache = null;
		function quipLine(tier, minutesOfDay, period) {
			const now = Date.now();
			const key = `${tier}@${periodBucket(minutesOfDay)}@${period}`;
			if (quipLineCache !== null && quipLineCache.key === key && now - quipLineCache.pickedAt < QUIP_CACHE_MS) return quipLineCache.line;
			const line = `${pickQuip(REALM_QUIPS[tier] ?? REALM_QUIPS["炼气"])}${CARE_SUFFIX[tier] ?? ""} · ${quipForPeriod(minutesOfDay)}`;
			quipLineCache = {
				key,
				line,
				pickedAt: now
			};
			return line;
		}
		function fmtAgo(ts) {
			if (ts <= 0) return "—";
			const diff = Date.now() - ts;
			if (diff < 6e4) return "刚刚";
			if (diff < 36e5) return `${Math.floor(diff / 6e4)} 分钟前`;
			if (diff < 864e5) return `${Math.floor(diff / 36e5)} 小时前`;
			return `${Math.floor(diff / 864e5)} 天前`;
		}
		/** 无汉字相对时间（线程行用，尽量短）：now / Xm / Xh / Xd。 */
		function fmtAgoShort(ts) {
			if (ts <= 0) return "—";
			const diff = Date.now() - ts;
			if (diff < 6e4) return "now";
			if (diff < 36e5) return `${Math.floor(diff / 6e4)}m`;
			if (diff < 864e5) return `${Math.floor(diff / 36e5)}h`;
			return `${Math.floor(diff / 864e5)}d`;
		}
		/** 本地日期键加 n 天（n 可为负；Date 构造自动归一化跨月/跨年）。 */
		function addDaysKey(day, n) {
			const [y, m, d] = day.split("-").map(Number);
			const dt = new Date(y, m - 1, d + n);
			return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
		}
		/** 'YYYY-MM-DD' → 该日所属自然周（周一起始）的周一日期键。 */
		function weekStartKey(day) {
			const [y, m, d] = day.split("-").map(Number);
			return addDaysKey(day, -((new Date(y, m - 1, d).getDay() + 6) % 7));
		}
		function apply(ctx) {
			injectCss();
			const host = document.createElement("div");
			host.dataset.worktimeHost = "";
			document.body.appendChild(host);
			const panel = new WorktimePanel(ctx, host);
			panel.mount();
			ctx.effect(() => ctx.slots.inject("shell.overlay", () => ctx.slots.register({
				name: "shell.overlay",
				id: "dsh-worktime-board-overlay",
				component: () => ({ render() {
					return null;
				} })
			})), "dsh-worktime-board: overlay placeholder");
			ctx.effect(() => () => {
				panel.dispose();
				host.remove();
			}, "dsh-worktime-board: floater");
		}
		var WorktimePanel = class {
			ctx;
			host;
			open = false;
			/** 输入次数卡片口径：false = 全量输入（user/message，与计分同源）；true = 人输入（真人 prompt）。点击卡片切换。 */
			inputHuman = false;
			tab = "day";
			/** 日视图查看的历史日期（YYYY-MM-DD）；null = 实时跟随今日。 */
			viewDate = null;
			/** 自定义日历弹层：是否打开；calMonth = 当前显示的年月（YYYY-MM）。 */
			calOpen = false;
			calMonth = "";
			/** 日历弹层外部点击关闭的 document 监听器（实例级单例，防每次 render 重复注册累积）。 */
			calDocHandler = null;
			heatKind = "duration";
			sortBy = "active";
			showAll = false;
			includeArchived = false;
			pos = null;
			height = null;
			/** 评分卡点击展开的「修仙阶段详情」toggle 状态（面板重建后恢复）。 */
			showRealmDetail = false;
			data = null;
			/** 轮询串行锁（force 请求不碰锁，靠响应 range 校验过期）。 */
			busy = false;
			disposed = false;
			timer = null;
			constructor(ctx, host) {
				this.ctx = ctx;
				this.host = host;
				try {
					const raw = localStorage.getItem(POS_KEY);
					if (raw !== null) {
						const parsed = JSON.parse(raw);
						if (typeof parsed.x === "number" && typeof parsed.y === "number") this.pos = {
							x: parsed.x,
							y: parsed.y
						};
						if (typeof parsed.h === "number" && parsed.h >= 220) this.height = parsed.h;
					}
				} catch {}
			}
			mount() {
				this.tick();
				this.timer = setInterval(() => {
					this.tick();
				}, this.pollMs());
			}
			dispose() {
				this.disposed = true;
				this.detachCalDocHandler();
				if (this.timer !== null) clearInterval(this.timer);
				this.host.innerHTML = "";
			}
			/** 移除日历外部点击关闭的 document 监听器（幂等；随弹层关闭 / 面板收起 / 组件卸载调用）。 */
			detachCalDocHandler() {
				if (this.calDocHandler !== null) {
					document.removeEventListener("click", this.calDocHandler);
					this.calDocHandler = null;
				}
			}
			pollMs() {
				return this.open ? POLL_MS_OPEN : POLL_MS_CLOSED;
			}
			/** 本地今日键 'YYYY-MM-DD'（与 host dayKeyOf 一致）。 */
			todayKey() {
				const n = /* @__PURE__ */ new Date();
				return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
			}
			/** 日历弹层是否在交互中（打开或日期按钮聚焦）：是则跳过自动重建，防止轮询把弹层/焦点打断。 */
			calendarActive() {
				if (this.calOpen) return true;
				const el = document.activeElement;
				return el !== null && el instanceof HTMLElement && el.classList.contains("wtb-dateBtn");
			}
			/** 关键数据是否无变化（用于跳过无谓重建——用户反馈"每次更新整体刷新"）。 */
			sameState(a, b) {
				if (a.range !== b.range || a.day !== b.day) return false;
				const oa = a.overview, ob = b.overview;
				if (oa.activeMinutes !== ob.activeMinutes || oa.avgActiveMinutes !== ob.avgActiveMinutes || oa.calls !== ob.calls || oa.inputTokens !== ob.inputTokens || oa.outputTokens !== ob.outputTokens || oa.peakParallel !== ob.peakParallel || oa.llmRatio !== ob.llmRatio || oa.toolRatio !== ob.toolRatio || oa.xianPct !== ob.xianPct || oa.activeDays !== ob.activeDays) return false;
				if (a.threads.length !== b.threads.length) return false;
				for (let i = 0; i < a.threads.length; i++) {
					const ta = a.threads[i], tb = b.threads[i];
					if (ta.activeMinutes !== tb.activeMinutes || ta.calls !== tb.calls || ta.outputTokens !== tb.outputTokens || ta.lastActiveAt !== tb.lastActiveAt || ta.archived !== tb.archived || ta.activeDays !== tb.activeDays) return false;
				}
				if (a.heat.kind !== b.heat.kind) return false;
				const ha = a.heat, hb = b.heat;
				if (ha.kind === "day" && hb.kind === "day") {
					if (ha.heatSlots.length !== hb.heatSlots.length || ha.heatCalls.length !== hb.heatCalls.length || ha.heatTokens.length !== hb.heatTokens.length || (ha.heatInput?.length ?? 0) !== (hb.heatInput?.length ?? 0) || (ha.heatRealm?.length ?? 0) !== (hb.heatRealm?.length ?? 0)) return false;
					for (let i = 0; i < ha.heatSlots.length; i++) if (ha.heatSlots[i] !== hb.heatSlots[i] || ha.heatCalls[i] !== hb.heatCalls[i] || ha.heatTokens[i] !== hb.heatTokens[i] || (ha.heatInput?.[i] ?? 0) !== (hb.heatInput?.[i] ?? 0) || (ha.heatRealm?.[i] ?? 0) !== (hb.heatRealm?.[i] ?? 0)) return false;
				} else if (ha.kind === "days" && hb.kind === "days") {
					if (ha.days.length !== hb.days.length) return false;
					for (let i = 0; i < ha.days.length; i++) {
						const da = ha.days[i], db = hb.days[i];
						if (da.day !== db.day || da.activeMinutes !== db.activeMinutes || da.calls !== db.calls || da.tokens !== db.tokens || da.xianPct !== db.xianPct || (da.realm ?? 0) !== (db.realm ?? 0)) return false;
					}
				}
				const ba = a.backfill, bb = b.backfill;
				if ((ba?.complete ?? false) !== (bb?.complete ?? false) || (ba?.done ?? 0) !== (bb?.done ?? 0) || (ba?.total ?? 0) !== (bb?.total ?? 0)) return false;
				return true;
			}
			/** 区块级防御渲染：单个区块异常只降级该区块（显示占位），不拖垮整个面板、不回滚数据。 */
			safeRender(name, fn) {
				try {
					return fn();
				} catch (e) {
					console.error(`[wtb] ${name} render failed:`, e);
					return `<div class="wtb-sec"><div class="wtb-empty">${name === "heat" ? "🌡️" : name === "board" ? "🏆" : name === "threads" ? "🔗" : name === "values" ? "🧘" : "📝"} ${name} 加载失败</div></div>`;
				}
			}
			/** 拉取并渲染：单一数据源 this.data。收起时始终拉 day（徽标只需今日）；展开拉当前 tab。
			*  串行锁：常规轮询忙时跳过；force（tab 切换）不碰锁，靠响应自带 range 校验过期（无序号无缓存）。 */
			async tick(force = false) {
				if (this.disposed) return;
				if (this.busy && !force) return;
				if (!force) this.busy = true;
				try {
					const range = this.open ? this.tab : "day";
					const date = this.open && this.tab === "day" && this.viewDate !== null ? this.viewDate : null;
					const res = await fetch(`${STATE_URL}?range=${range}${date !== null ? `&date=${date}` : ""}`, { cache: "no-store" });
					if (!res.ok) throw new Error(`http ${res.status}`);
					const body = await res.json();
					if (this.disposed) return;
					if (this.open && (body.range !== this.tab || date !== null && body.day !== date)) return;
					const prev = this.data;
					if (prev !== null && this.sameState(prev, body)) {
						this.data = body;
						if (!this.open) {
							const dot = this.host.querySelector(".wtb-badge");
							const busyNow = body.overview.activeMinutes > 0;
							if (dot !== null && dot.getAttribute("data-busy") !== String(busyNow)) dot.setAttribute("data-busy", String(busyNow));
						}
						return;
					}
					this.data = body;
					if (!force && this.calendarActive()) return;
					try {
						this.render();
					} catch (e) {
						console.error("[wtb] render failed:", e);
						this.data = prev;
						if (prev === null) setTimeout(() => {
							this.tick(true);
						}, 800);
					}
				} catch {
					if (this.data === null && !this.disposed) setTimeout(() => {
						this.tick(true);
					}, 800);
				} finally {
					if (!force) this.busy = false;
				}
			}
			rangeLabel(r = this.tab) {
				if (r === "day") return this.viewDate !== null ? this.viewDate.slice(5) : "今日";
				return r === "week" ? "本周" : "本月";
			}
			/** 自定义日历弹层：当前 calMonth 的月网格，点击日期选日（当天=回实时），可前后翻月。 */
			calendarHtml() {
				const today = this.todayKey();
				if (this.calMonth === "") this.calMonth = (this.viewDate ?? today).slice(0, 7);
				const [y, m] = this.calMonth.split("-").map(Number);
				const firstDow = new Date(y, m - 1, 1).getDay();
				const daysInMonth = new Date(y, m, 0).getDate();
				const cells = [];
				for (let i = 0; i < firstDow; i++) cells.push("<span class=\"wtb-calCell\"></span>");
				for (let d = 1; d <= daysInMonth; d++) {
					const key = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
					const isSel = this.viewDate === key;
					const isToday = key === today;
					const isFuture = key > today;
					cells.push(`<button type="button" class="wtb-calCell${isSel ? " wtb-calCell-sel" : ""}${isToday ? " wtb-calCell-today" : ""}${isFuture ? " wtb-calCell-future" : ""}" data-cal-day="${key}"${isFuture ? " disabled" : ""}>${d}</button>`);
				}
				return `
      <div class="wtb-calendar">
        <div class="wtb-calHead">
          <button type="button" class="wtb-calNav" data-cal-prev aria-label="上个月">‹</button>
          <span class="wtb-calTitle">${y}年${m}月</span>
          <button type="button" class="wtb-calNav" data-cal-next aria-label="下个月">›</button>
        </div>
        <div class="wtb-calGrid">
          ${[
					"日",
					"一",
					"二",
					"三",
					"四",
					"五",
					"六"
				].map((w) => `<span class="wtb-calDow">${w}</span>`).join("")}
          ${cells.join("")}
        </div>
      </div>`;
			}
			render() {
				if (this.open) this.renderPanel();
				else this.renderBadge();
			}
			renderBadge() {
				const o = this.data?.overview;
				const s = this.data?.score;
				const busy = this.isRecentlyActive();
				let mode = "duration";
				try {
					mode = localStorage.getItem("wtb-badge-mode") === "realm" ? "realm" : "duration";
				} catch {}
				const realmValue = s?.realmByPeriod?.day?.value ?? s?.value ?? 0;
				const val = o === void 0 ? "—" : mode === "realm" ? fmtWan(Math.round(realmValue)) : fmtDur(o.activeMinutes);
				const label = mode === "realm" ? "修仙值" : "时长";
				this.host.innerHTML = `
      <button type="button" class="wtb-badge" data-busy="${busy}" data-phase="${this.badgePhase()}" aria-label="牛马修仙看板">
        <span class="wtb-badgeIcon" aria-hidden>${this.badgeArt()}</span>
        <span class="wtb-badgeMeta">
          <span class="wtb-badgeVal">${val}</span>
          <span class="wtb-badgeLabel">${label}</span>
        </span>
        <span class="wtb-badgeSwitch" data-badge-switch title="切换显示：时长 / 修仙值" aria-label="切换显示内容">⇄</span>
      </button>`;
				this.host.querySelector(".wtb-badge")?.addEventListener("click", () => {
					this.open = true;
					this.reschedule();
					if (this.data === null || this.data.range !== this.tab || this.tab === "day" && this.viewDate !== null && this.data.day !== this.viewDate) this.tick(true);
					this.render();
				});
				this.host.querySelector(".wtb-badgeSwitch")?.addEventListener("click", (e) => {
					e.stopPropagation();
					const next = mode === "realm" ? "duration" : "realm";
					try {
						localStorage.setItem("wtb-badge-mode", next);
					} catch {}
					this.renderBadge();
				});
			}
			/** 折叠卡片主题相位：修仙段=月（紫底），正常段=日（橙底），无数据=中性。 */
			badgePhase() {
				const o = this.data?.overview;
				if (o === void 0 || o.activeMinutes === 0) return "idle";
				const now = /* @__PURE__ */ new Date();
				const mod = now.getHours() * 60 + now.getMinutes();
				return mod >= 1350 || mod < 390 ? "night" : "day";
			}
			/** 折叠卡片主视觉：牛/马 + 昼夜 + 天气 emoji 轮播（每 5 分钟换 1 个，一次只显示 1 个，居中，瞬间切换）。
			*  修仙段 = 🐂🐴🌙⭐🌧️；白天 = 🐂🐴☀️⛅🌈（昼夜图案只在对应时段出现）；无数据 = 固定 🐂。
			*  顺序随机（按相位缓存一次，刷新页面后新随机起点，段内不再跳动）。 */
			badgeOrder = {};
			badgeArt() {
				const phase = this.badgePhase();
				if (phase === "idle") return "<span>🐂</span>";
				if (this.badgeOrder[phase] === void 0) {
					const arr = [...phase === "night" ? [
						"🐂",
						"🐴",
						"🌙",
						"⭐",
						"🌧️"
					] : [
						"🐂",
						"🐴",
						"☀️",
						"⛅",
						"🌈"
					]];
					for (let i = arr.length - 1; i > 0; i--) {
						const j = Math.floor(Math.random() * (i + 1));
						[arr[i], arr[j]] = [arr[j], arr[i]];
					}
					this.badgeOrder[phase] = arr;
				}
				return this.badgeOrder[phase].map((e, i) => `<span style="animation-delay:${-i * 300}s">${e}</span>`).join("");
			}
			/** 近 30 分钟（6 槽）是否有活动（折叠卡活跃判定）。 */
			isRecentlyActive() {
				const o = this.data?.overview;
				if (o === void 0 || o.activeMinutes === 0) return false;
				const h = this.data?.heat;
				if (h !== void 0 && h.kind === "day") {
					const now = /* @__PURE__ */ new Date();
					const slot = Math.floor((now.getHours() * 60 + now.getMinutes()) / 5);
					for (let s = Math.max(0, slot - 5); s <= slot; s++) if ((h.heatSlots[s] ?? 0) > 0) return true;
					return false;
				}
				return o.activeMinutes > 0;
			}
			reschedule() {
				if (this.timer !== null) clearInterval(this.timer);
				this.timer = setInterval(() => {
					this.tick();
				}, this.pollMs());
			}
			renderPanel() {
				const d = this.data;
				const p = this.pos;
				const style = p === null ? "right:16px;bottom:16px" : `left:${p.x}px;top:${p.y}px`;
				const heightStyle = this.height !== null ? `height:${this.height}px;` : "";
				const scrollTop = this.host.querySelector(".wtb-body")?.scrollTop ?? 0;
				this.host.innerHTML = `
      <div class="wtb-panel wtb-root" style="${heightStyle}${style}">
        <div class="wtb-head">
          <span class="wtb-title">🐂🐴 牛马修仙看板</span>
          <div class="wtb-tabs">
            ${[
					"day",
					"week",
					"month"
				].map((t) => `<button type="button" class="wtb-tab" data-active="${this.tab === t}" data-tab="${t}">${this.rangeLabel(t)}</button>`).join("")}
          </div>
          ${this.tab === "day" ? `
          <span class="wtb-dateWrap">
            <button type="button" class="wtb-dateBtn" data-cal-toggle title="选择查看日期" aria-label="选择查看日期">📅 ${this.viewDate !== null ? this.viewDate.slice(5) : "今日"}</button>
            ${this.viewDate !== null ? `<button type="button" class="wtb-today" data-back-today title="回到今日">今日</button>` : ""}
          </span>
          ${this.calOpen ? this.calendarHtml() : ""}` : ""}
          <button type="button" class="wtb-close" aria-label="收起">✕</button>
        </div>
        <div class="wtb-body">
          ${this.safeRender("values", () => this.valuesHtml(d))}
          ${this.safeRender("heat", () => this.heatHtml(d))}
          ${this.safeRender("threads", () => this.threadsHtml(d))}
          ${this.safeRender("board", () => this.boardHtml(d))}
          ${this.safeRender("notes", () => this.notesHtml(d))}
          ${this.backfillHtml(d)}
        </div>
        <div class="wtb-resize" title="拖动调整高度" aria-hidden></div>
      </div>`;
				if (scrollTop > 0) {
					const body = this.host.querySelector(".wtb-body");
					if (body !== null) {
						body.scrollTop = scrollTop;
						requestAnimationFrame(() => {
							if (body.scrollTop === 0) body.scrollTop = scrollTop;
						});
					}
				}
				this.bindPanel();
			}
			valuesHtml(d) {
				if (d === null) return "<div class=\"wtb-sec\"><div class=\"wtb-empty\">数据收集中…</div></div>";
				const o = d.overview;
				const s = d.score;
				const isRange = this.tab !== "day";
				const effRaw = o.llmMs <= 0 ? 0 : o.outputTokens / (o.llmMs / 6e4);
				const scoreBlock = s === void 0 ? "" : this.scoreBlockHtml(o, s);
				const xianMin = Math.round(o.activeMinutes * o.xianPct);
				const normalMin = Math.max(0, o.activeMinutes - xianMin);
				const fmtMin = (m) => m > 0 ? fmtDur(m) : "0";
				const inputVal = this.inputHuman ? o.humanInputs ?? 0 : o.userInputs ?? 0;
				const items = [
					[
						"🕐",
						isRange ? "总修行" : "修行时长",
						fmtDur(o.activeMinutes),
						"#7d9cff",
						false
					],
					[
						"📥",
						"输入 token",
						fmtWan(o.inputTokens),
						"#4dd0e1",
						false
					],
					[
						"📤",
						"输出 token",
						fmtWan(o.outputTokens),
						"#b394ec",
						false
					],
					[
						"💬",
						this.inputHuman ? "人输入" : "输入次数",
						`${inputVal} 次`,
						"#4dd0e1",
						true
					],
					[
						"🛠️",
						"工具调用",
						`${o.calls} 次`,
						"#ffb347",
						false
					]
				];
				if (isRange) {
					items.push([
						"📅",
						`活跃天数`,
						`${o.activeDays} 天`,
						"#ffd27d",
						false
					]);
					items.push([
						"⚖️",
						"日均修行",
						fmtDur(o.avgActiveMinutes),
						"#ff6b6b",
						false
					]);
				}
				if (effRaw > 0) items.push([
					"⚡",
					"输出速率",
					`${effRaw >= 1e4 ? (effRaw / 1e4).toFixed(1) + "万" : Math.round(effRaw)} tok/分`,
					"#1abc9c",
					false
				]);
				return `
      <div class="wtb-sec">
        ${scoreBlock}
        <div class="wtb-values">
          ${items.map(([icon, label, value, color, toggle]) => `
            <div class="wtb-valItem${toggle ? " wtb-valItem-toggle" : ""}"${toggle ? ` data-input-toggle title="点击切换：输入次数（含委托/注入） / 人输入（仅真人 prompt）"` : ""}>
              <span class="wtb-valIcon" style="color:${color}">${icon}</span>
              <span class="wtb-valNum">${value}</span>
              <span class="wtb-valLabel">${label}</span>
            </div>`).join("")}
        </div>
        <div class="wtb-verse">
          <div class="wtb-compPair" title="思考 = 模型生成耗时 · 工具 = 工具运行耗时">
            <div class="wtb-compTop">
              <span class="wtb-compName"><span class="wtb-compDot" style="background:#7d9cff"></span><span class="wtb-compLabel">🧠 思考</span><b>${o.llmMs > 0 ? fmtDur(o.llmMs / 6e4) : "0"}</b><span class="wtb-compPct" style="color:#7d9cff">${Math.round(o.llmRatio * 100)}%</span></span>
              <span class="wtb-compName wtb-compName-right"><span class="wtb-compDot" style="background:#ff7043"></span><span class="wtb-compLabel">⚙️ 工具</span><b>${o.toolMs > 0 ? fmtDur(o.toolMs / 6e4) : "0"}</b><span class="wtb-compPct" style="color:#ff7043">${Math.round(o.toolRatio * 100)}%</span></span>
            </div>
            <div class="wtb-compBar">
              <div class="wtb-compFill" style="width:${Math.max(0, Math.min(100, o.llmRatio * 100))}%;background:#7d9cff"></div>
              <div class="wtb-compFill" style="width:${Math.max(0, Math.min(100, o.toolRatio * 100))}%;background:#ff7043"></div>
            </div>
          </div>
          <div class="wtb-compPair" title="普通时间 vs 修仙时间（22:30–06:30 活动占比）">
            <div class="wtb-compTop">
              <span class="wtb-compName"><span class="wtb-compDot" style="background:#5cd6a8"></span><span class="wtb-compLabel">☀️ 普通时间</span><b>${fmtMin(normalMin)}</b><span class="wtb-compPct" style="color:#5cd6a8">${Math.round((1 - o.xianPct) * 100)}%</span></span>
              <span class="wtb-compName wtb-compName-right"><span class="wtb-compDot" style="background:#b394ec"></span><span class="wtb-compLabel">🌙 修仙时间</span><b>${fmtMin(xianMin)}</b><span class="wtb-compPct" style="color:#b394ec">${Math.round(o.xianPct * 100)}%</span></span>
            </div>
            <div class="wtb-compBar">
              <div class="wtb-compFill" style="width:${Math.max(0, Math.min(100, (1 - o.xianPct) * 100))}%;background:#5cd6a8"></div>
              <div class="wtb-compFill" style="width:${Math.max(0, Math.min(100, o.xianPct * 100))}%;background:#b394ec"></div>
            </div>
          </div>
        </div>
      </div>`;
			}
			/** 积分制评分区：总分数卡 = 大字（周期口径）+ 境界 + 周期切换 + 四维行 + 调侃句；无彩条。 */
			scoreBlockHtml(o, s) {
				const isPeriod = this.tab !== "day";
				const cc = coeffsOf(s);
				const rows = !isPeriod && s.dims !== void 0 ? [
					[
						"时长",
						fmtDur(o.activeMinutes),
						s.dims.minutes
					],
					[
						"招式",
						`${o.calls + o.steps} 次`,
						s.dims.calls + s.dims.steps
					],
					[
						"输入次数",
						`${o.userInputs ?? 0} 次`,
						s.dims.inputs
					],
					[
						"token",
						fmtWan(o.inputTokens + o.outputTokens),
						s.dims.tokens,
						`输入/${cc.inputTokenDiv} + 输出/${cc.outputTokenDiv}`
					]
				] : [];
				const value = s.value;
				const realm = s.realm !== "" ? s.realm : realmOfLocal(value);
				const tier = realmOfLocal(value);
				const digits = String(Math.round(value)).length;
				const numSize = digits >= 9 ? 28 : digits >= 8 ? 34 : 40;
				const now = /* @__PURE__ */ new Date();
				const minutesOfDay = now.getHours() * 60 + now.getMinutes();
				const periodNote = isPeriod ? `最高境界 ${realm}` : "";
				return `
      <div class="wtb-scoreCard">
        <div class="wtb-score"${isPeriod ? "" : " data-realm-toggle title=\"点击查看修仙阶段\""}>
          <span class="wtb-scoreNumWrap">
            <span class="wtb-scoreNumTag">${isPeriod ? "周期修仙值（总值）" : "修仙值"}</span>
            <span class="wtb-scoreNum" style="font-size:${numSize}px">${Math.round(value)}</span>
          </span>
          <span class="wtb-scoreMeta">
            ${isPeriod ? `<span class="wtb-realmPeriodHint">${periodNote}</span>` : `<span class="wtb-scoreTitle" style="${realmStyleCss(realm)}">${realm}</span>`}
          </span>
          ${isPeriod ? "" : `<span class="wtb-scoreChevron">${this.showRealmDetail ? "▾" : "▸"}</span>`}
        </div>
        ${!isPeriod && this.showRealmDetail ? this.realmDetailHtml(value, tier, coeffsOf(s)) : ""}
        ${rows.length > 0 ? `<div class="wtb-dims">
          ${rows.map(([label, actual, pts, hint]) => `<div class="wtb-dim"${label === "招式" ? ` title="调用 ${o.calls} 次 · 步骤 ${o.steps} 步"` : hint !== void 0 ? ` title="token 分 = ${hint}"` : ""}><span class="wtb-dimLabel">${label}</span><span class="wtb-dimActual">${actual} → <b class="wtb-dimPts">${Math.round(pts)}</b></span></div>`).join("")}
        </div>` : ""}
        ${!isPeriod && (s.bonus ?? 0) > 0 ? `<div class="wtb-dimBonus" title="当日按基础分连锁结算：每突破一个境界，送下一境界门槛 × 5% 进度分">💥 突破奖励 <b>+${fmtGate(Math.round(s.bonus ?? 0))}</b> <span class="wtb-dimBonusNote">（突破 ${s.rangeTier ?? 0} 次）</span></div>` : ""}
        ${!isPeriod && (s.growth ?? 1) > 1 ? `<div class="wtb-dimBonus wtb-dimTomato" title="每连续工作 25 分钟，成长系数 +0.1（最终额外乘）">🧘 入定成长 <b>×${(s.growth ?? 1).toFixed(1)}</b> <span class="wtb-dimBonusNote">（${s.segs ?? 0} 段 × 25 分钟）</span></div>` : ""}
        ${!isPeriod ? `<div class="wtb-quip">${quipLine(tier, minutesOfDay, this.tab)}</div>` : ""}
      </div>`;
			}
			/** 修仙阶段详情（评分卡点击展开，仅日视图）：当前值/境界大字 + 12 档境界表（阈值区间，当前高亮）+ 进度 + 公式。 */
			realmDetailHtml(value, tier, coeffs) {
				const rows = REALMS.map((r, i) => {
					const lower = i === 0 ? 0 : REALM_THRESHOLDS[i - 1];
					const upper = i === REALMS.length - 1 ? Infinity : REALM_THRESHOLDS[i] - 1;
					const rangeLabel = i === REALMS.length - 1 ? `${fmtGate(lower)}+` : `${fmtGate(lower)}-${fmtGate(upper)}`;
					return `<div class="wtb-realmRow${r === tier ? " wtb-realmRow-current" : ""}"><span class="wtb-realmName">${r}</span><span class="wtb-realmDigits">${rangeLabel}</span></div>`;
				}).join("");
				let nextIdx = -1;
				for (let i = 0; i < REALM_THRESHOLDS.length; i++) if (value < REALM_THRESHOLDS[i]) {
					nextIdx = i;
					break;
				}
				const nextThreshold = nextIdx === -1 ? 0 : REALM_THRESHOLDS[nextIdx];
				const pct = nextIdx === -1 ? 100 : Math.max(0, Math.min(100, value / nextThreshold * 100));
				const progressHtml = `<div class="wtb-realmProgress">
      <div class="wtb-realmProgressTop">${nextIdx === -1 ? "<span>已至巅峰</span>" : `<span>距${REALMS[nextIdx]}期（${fmtGate(nextThreshold)}）还差 ${fmtGate(Math.max(0, nextThreshold - value))}</span>`}<span class="wtb-realmProgressPct">${pct >= 100 ? "100" : pct.toFixed(1)}%</span></div>
      <div class="wtb-realmProgressBar"><div class="wtb-realmProgressFill" style="width:${pct}%"></div></div>
    </div>`;
				return `
      <div class="wtb-realmDetail">
        <div class="wtb-realmCurrent">当前修仙值 <b>${Math.round(value)}</b> · 境界 <b>${tier}</b></div>
        <div class="wtb-realmTable">${rows}</div>
        ${progressHtml}
        <div class="wtb-realmFormula">公式：修仙值 = 每槽[分钟×${coeffs.minutePerMin} + 调用×${coeffs.callPts} + 步骤（生成+工具循环计一步）×${coeffs.stepPts} + 输入×${coeffs.userInputPts} + token(输入)/${coeffs.inputTokenDiv} + token(输出)/${coeffs.outputTokenDiv}] × 15（展示尺度），修仙时段(22:30–06:30)×1.25；分钟按并行不叠加（并集），调用/步骤/输入/token 按各线程总量</div>
      </div>`;
			}
			threadsHtml(d) {
				if (d === null) return "";
				let rows = [...d.threads];
				if (!this.includeArchived) rows = rows.filter((t) => !t.archived);
				if (this.sortBy === "latest") rows.sort((a, b) => b.lastActiveAt - a.lastActiveAt);
				else rows.sort((a, b) => b.activeMinutes - a.activeMinutes);
				const total = rows.length;
				const visible = this.showAll ? rows : rows.slice(0, 5);
				const archivedCount = d.threads.filter((t) => t.archived).length;
				const hasArchived = archivedCount > 0;
				const sortRowHtml = `<div class="wtb-sortRow">
      ${[["active", "时长↓"], ["latest", "时间↓"]].map(([k, label]) => `<button type="button" class="wtb-sortBtn" data-sort="${k}" data-active="${this.sortBy === k}">${label}</button>`).join("")}
      <span style="flex:1"></span>
      <button type="button" class="wtb-linkBtn" data-archived-toggle title="显示/隐藏已归档会话">${this.includeArchived ? "☑" : "☐"} 含归档(${archivedCount})</button>
    </div>`;
				if (total === 0 && !hasArchived) return `<div class="wtb-sec"><div class="wtb-empty">${this.rangeLabel()}无出勤</div></div>`;
				if (total === 0) return `
        <div class="wtb-sec">
          <div class="wtb-sectionTitle">线程出勤（点击跳转）</div>
          ${sortRowHtml}
          <div class="wtb-empty">${this.rangeLabel()}无出勤${this.includeArchived ? "" : "（归档会话默认隐藏，点「含归档」查看）"}</div>
        </div>`;
				return `
      <div class="wtb-sec">
        <div class="wtb-sectionTitle">线程出勤（点击跳转）</div>
        ${sortRowHtml}
        <div class="wtb-threadHead"><span>线程</span><span>活跃</span><span class="wtb-thc">时长</span><span class="wtb-thc">调用</span><span class="wtb-thc">上次</span></div>
        ${visible.map((t) => this.threadRow(t)).join("")}
        ${!this.showAll && total > 5 ? `<button type="button" class="wtb-linkBtn" data-show-all>显示全部 ${total} 个线程</button>` : this.showAll && total > 5 ? `<button type="button" class="wtb-linkBtn" data-show-all>收起</button>` : ""}
      </div>`;
			}
			/** 周/月聚合行（host v4）：activeDays>1 或 segments 为空 → 不画甘特段。列：线程 | 活跃(甘特条) | 时长 | 调用 | 上次（无汉字），完整信息进 title 悬停。 */
			threadRow(t) {
				const absent = t.activeMinutes === 0;
				const title = escapeHtml(t.title);
				const nameSpan = `<span class="wtb-threadName" data-archived="${t.archived}" title="${title}">${title}</span>`;
				const callsText = t.calls >= 1e4 ? `${fmtWan(t.calls)}次` : `${t.calls}次`;
				const metaTitle = `时长 ${fmtDur(t.activeMinutes)} · 调用 ${t.calls} 次 · 活跃 ${t.activeDays ?? 1} 天 · 最后活动 ${fmtAgo(t.lastActiveAt)}`;
				const cols = (bar, dur, calls, ago) => `
      <span class="wtb-threadBar">${bar}</span>
      <span class="wtb-threadDur" title="${metaTitle}">${dur}</span>
      <span class="wtb-threadCalls" title="${metaTitle}">${calls}</span>
      <span class="wtb-threadAgo" title="${metaTitle}">${ago}</span>`;
				if (absent) return `<div class="wtb-threadRow" data-open="${t.threadId}">
        ${nameSpan}
        ${cols("", "未出勤", "—", "—")}
      </div>`;
				if ((t.activeDays ?? 1) > 1 || t.segments.length === 0) return `<div class="wtb-threadRow" data-open="${t.threadId}">
        ${nameSpan}
        ${cols("", fmtDur(t.activeMinutes), callsText, fmtAgoShort(t.lastActiveAt))}
      </div>`;
				const segs = t.segments.map((s) => {
					return `<span class="wtb-threadSeg" style="left:${s.start / 288 * 100}%;width:${(s.end - s.start) / 288 * 100}%"></span>`;
				}).join("");
				return `<div class="wtb-threadRow" data-open="${t.threadId}">
      ${nameSpan}
      ${cols(segs, fmtDur(t.activeMinutes), callsText, fmtAgoShort(t.lastActiveAt))}
    </div>`;
			}
			heatHtml(d) {
				if (d === null) return "";
				const h = d.heat;
				const kinds = [
					"duration",
					"tokens",
					"realm"
				];
				const labels = {
					duration: "时长",
					tokens: "token",
					realm: "修仙值"
				};
				const switchHtml = `<div class="wtb-heatSwitch">${kinds.map((k) => `<button type="button" class="wtb-heatBtn" data-heat="${k}" data-active="${this.heatKind === k}">${labels[k]}</button>`).join("")}</div>`;
				const tipHtml = "<div class=\"wtb-tip\" role=\"tooltip\" aria-hidden=\"true\"></div>";
				if (h.kind === "day") {
					const hourVal = [];
					for (let hour = 0; hour < 24; hour++) {
						let active = 0, calls = 0, tokens = 0, input = 0, realm = 0;
						for (let s = hour * 12; s < hour * 12 + 12; s++) {
							if ((h.heatSlots[s] ?? 0) > 0) active++;
							calls += h.heatCalls?.[s] ?? 0;
							tokens += h.heatTokens?.[s] ?? 0;
							input += h.heatInput?.[s] ?? 0;
							realm += h.heatRealm?.[s] ?? 0;
						}
						hourVal.push({
							v: active,
							xian: hour >= 22 || hour <= 6,
							calls,
							tokens,
							input,
							realm
						});
					}
					const valueOf = (x) => {
						if (this.heatKind === "tokens") return x.input + x.tokens;
						if (this.heatKind === "realm") return x.realm;
						return x.v;
					};
					const maxOf = Math.max(1, ...hourVal.map(valueOf));
					const fmtV = (k, v) => {
						if (k === "duration") return fmtDur(Math.round(v * 5));
						if (k === "tokens") return fmtWan(v);
						return fmtGate(Math.round(v));
					};
					const totalV = hourVal.reduce((s, x) => s + valueOf(x), 0);
					let peakHour = 0;
					let peakV = 0;
					hourVal.forEach((x, hour) => {
						const v = valueOf(x);
						if (v > peakV) {
							peakV = v;
							peakHour = hour;
						}
					});
					const statsHtml = `<div class="wtb-heatStats"><span>总量 <b>${fmtV(this.heatKind, totalV)}</b></span><span>峰值 <b>${fmtV(this.heatKind, peakV)}</b> @ ${String(peakHour).padStart(2, "0")}:00</span></div>`;
					const cols = hourVal.map((x, hour) => {
						const pct = Math.max(3, Math.round(valueOf(x) / maxOf * 100));
						const range = `${String(hour).padStart(2, "0")}:00–${String(hour).padStart(2, "0")}:59`;
						const rows = [];
						if (x.v > 0) rows.push({
							label: "时长",
							text: `${x.v * 5} 分钟`,
							color: TIP_COLORS.duration
						});
						if (x.calls > 0) rows.push({
							label: "调用",
							text: `${x.calls} 次`,
							color: TIP_COLORS.calls
						});
						if (x.input > 0) rows.push({
							label: "输入 token",
							text: fmtWan(x.input),
							color: TIP_COLORS.tokens
						});
						if (x.tokens > 0) rows.push({
							label: "输出 token",
							text: fmtWan(x.tokens),
							color: TIP_COLORS.tokens
						});
						if (x.realm > 0) rows.push({
							label: "修仙值",
							text: fmtGate(Math.round(x.realm)),
							color: TIP_COLORS.realm
						});
						const tip = tipCardHtml(range, rows);
						const realmAttr = this.heatKind === "realm" ? ` data-realm="${x.realm > 0}"` : "";
						return `<span class="wtb-heatCol" data-xian="${x.xian}"${realmAttr} data-tip="${tip.replace(/"/g, "&quot;")}" style="height:${pct}%"></span>`;
					}).join("");
					return `
        <div class="wtb-sec">
          <div class="wtb-sectionTitle">${this.rangeLabel()}热力（24 小时 · 悬停看详情）</div>
          <div class="wtb-heat">
            ${switchHtml}
            ${statsHtml}
            <div class="wtb-heatBar">${cols}</div>
            ${tipHtml}
            <div class="wtb-heatAxis"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span></div>
          </div>
        </div>`;
				}
				const days = h.days;
				if (days.length === 0) return `<div class="wtb-sec"><div class="wtb-sectionTitle">${this.rangeLabel()}热力</div><div class="wtb-empty">该时段无出勤</div></div>`;
				if (this.tab === "month") return this.monthWeeksHtml(days, switchHtml, tipHtml) + this.yearCalendarHtml(h.year);
				const dayVal = (x) => {
					if (this.heatKind === "tokens") return (x.inputTokens ?? 0) + x.tokens;
					if (this.heatKind === "realm") return x.realm ?? 0;
					return x.activeMinutes;
				};
				const maxOf = Math.max(1, ...days.map(dayVal));
				const fmtD = (k, v) => {
					if (k === "duration") return fmtDur(Math.round(v));
					if (k === "tokens") return fmtWan(v);
					return fmtGate(Math.round(v));
				};
				const totalD = days.reduce((s, x) => s + dayVal(x), 0);
				let peakDay = days[0];
				let peakDV = 0;
				days.forEach((x) => {
					const v = dayVal(x);
					if (v > peakDV) {
						peakDV = v;
						peakDay = x;
					}
				});
				const statsHtml = `<div class="wtb-heatStats"><span>总量 <b>${fmtD(this.heatKind, totalD)}</b></span><span>峰值 <b>${fmtD(this.heatKind, peakDV)}</b> @ ${peakDay?.day.slice(5) ?? ""}</span></div>`;
				const cols = days.map((x) => {
					const empty = x.activeMinutes === 0;
					const pct = empty ? 2 : Math.max(3, Math.round(dayVal(x) / maxOf * 100));
					const rows = [];
					if (x.activeMinutes > 0) rows.push({
						label: "时长",
						text: fmtDur(x.activeMinutes),
						color: TIP_COLORS.duration
					});
					if (x.calls > 0) rows.push({
						label: "调用",
						text: `${x.calls} 次`,
						color: TIP_COLORS.calls
					});
					if ((x.inputTokens ?? 0) + x.tokens > 0) rows.push({
						label: "token",
						text: fmtWan((x.inputTokens ?? 0) + x.tokens),
						color: TIP_COLORS.tokens
					});
					if ((x.realm ?? 0) > 0) rows.push({
						label: "修仙值",
						text: fmtGate(Math.round(x.realm ?? 0)),
						color: TIP_COLORS.realm
					});
					if (x.xianPct > 0) rows.push({
						label: "修仙占比",
						text: `${Math.round(x.xianPct * 100)}%`,
						color: TIP_COLORS.xian
					});
					const tip = tipCardHtml(x.day.slice(5), rows);
					const realmAttr = this.heatKind === "realm" ? ` data-realm="${!empty}"` : "";
					const valLabel = empty ? "" : `<b class="wtb-heatColVal">${fmtD(this.heatKind, dayVal(x))}</b>`;
					return `<span class="wtb-heatCol${empty ? " wtb-heatCol-empty" : ""}" data-xian="${x.xianPct >= .5}"${realmAttr} data-tip="${tip.replace(/"/g, "&quot;")}" style="height:${pct}%">${valLabel}</span>`;
				}).join("");
				return `
      <div class="wtb-sec">
        <div class="wtb-sectionTitle">${this.rangeLabel()}热力（每天 · 悬停看详情）</div>
        <div class="wtb-heat">
          ${switchHtml}
          ${statsHtml}
          <div class="wtb-heatBar">${cols}</div>
          ${tipHtml}
          <div class="wtb-heatAxis"><span>${days[0]?.day.slice(5) ?? ""}</span><span>${days[Math.floor(days.length / 2)]?.day.slice(5) ?? ""}</span><span>${days[days.length - 1]?.day.slice(5) ?? ""}</span></div>
        </div>
      </div>`;
			}
			/** 月视图热力：heat.days（按天）→ 按自然周（周一起始）聚合为每周一柱。 */
			monthWeeksHtml(days, switchHtml, tipHtml) {
				const sorted = [...days].sort((a, b) => a.day.localeCompare(b.day));
				const byWeek = /* @__PURE__ */ new Map();
				for (const x of sorted) {
					const key = weekStartKey(x.day);
					const agg = byWeek.get(key) ?? {
						activeMinutes: 0,
						calls: 0,
						tokens: 0,
						inputTokens: 0,
						realm: 0,
						xianWeighted: 0
					};
					agg.activeMinutes += x.activeMinutes;
					agg.calls += x.calls;
					agg.tokens += x.tokens;
					agg.inputTokens += x.inputTokens ?? 0;
					agg.realm += x.realm ?? 0;
					agg.xianWeighted += x.activeMinutes * x.xianPct;
					byWeek.set(key, agg);
				}
				const weeks = [];
				let cur = weekStartKey(sorted[0].day);
				const last = weekStartKey(sorted[sorted.length - 1].day);
				while (cur <= last) {
					const agg = byWeek.get(cur);
					const total = agg?.activeMinutes ?? 0;
					weeks.push({
						start: cur,
						end: addDaysKey(cur, 6),
						activeMinutes: agg?.activeMinutes ?? 0,
						calls: agg?.calls ?? 0,
						tokens: agg?.tokens ?? 0,
						inputTokens: agg?.inputTokens ?? 0,
						realm: agg?.realm ?? 0,
						xianPct: total === 0 ? 0 : (agg?.xianWeighted ?? 0) / total,
						empty: agg === void 0
					});
					cur = addDaysKey(cur, 7);
				}
				const weekVal = (w) => {
					if (this.heatKind === "tokens") return w.inputTokens + w.tokens;
					if (this.heatKind === "realm") return w.realm;
					return w.activeMinutes;
				};
				const fmtW = (k, v) => {
					if (k === "duration") return fmtDur(Math.round(v));
					if (k === "tokens") return fmtWan(v);
					return fmtGate(Math.round(v));
				};
				const maxOf = Math.max(1, ...weeks.map(weekVal));
				const cols = weeks.map((w) => {
					const pct = w.empty ? 2 : Math.max(3, Math.round(weekVal(w) / maxOf * 100));
					const range = `${w.start.slice(5)}~${w.end.slice(5)}`;
					const rows = [];
					if (!w.empty) {
						if (w.activeMinutes > 0) rows.push({
							label: "时长",
							text: fmtDur(w.activeMinutes),
							color: TIP_COLORS.duration
						});
						if (w.calls > 0) rows.push({
							label: "调用",
							text: `${w.calls} 次`,
							color: TIP_COLORS.calls
						});
						if (w.inputTokens + w.tokens > 0) rows.push({
							label: "token",
							text: fmtWan(w.inputTokens + w.tokens),
							color: TIP_COLORS.tokens
						});
						if (w.realm > 0) rows.push({
							label: "修仙值",
							text: fmtGate(Math.round(w.realm)),
							color: TIP_COLORS.realm
						});
						if (w.xianPct > 0) rows.push({
							label: "修仙占比",
							text: `${Math.round(w.xianPct * 100)}%`,
							color: TIP_COLORS.xian
						});
					}
					const tip = tipCardHtml(range, rows);
					const realmAttr = this.heatKind === "realm" ? ` data-realm="${!w.empty}"` : "";
					const valLabel = w.empty ? "" : `<b class="wtb-heatColVal">${fmtW(this.heatKind, weekVal(w))}</b>`;
					return `<span class="wtb-heatCol${w.empty ? " wtb-heatCol-empty" : ""}" ${w.empty ? "" : `data-xian="${w.xianPct >= .5}"`}${realmAttr} data-tip="${tip.replace(/"/g, "&quot;")}" style="height:${pct}%">${valLabel}</span>`;
				}).join("");
				const totalW = weeks.reduce((s, w) => s + weekVal(w), 0);
				let peakW = weeks[0];
				let peakWV = 0;
				weeks.forEach((w) => {
					const v = weekVal(w);
					if (v > peakWV) {
						peakWV = v;
						peakW = w;
					}
				});
				const statsHtml = `<div class="wtb-heatStats"><span>总量 <b>${fmtW(this.heatKind, totalW)}</b></span><span>峰值 <b>${fmtW(this.heatKind, peakWV)}</b> @ ${peakW?.start.slice(5) ?? ""}</span></div>`;
				const axis = weeks.length === 0 ? "<span></span>" : `<span>${weeks[0].start.slice(5)}</span><span>${weeks[Math.floor(weeks.length / 2)].start.slice(5)}</span><span>${weeks[weeks.length - 1].start.slice(5)}</span>`;
				return `
      <div class="wtb-sec">
        <div class="wtb-sectionTitle">${this.rangeLabel()}热力（按周聚合 · 悬停看详情）</div>
        <div class="wtb-heat">
          ${switchHtml}
          ${statsHtml}
          <div class="wtb-heatBar">${cols}</div>
          ${tipHtml}
          <div class="wtb-heatAxis">${axis}</div>
        </div>
      </div>`;
			}
			/** 年历（GitHub 贡献风格，月视图下方附）：近 365 天按自然月分列，每日一格，绝对阈值分档色（0/1万/5万/15万/40万+）。 */
			yearCalendarHtml(year) {
				if (year === void 0 || year.length === 0) return "";
				const tier = tierOfRealm;
				const TIER_COLORS = YEAR_TIER_COLORS;
				if (year.length === 0) return "";
				const byDay = new Map(year.map((d) => [d.day, d]));
				const nowY = (/* @__PURE__ */ new Date()).getFullYear();
				const firstDay = year[0].day;
				const lastDay = year[year.length - 1].day;
				const startY = Number(firstDay.slice(0, 4));
				const startM = Number(firstDay.slice(5, 7)) - 1;
				const endY = Number(lastDay.slice(0, 4));
				const endM = Number(lastDay.slice(5, 7)) - 1;
				const months = [];
				let cur = new Date(startY, startM, 1);
				const end = new Date(endY, endM, 1);
				while (cur <= end) {
					const y = cur.getFullYear();
					const m = cur.getMonth();
					const key = `${y}-${String(m + 1).padStart(2, "0")}`;
					const label = y === nowY ? `${m + 1}月` : `${String(y).slice(2)}年${m + 1}月`;
					const daysInMonth = new Date(y, m + 1, 0).getDate();
					const firstDow = (new Date(y, m, 1).getDay() + 6) % 7;
					const grid = [];
					for (let i = 0; i < firstDow; i++) grid.push("<span class=\"wtb-yearCell wtb-yearCell-void\"></span>");
					for (let d = 1; d <= daysInMonth; d++) {
						const dayKey = `${key}-${String(d).padStart(2, "0")}`;
						const rec = byDay.get(dayKey);
						const realm = rec?.realm ?? 0;
						const t = tier(realm);
						const title = `${dayKey.slice(5)} · 修仙值 ${fmtGate(Math.round(realm))}`;
						grid.push(`<span class="wtb-yearCell${rec === void 0 ? " wtb-yearCell-future" : ""}" style="background:${TIER_COLORS[t]}" data-year-day="${dayKey}" title="${title}"></span>`);
					}
					months.push({
						key,
						label,
						cells: grid.join("")
					});
					cur = new Date(y, m + 1, 1);
				}
				const monthHtml = months.map((m) => `
      <div class="wtb-yearMonth">
        <div class="wtb-yearMonthLabel">${m.label}</div>
        <div class="wtb-yearMonthGrid">${m.cells}</div>
      </div>`).join("");
				const legend = TIER_COLORS.map((c, i) => `<span class="wtb-yearLegendItem"><span class="wtb-yearCell" style="background:${c}"></span>${i === 0 ? "无" : i === 1 ? "<1万" : i === 2 ? "<5万" : i === 3 ? "<15万" : i === 4 ? "<40万" : "≥40万"}</span>`).join("");
				return `
      <div class="wtb-sec">
        <div class="wtb-sectionTitle">年历（${fmtShortRange(year[0].day, year[year.length - 1].day)} · 点击某天看数值 · 绝对阈值分档）</div>
        <div class="wtb-year">
          <div class="wtb-yearMonths">${monthHtml}</div>
          <div class="wtb-yearDetail" data-year-detail></div>
          <div class="wtb-yearLegend">${legend}</div>
        </div>
      </div>`;
			}
			boardHtml(d) {
				if (d === null) return "";
				const pool = [...d.threads];
				const maxActive = Math.max(0, ...pool.map((t) => t.activeMinutes));
				const maxCalls = Math.max(0, ...pool.map((t) => t.calls));
				const scoreOf = (t) => {
					const dur = maxActive > 0 ? t.activeMinutes / maxActive : 0;
					const call = maxCalls > 0 ? t.calls / maxCalls : 0;
					return 100 * (.4 * dur + .6 * call);
				};
				const top = pool.map((t) => ({
					t,
					score: scoreOf(t)
				})).sort((a, b) => b.score - a.score).slice(0, 3);
				if (top.length === 0) return "";
				return `<div class="wtb-sec"><div class="wtb-sectionTitle">${this.rangeLabel()}卷王榜（卷王分 TOP3）</div>
      <div class="wtb-boardHead"><span class="wtb-boardHeadRank">名次</span><span>线程</span><span class="wtb-thc">分</span><span class="wtb-thc">时长</span><span class="wtb-thc">调用</span></div>` + top.map(({ t, score }, i) => `
      <div class="wtb-board">
        <span class="wtb-boardRank">${i === 0 ? "👑" : i === 1 ? "🥈" : "🥉"}</span>
        <span class="wtb-boardName">${escapeHtml(t.title)}</span>
        <span class="wtb-boardScore">${Math.round(score)}</span>
        <span class="wtb-boardDur">${fmtDur(t.activeMinutes)}</span>
        <span class="wtb-boardCalls">${t.calls >= 1e4 ? fmtWan(t.calls) : t.calls}次</span>
      </div>`).join("") + "</div>";
			}
			/** 反馈 5+8：所有说明文字统一收到底部说明区（正文区不放说明）。13：emoji + 彩色分类。A'：评分基准说明。 */
			notesHtml(d) {
				if (d === null) return "";
				const c = coeffsOf(d.score);
				return `
      <div class="wtb-sec">
        <div class="wtb-notes">
          <div class="wtb-sectionTitle">说明</div>
          <div class="wtb-noteItem"><span class="wtb-noteK wtb-noteK-blue">🧘 修仙值</span> = 每槽[分钟×${c.minutePerMin} + 调用×${c.callPts} + 步骤（生成+工具循环计一步）×${c.stepPts} + 输入×${c.userInputPts} + token(输入)/${c.inputTokenDiv} + token(输出)/${c.outputTokenDiv}] × 15（展示尺度），修仙时段(22:30–06:30)×1.25，无上限（分钟按并行不叠加、调用/步骤/输入/token 按总量）；境界按修仙值阈值（30 万起、最高 999 万）：炼气/筑基/金丹/元婴/化神/炼虚/合体/大乘/渡劫/真仙/金仙/宇宙洪荒</div>
          <div class="wtb-noteItem wtb-noteSub"><span class="wtb-noteK wtb-noteK-gold">💥 突破奖励</span> = 每个统计周期按该周期基础分独立结算：每突破一个境界，送「下一境界门槛 × ${Math.round(c.breakthroughPct * 100)}%」进度分（累计，随周期分数变化）</div>
          <div class="wtb-noteItem wtb-noteSub"><span class="wtb-noteK wtb-noteK-green">🧘 入定成长</span> = 每连续工作 25 分钟（允许中间断 1 个 5 分钟槽），成长系数 +${c.tomatoGrowthPerSeg}（最终修仙值额外乘）</div>
          <div class="wtb-noteItem"><span class="wtb-noteK wtb-noteK-green">🧠 思考</span> = 模型生成耗时，<span class="wtb-noteK wtb-noteK-orange">⚙️ 工具</span> = 工具运行耗时；思考+工具按各线程并行累加，多线程并行时可大于实际时长（普通/修仙为时间并集）</div>
          <div class="wtb-noteItem"><span class="wtb-noteK wtb-noteK-purple">🌙 修仙时段</span> = 22:30–06:30 的活动占比</div>
          <div class="wtb-noteItem"><span class="wtb-noteK wtb-noteK-red">🔥 热力</span>：柱高 = 所选指标（时长 / token / 修仙值）；紫 = 修仙（日：22:30–06:30 时段；周：该日修仙过半；月：该周修仙过半），绿 = 正常，金 = 修仙值维度；月视图按自然周（周一起始）聚合</div>
          <div class="wtb-noteItem"><span class="wtb-noteK">🔗 线程</span>：点击行可跳转会话；默认不含归档会话</div>
          <div class="wtb-noteItem"><span class="wtb-noteK wtb-noteK-gold">🏆 卷王分</span> = 100 × (0.4 × 修行时长/榜内最长 + 0.6 × 调用/榜内最多)，榜内归一取 TOP3（含归档线程），满分 100 代表该周期内时长与调用双榜首</div>
        </div>
      </div>`;
			}
			backfillHtml(d) {
				if (d === null || d.backfill?.complete === true) return "";
				return `<div style="font-size:11px;color:#9a9a9a;text-align:center">🐂 历史数据整理中 ${d.backfill.done}/${d.backfill.total}…（限速进行，不打扰工作）</div>`;
			}
			bindPanel() {
				const root = this.host.querySelector(".wtb-panel");
				if (root === null) return;
				root.querySelector(".wtb-close")?.addEventListener("click", () => {
					this.open = false;
					this.calOpen = false;
					this.detachCalDocHandler();
					this.reschedule();
					this.render();
				});
				root.querySelectorAll(".wtb-tab").forEach((el) => {
					el.addEventListener("click", () => {
						const next = el.getAttribute("data-tab");
						if (next === this.tab && this.data !== null) return;
						this.tab = next;
						this.viewDate = null;
						this.calOpen = false;
						this.detachCalDocHandler();
						this.data = null;
						this.tick(true);
						this.render();
					});
				});
				root.querySelector("[data-cal-toggle]")?.addEventListener("click", () => {
					this.calOpen = !this.calOpen;
					if (this.calOpen) this.calMonth = (this.viewDate ?? this.todayKey()).slice(0, 7);
					else this.detachCalDocHandler();
					this.render();
				});
				root.querySelector("[data-cal-prev]")?.addEventListener("click", (e) => {
					e.stopPropagation();
					const [y, m] = this.calMonth.split("-").map(Number);
					this.calMonth = `${y}-${String(m - 1 === 0 ? 12 : m - 1).padStart(2, "0")}`;
					if (m === 1) this.calMonth = `${y - 1}-12`;
					this.render();
				});
				root.querySelector("[data-cal-next]")?.addEventListener("click", (e) => {
					e.stopPropagation();
					const [y, m] = this.calMonth.split("-").map(Number);
					this.calMonth = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
					this.render();
				});
				root.querySelectorAll("[data-cal-day]").forEach((el) => {
					el.addEventListener("click", () => {
						const v = el.getAttribute("data-cal-day") ?? "";
						this.viewDate = v !== this.todayKey() ? v : null;
						this.calOpen = false;
						this.detachCalDocHandler();
						this.data = null;
						this.tick(true);
						this.render();
					});
				});
				if (this.calOpen && this.calDocHandler === null) {
					this.calDocHandler = (e) => {
						if (e.target.closest(".wtb-calendar, .wtb-dateBtn") !== null) return;
						document.removeEventListener("click", this.calDocHandler);
						this.calDocHandler = null;
						this.calOpen = false;
						this.render();
					};
					setTimeout(() => document.addEventListener("click", this.calDocHandler), 0);
				}
				root.querySelector("[data-back-today]")?.addEventListener("click", () => {
					this.viewDate = null;
					this.calOpen = false;
					this.detachCalDocHandler();
					this.data = null;
					this.tick(true);
					this.render();
				});
				root.querySelectorAll(".wtb-heatBtn").forEach((el) => {
					el.addEventListener("click", () => {
						this.heatKind = el.getAttribute("data-heat");
						this.render();
					});
				});
				root.querySelector("[data-input-toggle]")?.addEventListener("click", () => {
					this.inputHuman = !this.inputHuman;
					this.render();
				});
				root.querySelector(".wtb-year")?.addEventListener("click", (e) => {
					const cell = e.target.closest?.(".wtb-yearCell[data-year-day]");
					if (cell === null) return;
					const day = cell.getAttribute("data-year-day") ?? "";
					const detail = root.querySelector("[data-year-detail]");
					if (detail === null) return;
					const rec = ((this.data?.heat)?.year)?.find((d) => d.day === day);
					if (rec === void 0) {
						detail.innerHTML = `<div class="wtb-yearDetailEmpty">${day.slice(5)} 无数据</div>`;
						return;
					}
					const realm = rec.realm ?? 0;
					const ridx = realmIdxOf(realm);
					detail.innerHTML = `
        <div class="wtb-yearDetailHead">
          <span class="wtb-yearDetailDay">${day} · 周${[
						"日",
						"一",
						"二",
						"三",
						"四",
						"五",
						"六"
					][(/* @__PURE__ */ new Date(day + "T00:00:00")).getDay()]}</span>
          <span class="wtb-yearDetailTier"><span class="wtb-yearDot" style="background:${REALM_STYLE[ridx].color}"></span>${REALMS[ridx]}</span>
        </div>
        <div class="wtb-yearDetailStats">
          <div class="wtb-yearStat"><span class="wtb-yearStatLabel">🧘 修仙值</span><b>${fmtGate(Math.round(realm))}</b></div>
          <div class="wtb-yearStat"><span class="wtb-yearStatLabel">🕐 时长</span><b>${fmtDur(rec.activeMinutes)}</b></div>
          <div class="wtb-yearStat"><span class="wtb-yearStatLabel">🛠️ 调用</span><b>${rec.calls} 次</b></div>
          <div class="wtb-yearStat"><span class="wtb-yearStatLabel">📤 Token</span><b>${fmtWan((rec.inputTokens ?? 0) + rec.tokens)}</b></div>
          <div class="wtb-yearStat"><span class="wtb-yearStatLabel">🌙 修仙时段</span><b>${Math.round(rec.xianPct * 100)}%</b></div>
        </div>`;
				});
				root.querySelectorAll(".wtb-heat").forEach((heat) => {
					const tip = heat.querySelector(".wtb-tip");
					const bar = heat.querySelector(".wtb-heatBar");
					if (tip === null || bar === null) return;
					const place = (html, clientX, clientY) => {
						tip.innerHTML = html;
						tip.classList.add("wtb-tip-show");
						const rect = heat.getBoundingClientRect();
						const tw = tip.offsetWidth;
						const th = tip.offsetHeight;
						let x = clientX - rect.left + 12;
						let y = clientY - rect.top - th - 10;
						if (y < 4) y = clientY - rect.top + 14;
						x = Math.max(4, Math.min(x, Math.max(4, rect.width - tw - 4)));
						y = Math.min(y, Math.max(4, rect.height - th - 4));
						tip.style.left = `${x}px`;
						tip.style.top = `${y}px`;
					};
					bar.addEventListener("mouseover", (e) => {
						const text = e.target.closest?.(".wtb-heatCol")?.getAttribute("data-tip") ?? "";
						if (text !== "") place(text, e.clientX, e.clientY);
					});
					bar.addEventListener("mousemove", (e) => {
						if (!tip.classList.contains("wtb-tip-show")) return;
						const text = e.target.closest?.(".wtb-heatCol")?.getAttribute("data-tip") ?? "";
						if (text !== "") place(text, e.clientX, e.clientY);
					});
					bar.addEventListener("mouseleave", () => tip.classList.remove("wtb-tip-show"));
				});
				root.querySelector("[data-realm-toggle]")?.addEventListener("click", () => {
					this.showRealmDetail = !this.showRealmDetail;
					this.render();
				});
				root.querySelectorAll(".wtb-sortBtn").forEach((el) => {
					el.addEventListener("click", () => {
						this.sortBy = el.getAttribute("data-sort");
						this.render();
					});
				});
				root.querySelector("[data-archived-toggle]")?.addEventListener("click", () => {
					this.includeArchived = !this.includeArchived;
					this.render();
				});
				root.querySelector("[data-show-all]")?.addEventListener("click", () => {
					this.showAll = !this.showAll;
					this.render();
				});
				root.querySelectorAll(".wtb-threadRow").forEach((el) => {
					el.addEventListener("click", () => {
						const id = el.getAttribute("data-open");
						if (id !== null) this.ctx.sessions.open(id);
					});
				});
				const head = root.querySelector(".wtb-head");
				if (head !== null) head.addEventListener("pointerdown", (e) => {
					if (e.target.closest(".wtb-tab, .wtb-close, .wtb-dateBtn, .wtb-calendar, .wtb-today") !== null) return;
					const startX = e.clientX;
					const startY = e.clientY;
					const rect = root.getBoundingClientRect();
					const startLeft = rect.left;
					const startTop = rect.top;
					const move = (ev) => {
						root.style.left = `${startLeft + ev.clientX - startX}px`;
						root.style.top = `${startTop + ev.clientY - startY}px`;
						root.style.right = "auto";
						root.style.bottom = "auto";
					};
					const up = () => {
						window.removeEventListener("pointermove", move);
						window.removeEventListener("pointerup", up);
						this.pos = {
							x: root.offsetLeft,
							y: root.offsetTop
						};
						try {
							localStorage.setItem(POS_KEY, JSON.stringify(this.pos));
						} catch {}
					};
					window.addEventListener("pointermove", move);
					window.addEventListener("pointerup", up);
				});
				const resize = root.querySelector(".wtb-resize");
				if (resize !== null) resize.addEventListener("pointerdown", (e) => {
					e.preventDefault();
					const startY = e.clientY;
					const startH = root.offsetHeight;
					const move = (ev) => {
						const h = Math.min(Math.max(startH + ev.clientY - startY, 220), window.innerHeight - 24);
						this.height = h;
						root.style.height = `${h}px`;
					};
					const up = () => {
						window.removeEventListener("pointermove", move);
						window.removeEventListener("pointerup", up);
						const p = this.pos;
						try {
							localStorage.setItem(POS_KEY, JSON.stringify({
								x: p?.x ?? null,
								y: p?.y ?? null,
								h: this.height
							}));
						} catch {}
					};
					window.addEventListener("pointermove", move);
					window.addEventListener("pointerup", up);
				});
			}
		};
		/** 年历绝对阈值分档（用户定稿）：0 灰 / <1万 淡 / <5万 次 / <15万 中 / <40万 深 / ≥40万 金。 */
		const YEAR_TIER_COLORS = [
			"rgba(255,255,255,.06)",
			"rgba(125,156,255,.28)",
			"rgba(125,156,255,.55)",
			"rgba(255,179,71,.6)",
			"rgba(255,179,71,.85)",
			"rgba(255,215,109,1)"
		];
		function tierOfRealm(v) {
			if (v <= 0) return 0;
			if (v < 1e4) return 1;
			if (v < 5e4) return 2;
			if (v < 15e4) return 3;
			if (v < 4e5) return 4;
			return 5;
		}
		//#endregion
		exports.apply = apply;
		exports.escapeHtml = escapeHtml;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map