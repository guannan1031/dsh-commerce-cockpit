/**
 * @ekzc/dsh-commerce-cockpit — host half (persistent)
 *
 * Runs inside the `web` profile as a normal Cordis plugin. Owns:
 *   - the deterministic mock ecommerce engine (channels x 30 days + SKU stock),
 *   - JSON API routes under /cockpit/api/* (dashboard, p2, actions, brief,
 *     snapshot, config, import-csv, export-template) served by webServer,
 *   - the model-visible `cockpit_ask` tool (natural-language Q&A),
 *   - CSV override layer + persisted config in the workspace data/ dir.
 *
 * Branding (title/favicon/theme-color) is owned by @ekzc/dsh-whale-skin;
 * this plugin intentionally does not tap index.html. The client half
 * (client.js) provides the cockpit view, dock, sidebar entry and blue theme.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineTool } from "@deepseek-ai/dsh-tools";

const PLUGIN_DIR = dirname(fileURLToPath(import.meta.url));
const WORKSPACE = "/Users/ekzc/AI_Workspace/dsh-commerce-plugin";
const DATA_DIR = join(WORKSPACE, "data");
const CONFIG_PATH = join(DATA_DIR, "cockpit-config.json");
const TEMPLATE_PATH = join(DATA_DIR, "daily_sales.csv");

// ── deterministic mock engine ───────────────────────────────────────────────
function mulberry32(seed) {
	let a = seed >>> 0;
	return function () {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
const rand = mulberry32(20260815);
const CHANNELS = [
	{ name: "天猫旗舰店", visitors: 12000, conv: 3.6, aov: 158, spend: 6200, costRate: 0.44, platFee: 0.06 },
	{ name: "京东自营", visitors: 5200, conv: 2.9, aov: 146, spend: 2400, costRate: 0.41, platFee: 0.05 },
	{ name: "拼多多旗舰店", visitors: 8600, conv: 4.1, aov: 112, spend: 3800, costRate: 0.46, platFee: 0.055 },
	{ name: "抖音小店", visitors: 6900, conv: 2.4, aov: 128, spend: 5200, costRate: 0.43, platFee: 0.06 },
];
const SKUS = [
	{ name: "冷萃咖啡液 30条装", safe: 120, stock: 486 },
	{ name: "冻干拿铁 12杯装", safe: 90, stock: 64 },
	{ name: "生椰拿铁 18杯装", safe: 150, stock: 41 },
	{ name: "精品挂耳 20包", safe: 80, stock: 95 },
	{ name: "低因咖啡豆 500g", safe: 60, stock: 33 },
	{ name: "燕麦拿铁 10杯装", safe: 100, stock: 210 },
	{ name: "冰滴咖啡液 10条", safe: 70, stock: 18 },
	{ name: "美式浓缩液 20条", safe: 140, stock: 520 },
	{ name: "礼盒装 经典4合1", safe: 40, stock: 12 },
	{ name: "随身咖啡杯", safe: 50, stock: 260 },
	{ name: "奶泡器", safe: 30, stock: 88 },
	{ name: "咖啡滤纸 100张", safe: 200, stock: 640 },
];
const DAYS = 30;
function dateLabel(i) {
	if (i < 15) return "07-" + String(17 + i);
	return "08-" + String(i - 14).padStart(2, "0");
}
const daily = [];
for (let i = 0; i < DAYS; i++) {
	const day = [];
	for (let c = 0; c < CHANNELS.length; c++) {
		const base = CHANNELS[c];
		let visitors = Math.round(base.visitors * (0.92 + rand() * 0.16));
		let conv = base.conv * (0.94 + rand() * 0.1);
		let aov = base.aov * (0.96 + rand() * 0.08);
		let spend = Math.round(base.spend * (0.85 + rand() * 0.3));
		if (i === DAYS - 1) {
			if (c === 0) { visitors = Math.round(visitors * 0.955); conv = conv * 0.97; }
			if (c === 1) { visitors = Math.round(visitors * 1.08); }
			if (c === 3) { spend = Math.round(spend * 1.25); visitors = Math.round(visitors * 1.03); }
		}
		day.push({ visitors, conv, aov, spend });
	}
	daily.push(day);
}

// ── config + CSV override (real fs, persists across restarts) ───────────────
let config = { dataSource: "mock", csvPath: TEMPLATE_PATH, roiThreshold: 1.5, storeName: "星辰优选 · 咖啡事业部" };
let csvOverride = null; // { 'MM-DD': { 渠道名: {visitors, conv, aov, spend} } }

function loadConfig() {
	try {
		if (existsSync(CONFIG_PATH)) {
			const parsed = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
			if (parsed && typeof parsed === "object") config = { ...config, ...parsed };
		}
	} catch (_e) { /* first run */ }
}
function saveConfig() {
	try {
		mkdirSync(DATA_DIR, { recursive: true });
		writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
		return { saved: true };
	} catch (e) {
		return { saved: false, reason: String(e && e.message || e) };
	}
}
function parseCsv(text) {
	const rows = [];
	let row = [], field = "", inQ = false;
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (inQ) {
			if (ch === '"') {
				if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false;
			} else field += ch;
		} else if (ch === '"') inQ = true;
		else if (ch === ",") { row.push(field); field = ""; }
		else if (ch === "\n" || ch === "\r") {
			if (ch === "\r" && text[i + 1] === "\n") i++;
			row.push(field); field = "";
			if (row.some((f) => f.trim() !== "")) rows.push(row);
			row = [];
		} else field += ch;
	}
	if (field !== "" || row.length > 0) {
		row.push(field);
		if (row.some((f) => f.trim() !== "")) rows.push(row);
	}
	return rows;
}
function buildOverrideFromCsv(text) {
	const rows = parseCsv(text);
	if (rows.length < 2) return null;
	const header = rows[0].map((h) => h.trim());
	const idx = {
		date: header.indexOf("date"),
		channel: header.indexOf("channel"),
		visitors: header.indexOf("visitors"),
		conv: header.indexOf("conv"),
		aov: header.indexOf("aov"),
		spend: header.indexOf("spend"),
	};
	if (idx.date < 0 || idx.channel < 0 || idx.visitors < 0 || idx.conv < 0 || idx.aov < 0) return null;
	const override = {};
	for (let r = 1; r < rows.length; r++) {
		const row = rows[r];
		const date = (row[idx.date] || "").trim();
		const channel = (row[idx.channel] || "").trim();
		if (!date || !CHANNELS.some((c) => c.name === channel)) continue;
		const num = (k) => { const v = parseFloat(row[idx[k]]); return Number.isFinite(v) ? v : NaN; };
		const visitors = Math.round(num("visitors"));
		const conv = num("conv");
		const aov = num("aov");
		if (!Number.isFinite(visitors) || !Number.isFinite(conv) || !Number.isFinite(aov) || visitors <= 0 || conv <= 0 || aov <= 0) continue;
		if (!override[date]) override[date] = {};
		override[date][channel] = { visitors, conv, aov, spend: Number.isFinite(num("spend")) ? Math.round(num("spend")) : 0 };
	}
	return Object.keys(override).length > 0 ? override : null;
}
function loadCsvOverride() {
	csvOverride = null;
	if (config.dataSource === "csv") {
		try {
			if (existsSync(config.csvPath)) csvOverride = buildOverrideFromCsv(readFileSync(config.csvPath, "utf8"));
		} catch (_e) { /* keep mock */ }
	}
}
const TEMPLATE_CSV = [
	"date,channel,visitors,conv,aov,spend",
	"08-02,天猫旗舰店,11280,3.51,156.2,6100",
	"08-02,京东自营,4980,2.85,145.8,2350",
	"08-02,拼多多旗舰店,8120,4.05,110.5,3600",
	"08-02,抖音小店,6540,2.31,126.4,4950",
	"08-05,天猫旗舰店,11860,3.58,157.4,6250",
	"08-05,京东自营,5210,2.92,146.3,2410",
	"08-08,天猫旗舰店,12420,3.66,159.1,6400",
	"08-08,京东自营,5520,2.98,147.2,2480",
	"08-08,拼多多旗舰店,8690,4.12,111.8,3750",
	"08-08,抖音小店,7010,2.38,127.6,5120",
	"08-11,天猫旗舰店,12180,3.62,158.3,6320",
	"08-11,京东自营,5390,2.95,146.8,2440",
	"08-11,拼多多旗舰店,8510,4.09,111.2,3690",
	"08-14,天猫旗舰店,11520,3.49,157.8,6180",
	"08-14,京东自营,5080,2.88,145.9,2380",
	"08-14,抖音小店,6680,2.29,127.1,5080",
	"08-15,天猫旗舰店,11010,3.39,158.2,6220",
	"08-15,京东自营,5486,2.91,146.1,2420",
	"08-15,拼多多旗舰店,8340,4.06,111.5,3720",
	"08-15,抖音小店,6903,2.36,127.9,6500",
	"",
].join("\n");

// ── metrics & builders ──────────────────────────────────────────────────────
function metrics(i, c) {
	const d = daily[i][c];
	const base = CHANNELS[c];
	const ov = csvOverride && csvOverride[dateLabel(i)] ? csvOverride[dateLabel(i)][base.name] : null;
	const visitors = ov ? ov.visitors : d.visitors;
	const conv = ov ? ov.conv : d.conv;
	const aov = ov ? ov.aov : d.aov;
	const spend = ov ? ov.spend : d.spend;
	const gmv = visitors * (conv / 100) * aov;
	const profit = gmv * (1 - base.costRate - base.platFee) - spend;
	const orders = Math.round(visitors * (conv / 100));
	const roi = gmv / spend;
	return { gmv, profit, orders, roi, spend, conv, aov, visitors };
}
function sumDay(i) {
	const total = { gmv: 0, profit: 0, orders: 0, spend: 0, visitors: 0, roiGmv: 0 };
	for (let c = 0; c < CHANNELS.length; c++) {
		const m = metrics(i, c);
		total.gmv += m.gmv; total.profit += m.profit; total.orders += m.orders;
		total.spend += m.spend; total.visitors += m.visitors; total.roiGmv += m.gmv;
	}
	total.roi = total.roiGmv / total.spend;
	return total;
}
function round2(v) { return Math.round(v * 100) / 100; }
function fmtInt(v) { return String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
function fmtPct(d) { return (d >= 0 ? "+" : "") + (d * 100).toFixed(1) + "%"; }
function clean(v) {
	if (typeof v === "number") {
		if (!Number.isFinite(v)) return 0;
		return Object.is(v, -0) ? 0 : v;
	}
	if (Array.isArray(v)) return v.map(clean);
	if (v && typeof v === "object") {
		const out = {};
		for (const k of Object.keys(v)) out[k] = clean(v[k]);
		return out;
	}
	return v;
}
function buildDashboard() {
	const t = sumDay(DAYS - 1), y = sumDay(DAYS - 2);
	const pct = (a, b) => b === 0 ? 0 : (a - b) / b;
	const kpis = [
		{ key: "gmv", label: "今日销售额", value: Math.round(t.gmv), delta: round2(pct(t.gmv, y.gmv)) },
		{ key: "profit", label: "今日毛利", value: Math.round(t.profit), delta: round2(pct(t.profit, y.profit)) },
		{ key: "spend", label: "推广花费", value: Math.round(t.spend), delta: round2(pct(t.spend, y.spend)) },
		{ key: "roi", label: "推广 ROI", value: round2(t.roi), delta: round2(pct(t.roi, y.roi)) },
		{ key: "orders", label: "订单数", value: t.orders, delta: round2(pct(t.orders, y.orders)) },
		{ key: "conv", label: "转化率", value: round2(t.orders / t.visitors * 100), delta: round2(pct(t.orders / t.visitors, y.orders / y.visitors)) },
		{ key: "aov", label: "客单价", value: round2(t.gmv / t.orders), delta: round2(pct(t.gmv / t.orders, y.gmv / y.orders)) },
	];
	const stockWarnList = SKUS.filter((s) => s.stock < s.safe);
	const stockWarn = stockWarnList.length;
	const trend = [];
	for (let i = DAYS - 14; i < DAYS; i++) {
		const s = sumDay(i);
		trend.push({ date: dateLabel(i), gmv: Math.round(s.gmv), profit: Math.round(s.profit) });
	}
	const channels = CHANNELS.map((base, c) => {
		const m = metrics(DAYS - 1, c), my = metrics(DAYS - 2, c);
		return {
			name: base.name, gmv: Math.round(m.gmv),
			share: t.gmv === 0 ? 0 : m.gmv / t.gmv,
			roi: round2(m.roi), spend: Math.round(m.spend),
			delta: round2(pct(m.gmv, my.gmv)),
		};
	});
	const insights = [];
	channels.forEach((ch) => {
		if (ch.delta <= -0.05) {
			insights.push({ level: "warn", title: ch.name + "销售额环比下降 " + Math.abs(ch.delta * 100).toFixed(1) + "%", detail: "GMV ¥" + fmtInt(ch.gmv) + "，受访客/转化回落影响，建议核查流量结构与活动承接。" });
		} else if (ch.delta >= 0.05) {
			insights.push({ level: "info", title: ch.name + "销售额环比上升 " + (ch.delta * 100).toFixed(1) + "%", detail: "建议保持当前投放节奏，复盘增长来源以便复制。" });
		}
		if (ch.roi < config.roiThreshold && ch.spend > 4000) {
			insights.push({ level: "warn", title: ch.name + "推广 ROI " + ch.roi.toFixed(2) + " 低于 " + config.roiThreshold + " 阈值", detail: "今日花费 ¥" + fmtInt(ch.spend) + "，建议暂停低效计划并回撤预算至 ROI 更好的渠道。" });
		}
	});
	if (stockWarn > 0) {
		const s = stockWarnList[0];
		insights.push({ level: "error", title: stockWarn + " 个 SKU 库存低于安全线", detail: "其中「" + s.name + "」仅剩 " + s.stock + " 件（安全线 " + s.safe + "），预计影响今日销售，请尽快补货。" });
	}
	const gmvPct = pct(t.gmv, y.gmv);
	if (gmvPct >= 0) {
		insights.push({ level: "info", title: "整体销售额环比 " + (gmvPct * 100).toFixed(1) + "%", detail: "今日总 GMV ¥" + fmtInt(t.gmv) + "，经营平稳。" });
	} else {
		insights.push({ level: "warn", title: "整体销售额环比下降 " + (Math.abs(gmvPct) * 100).toFixed(1) + "%", detail: "今日总 GMV ¥" + fmtInt(t.gmv) + "，请结合上方渠道要点定位原因。" });
	}
	const sources = [
		{ name: "生意参谋（天猫）", updated: "08-15 06:30", status: "ok" },
		{ name: "京麦（京东）", updated: "08-15 06:15", status: "ok" },
		{ name: "多多罗盘（拼多多）", updated: "08-15 05:50", status: "ok" },
		{ name: "抖店罗盘（抖音）", updated: "08-15 06:00", status: "ok" },
		{ name: "评价中心", updated: "08-13 23:00", status: "stale" },
	];
	if (config.dataSource === "csv") {
		sources.unshift({ name: "CSV 导入（" + config.csvPath.split("/").pop() + "）", updated: "已覆盖同日期同渠道", status: "ok" });
	}
	return { asOf: "2026-08-15", store: config.storeName, dataSource: config.dataSource, csvPath: config.csvPath, roiThreshold: config.roiThreshold, kpis, stockWarn, trend, channels, insights, sources };
}
function buildSnapshot() {
	const t = sumDay(DAYS - 1), y = sumDay(DAYS - 2);
	const pct = (a, b) => b === 0 ? 0 : (a - b) / b;
	return {
		asOf: "2026-08-15",
		gmv: Math.round(t.gmv), gmvDelta: round2(pct(t.gmv, y.gmv)),
		profit: Math.round(t.profit), roi: round2(t.roi),
		stockWarn: SKUS.filter((s) => s.stock < s.safe).length,
	};
}
function buildP2() {
	const DAY = DAYS - 1;
	const pct = (a, b) => b === 0 ? 0 : (a - b) / b;
	const anomalies = [], actions = [];
	const c0t = metrics(DAY, 0), c0y = metrics(DAY - 1, 0);
	const dg = pct(c0t.gmv, c0y.gmv);
	if (dg <= -0.05) {
		const dv = pct(c0t.visitors, c0y.visitors), dc = pct(c0t.conv, c0y.conv), da = pct(c0t.aov, c0y.aov);
		anomalies.push({ id: "A1", level: "warn", type: "decline", title: "天猫旗舰店 GMV 环比下降 " + Math.abs(dg * 100).toFixed(1) + "%", detail: "四因子分解：流量 " + fmtPct(dv) + "、转化率 " + fmtPct(dc) + "、客单价 " + fmtPct(da) + "，主因是转化回落（大促后承接不足）。", factor: { visitors: round2(dv), conv: round2(dc), aov: round2(da), gmv: round2(dg) } });
		actions.push({ id: "T1", title: "核查天猫流量结构与转化承接，针对下滑关键词优化详情页", owner: "林运营", due: "今天", priority: "P1", status: "待办", source: "A1" });
	}
	const PLANS = [
		{ channel: "天猫旗舰店", name: "引力魔方·人群拉新", spend: 3200, roi: 2.31 },
		{ channel: "天猫旗舰店", name: "直通车·核心词", spend: 2400, roi: 1.9 },
		{ channel: "抖音小店", name: "搜索推广·通用", spend: 4600, roi: 1.24 },
		{ channel: "抖音小店", name: "千川·短视频引流", spend: 2900, roi: 1.61 },
		{ channel: "京东自营", name: "快车·品类词", spend: 1500, roi: 2.7 },
		{ channel: "拼多多旗舰店", name: "多多搜索·场景", spend: 2400, roi: 1.25 },
	];
	const waste = PLANS.filter((p) => p.roi < config.roiThreshold && p.spend >= 2000);
	waste.forEach((p, i) => {
		anomalies.push({ id: "A2", level: "warn", type: "waste", title: "推广浪费：" + p.channel + "「" + p.name + "」ROI " + p.roi.toFixed(2), detail: "今日花费 ¥" + fmtInt(p.spend) + "，低于 " + config.roiThreshold + " 阈值" + (p.channel === "抖音小店" ? "，点击转化率较昨日下降约 22%" : "") + "，建议暂停或下调出价。", factor: null });
		if (i === 0) actions.push({ id: "T2", title: "暂停" + p.channel + "「" + p.name + "」并回撤预算至 ROI 更优计划", owner: "王投放", due: "今天", priority: "P1", status: "待办", source: "A2" });
	});
	const stockWarnList = SKUS.filter((s) => s.stock < s.safe);
	if (stockWarnList.length > 0) {
		anomalies.push({ id: "A3", level: "error", type: "stockout", title: stockWarnList.length + " 个 SKU 库存低于安全线", detail: stockWarnList.map((s) => s.name + "（剩 " + s.stock + "/安全 " + s.safe + "）").join("、") + "。「" + stockWarnList[0].name + "」预计影响今日销售。", factor: null });
		actions.push({ id: "T3", title: "补货：" + stockWarnList.slice(0, 3).map((s) => s.name).join("、") + " 等 " + stockWarnList.length + " 个 SKU", owner: "张供应链", due: "明天", priority: "P0", status: "待办", source: "A3" });
	}
	const COMPETITORS = [
		{ brand: "瑞幸咖啡", sku: "生椰拿铁（同类）", price: 9.9, prevPrice: 12.9, activity: "全场 9.9 元促销（08-14 起）" },
		{ brand: "隅田川", sku: "冷萃咖啡液 30 条", price: 54.9, prevPrice: 59.9, activity: "满 99 减 20" },
		{ brand: "三顿半", sku: "数字星球 18 颗装", price: 129, prevPrice: 129, activity: "无" },
	];
	const threat = COMPETITORS.filter((c) => c.price < c.prevPrice);
	if (threat.length > 0) {
		anomalies.push({ id: "A4", level: "warn", type: "competitor", title: "竞品「" + threat[0].brand + "」" + threat[0].sku + " 降价至 ¥" + threat[0].price, detail: "原价 ¥" + threat[0].prevPrice + "，" + threat[0].activity + "。可能分流本品同品类订单，建议评估并准备应对活动。", factor: null });
		actions.push({ id: "T4", title: "评估竞品降价影响，准备生椰系列应对活动方案", owner: "陈店长", due: "明天", priority: "P2", status: "待办", source: "A4" });
	}
	anomalies.push({ id: "A5", level: "warn", type: "integrity", title: "评价中心数据延迟 2 天", detail: "08-14 起评价数据未更新，无法计算评分趋势与差评预警。", factor: null });
	actions.push({ id: "T5", title: "跟进评价中心数据修复（与平台方确认同步任务）", owner: "李客服", due: "后天", priority: "P2", status: "进行中", source: "A5" });
	const c1t = metrics(DAY, 1), c1y = metrics(DAY - 1, 1);
	const dg1 = pct(c1t.gmv, c1y.gmv);
	if (dg1 >= 0.05) {
		anomalies.push({ id: "A6", level: "info", type: "opportunity", title: "京东自营 GMV 环比上升 " + (dg1 * 100).toFixed(1) + "%", detail: "由访客增长驱动（流量 " + fmtPct(pct(c1t.visitors, c1y.visitors)) + "），建议保持投放节奏并复盘增长来源。", factor: null });
		actions.push({ id: "T6", title: "复盘京东增长来源，固化可复制打法", owner: "林运营", due: "本周", priority: "P3", status: "待办", source: "A6" });
	}
	const integrity = {
		missing: [
			{ source: "评价中心", scope: "08-14 至 08-15 评价数据", impact: "无法计算评分变化与差评预警", since: "08-14 22:00" },
			{ source: "抖店罗盘", scope: "今日直播间分时 GMV", impact: "无法归因直播时段投放效果", since: "08-15 09:00" },
		],
		uncomputable: [
			{ metric: "复购率", reason: "缺少会员标签数据（尚未接入）" },
			{ metric: "拉新 ROI", reason: "新老客拆分字段缺失" },
			{ metric: "京东仓库存周转天数", reason: "库存快照延迟 3 天" },
		],
		sources: [
			{ name: "生意参谋（天猫）", updated: "08-15 06:30", status: "ok" },
			{ name: "京麦（京东）", updated: "08-15 06:15", status: "ok" },
			{ name: "多多罗盘（拼多多）", updated: "08-15 05:50", status: "ok" },
			{ name: "抖店罗盘（抖音）", updated: "08-15 06:00", status: "ok" },
			{ name: "评价中心", updated: "08-13 23:00", status: "stale" },
		],
	};
	const dock = {
		open: actions.filter((a) => a.status !== "完成").length,
		dueToday: actions.filter((a) => a.due === "今天").length,
		urgent: actions.filter((a) => a.priority === "P0").length,
	};
	return { anomalies, actions, integrity, dock };
}
function buildBrief() {
	const d = buildDashboard(), p = buildP2();
	const gmvKpi = d.kpis[0], profitKpi = d.kpis[1], roiKpi = d.kpis[3];
	const verdict = "今日总 GMV ¥" + fmtInt(gmvKpi.value) + "（环比 " + fmtPct(gmvKpi.delta) + "），毛利 ¥" + fmtInt(profitKpi.value) + "，经营整体" + (gmvKpi.delta >= 0 ? "平稳" : "承压") + "；主要风险为天猫转化回落与推广 ROI 偏低，已生成 " + p.dock.open + " 项行动。";
	const numbers = [
		{ label: "今日 GMV", value: "¥" + fmtInt(gmvKpi.value), delta: fmtPct(gmvKpi.delta) },
		{ label: "今日毛利", value: "¥" + fmtInt(profitKpi.value), delta: fmtPct(profitKpi.delta) },
		{ label: "推广 ROI", value: roiKpi.value.toFixed(2), delta: fmtPct(roiKpi.delta) },
		{ label: "缺货预警", value: d.stockWarn + " 个", delta: d.stockWarn > 0 ? "需处理" : "正常" },
		{ label: "待办行动", value: p.dock.open + " 项", delta: p.dock.dueToday + " 项今天到期" },
	];
	const points = d.insights.slice(0, 4).map((i) => ({ level: i.level, text: i.title + "：" + i.detail }));
	const topActions = p.actions.slice(0, 3).map((a) => ({ id: a.id, priority: a.priority, title: a.title, owner: a.owner, due: a.due }));
	const risks = [
		{ title: "竞品瑞幸 9.9 元促销（生椰拿铁）", detail: "可能分流同品类订单，应对任务已派给陈店长（明天）" },
		{ title: "评价中心数据延迟 2 天", detail: "评分趋势与差评预警暂不可用，修复任务进行中" },
	];
	const caveats = [
		"利润口径：GMV − 商品成本 − 推广费 − 平台费（含佣金与服务费，不含退货与仓储）",
		"ROI 为今日实时口径（15 天转化窗口待接入真实数据后启用）",
		"数据源：" + (d.dataSource === "csv" ? "CSV 导入（" + d.csvPath + "）" : "内置 mock 快照") + "，ROI 阈值 " + d.roiThreshold,
	];
	const markdown = [
		"# " + d.store + " 经营日报（2026-08-15）",
		"",
		"## 一句话结论",
		verdict,
		"",
		"## 关键数字",
		"| 指标 | 数值 | 变化 |",
		"| --- | --- | --- |",
		...numbers.map((n) => "| " + n.label + " | " + n.value + " | " + n.delta + " |"),
		"",
		"## 今日要点",
		...points.map((pnt) => "- " + pnt.text),
		"",
		"## 首要行动",
		...topActions.map((a) => "- [" + a.priority + "] " + a.title + "（" + a.owner + "，" + a.due + "）"),
		"",
		"## 风险与关注",
		...risks.map((r) => "- " + r.title + "：" + r.detail),
		"",
		"## 数据口径",
		...caveats.map((c) => "- " + c),
	].join("\n");
	return { title: d.store + " 经营日报", date: "2026-08-15", verdict, numbers, points, topActions, risks, caveats, markdown };
}
function answerQuestion(question) {
	const q = String(question || "").toLowerCase();
	const has = (words) => words.some((w) => q.includes(w));
	const DAY = DAYS - 1;
	const pct = (a, b) => b === 0 ? 0 : (a - b) / b;
	let ci = -1;
	if (has(["天猫"])) ci = 0;
	else if (has(["京东"])) ci = 1;
	else if (has(["拼多多", "多多"])) ci = 2;
	else if (has(["抖音", "抖店"])) ci = 3;
	if (ci >= 0 && has(["为什么", "为何", "原因", "怎么降", "怎么涨", "为何降", "为何涨", "下滑", "上涨"])) {
		const t = metrics(DAY, ci), y = metrics(DAY - 1, ci);
		const dg = pct(t.gmv, y.gmv), name = CHANNELS[ci].name;
		const trend = [];
		for (let i = DAY - 6; i <= DAY; i++) {
			const m = metrics(i, ci);
			trend.push({ label: dateLabel(i), gmv: Math.round(m.gmv) });
		}
		return {
			answer: name + (dg >= 0 ? "今日销售额上升 " : "今日销售额下降 ") + Math.abs(dg * 100).toFixed(1) + "%，四因子分解：流量 " + fmtPct(pct(t.visitors, y.visitors)) + "、转化率 " + fmtPct(pct(t.conv, y.conv)) + "、客单价 " + fmtPct(pct(t.aov, y.aov)) + "。" + (dg < 0 ? "主因是转化回落（大促后承接不足），建议核查流量结构与详情页转化。" : "主因是访客增长，建议复盘来源并固化打法。"),
			chart: { type: "line", title: name + " 近 7 天销售额", series: trend },
		};
	}
	if (has(["趋势", "走势", "近7天", "近七天", "近14天", "近十四天", "最近"])) {
		const n = has(["近14", "十四"]) ? 14 : 7;
		const pts = [];
		for (let i = DAY - n + 1; i <= DAY; i++) {
			const s = ci >= 0 ? metrics(i, ci) : sumDay(i);
			pts.push({ label: dateLabel(i), gmv: Math.round(s.gmv) });
		}
		const name = ci >= 0 ? CHANNELS[ci].name : "整体";
		return {
			answer: name + " 近 " + n + " 天销售额：" + pts.map((p) => p.label + " ¥" + fmtInt(p.gmv)).join("、") + "。" + (pts[pts.length - 1].gmv >= pts[0].gmv ? "整体呈上升趋势。" : "整体呈回落趋势。"),
			chart: { type: "line", title: name + " 近" + n + "天销售额", series: pts },
		};
	}
	if (has(["roi", "投产", "回报", "浪费"])) {
		const rows = CHANNELS.map((c, i) => ({ name: c.name, roi: round2(metrics(DAY, i).roi), spend: Math.round(metrics(DAY, i).spend) })).sort((a, b) => a.roi - b.roi);
		return {
			answer: "今日各渠道推广 ROI 从低到高：" + rows.map((r) => r.name + " " + r.roi.toFixed(2)).join("、") + "。" + (rows[0].roi < config.roiThreshold ? rows[0].name + " ROI 最低且低于 " + config.roiThreshold + " 阈值（花费 ¥" + fmtInt(rows[0].spend) + "），已触发浪费告警，建议暂停低效计划。" : "整体投放效率正常。"),
			chart: { type: "bar", title: "各渠道推广 ROI（今日）", series: rows.map((r) => ({ label: r.name, value: r.roi })) },
		};
	}
	if (has(["缺货", "库存"])) {
		const list = SKUS.filter((s) => s.stock < s.safe);
		return {
			answer: list.length === 0 ? "当前无缺货预警，库存健康。" : "当前 " + list.length + " 个 SKU 库存低于安全线：" + list.map((s) => s.name + "（剩 " + s.stock + " 件，安全线 " + s.safe + "）").join("、") + "。已生成补货任务（张供应链，截止明天）。",
			chart: null,
		};
	}
	const t = sumDay(DAY), y = sumDay(DAY - 1);
	return {
		answer: "今日经营总览：GMV ¥" + fmtInt(t.gmv) + "（环比 " + fmtPct(pct(t.gmv, y.gmv)) + "）、毛利 ¥" + fmtInt(t.profit) + "、推广花费 ¥" + fmtInt(t.spend) + "、ROI " + t.roi.toFixed(2) + "、订单 " + t.orders + " 单。可用「天猫为什么下滑」「近7天趋势」「哪个渠道ROI最低」「缺货情况」等提问获取更细分析。",
		chart: null,
	};
}

// ── plugin ──────────────────────────────────────────────────────────────────
const inject = ["webServer", "tools"];

const json = (res, status, data) => {
	res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
	res.end(JSON.stringify(clean(data)));
};
function readBody(req) {
	return new Promise((resolve) => {
		let data = "";
		req.on("data", (c) => { data += c; if (data.length > 1e6) req.destroy(); });
		req.on("end", () => {
			try { resolve(data ? JSON.parse(data) : {}); } catch (_e) { resolve({}); }
		});
		req.on("error", () => resolve({}));
	});
}
function apply(ctx) {
	loadConfig();
	loadCsvOverride();

	const safeRegister = (path, handler, label) => {
		try {
			ctx.effect(() => ctx.webServer.register({ kind: "exact", path, handler }), label);
		} catch (error) {
			ctx.logger.warn(`${label}: route ${path} already owned (${String(error instanceof Error ? error.message : error)})`);
		}
	};

	const api = (build) => async (_req, res) => json(res, 200, build());

	safeRegister("/cockpit/api/dashboard", api(buildDashboard), "cockpit: dashboard");
	safeRegister("/cockpit/api/snapshot", api(buildSnapshot), "cockpit: snapshot");
	safeRegister("/cockpit/api/p2", api(buildP2), "cockpit: p2");
	safeRegister("/cockpit/api/actions", api(() => { const p = buildP2(); return { dock: p.dock, actions: p.actions }; }), "cockpit: actions");
	safeRegister("/cockpit/api/brief", api(buildBrief), "cockpit: brief");
	safeRegister("/cockpit/api/config", async (req, res) => {
		if (req.method === "GET") return json(res, 200, { config });
		const body = await readBody(req);
		if (typeof body.roiThreshold === "number" && Number.isFinite(body.roiThreshold) && body.roiThreshold > 0) config.roiThreshold = body.roiThreshold;
		if (typeof body.storeName === "string" && body.storeName.trim()) config.storeName = body.storeName.trim();
		if (typeof body.csvPath === "string" && body.csvPath.trim()) config.csvPath = body.csvPath.trim();
		const save = saveConfig();
		return json(res, 200, { config, save });
	}, "cockpit: config");
	safeRegister("/cockpit/api/import-csv", async (req, res) => {
		const body = await readBody(req);
		if (body.clear) {
			csvOverride = null;
			config.dataSource = "mock";
			const save = saveConfig();
			return json(res, 200, { ok: true, cleared: true, save });
		}
		const path = body.path || config.csvPath;
		try {
			const text = readFileSync(String(path), "utf8");
			const rows = text.split("\n").filter((l) => l.trim() !== "").length - 1;
			const override = buildOverrideFromCsv(text);
			if (!override) return json(res, 200, { ok: false, error: "CSV 解析失败：需要 date,channel,visitors,conv,aov,spend 列且含有效数据行" });
			csvOverride = override;
			config.dataSource = "csv";
			config.csvPath = String(path);
			const save = saveConfig();
			return json(res, 200, { ok: true, rows, covered: Object.keys(override).reduce((n, d) => n + Object.keys(override[d]).length, 0), dates: Object.keys(override).length, save });
		} catch (e) {
			return json(res, 200, { ok: false, error: "读取文件失败：" + String(e && e.message || e) });
		}
	}, "cockpit: import-csv");
	safeRegister("/cockpit/api/export-template", async (_req, res) => {
		try {
			mkdirSync(DATA_DIR, { recursive: true });
			writeFileSync(TEMPLATE_PATH, TEMPLATE_CSV);
			return json(res, 200, { ok: true, path: TEMPLATE_PATH });
		} catch (e) {
			return json(res, 200, { ok: false, error: String(e && e.message || e) });
		}
	}, "cockpit: export-template");

	// model-visible tool: natural-language Q&A against the mock snapshot
	ctx.tools.register(defineTool({
		name: "cockpit_ask",
		description: "查询「电商经营驾驶舱」今日经营数据并回答老板问题：销售额/毛利/ROI/转化/订单/缺货/渠道对比/趋势/归因。支持自然语言提问，例如「天猫今天为什么下滑」「近7天整体销售额趋势」「哪个渠道ROI最低」「缺货情况」。数据为 2026-08-15 mock 快照（可导入 CSV 覆盖）。",
		parameters: { question: { type: "string", required: true, description: "自然语言经营问题" } },
		output: {
			schema: { type: "object", properties: { answer: { type: "string", required: true, description: "面向老板的回答文本" }, chart: { type: "json", description: "可选的图表数据 {type, title, series} 或 null" } }, additionalProperties: false },
			render(_args, value) { return [{ type: "text", text: value.answer }]; },
		},
		async execute(args) { return answerQuestion(args.question); },
	}));

	ctx.logger.info("commerce-cockpit: active (" + config.dataSource + " data source" + (config.dataSource === "csv" ? " from " + config.csvPath : "") + ")");
}

export default { name: "commerce-cockpit", inject, apply };
