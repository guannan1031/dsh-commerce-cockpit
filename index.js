/**
 * @ekzc/dsh-commerce-cockpit — host half (persistent)
 *
 * Runs inside the `web` profile as a normal Cordis plugin. Owns:
 *   - the deterministic Demo ecommerce engine (channels x 30 days + SKU stock),
 *   - JSON API routes under /cockpit/api/* (dashboard, p2, actions, brief,
 *     snapshot, config, import-csv, export-template) served by webServer,
 *   - the model-visible `cockpit_ask` tool (natural-language Q&A),
 *   - the validated Imported CSV layer + persisted config in the workspace data/ dir.
 *
 * Branding (title/favicon/theme-color) is owned by @ekzc/dsh-whale-skin;
 * this plugin intentionally does not tap index.html. The client half
 * (client.js) provides the cockpit view, dock, sidebar entry and blue theme.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, lstatSync, realpathSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { homedir } from "node:os";
import { TextDecoder } from "node:util";
import { fileURLToPath } from "node:url";
import { defineTool } from "@deepseek-ai/dsh-tools";

const PLUGIN_DIR = dirname(fileURLToPath(import.meta.url));
const DSH_HOME = process.env.DSH_HOME || join(homedir(), ".dsh");
const DATA_DIR = join(DSH_HOME, "data", "commerce-cockpit");
const IMPORT_DIR = join(DSH_HOME, "imports", "commerce-cockpit");
const CONFIG_PATH = join(DATA_DIR, "cockpit-config.json");
const TEMPLATE_PATH = join(IMPORT_DIR, "daily_sales.csv");
const DEMO_DATE = "2026-08-15";
const CSV_HEADERS = ["business_date", "platform", "store_id", "channel", "gmv", "orders", "visitors", "ad_spend"];

// ── deterministic Demo engine ───────────────────────────────────────────────
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

// ── config + imported data (real fs, persists across restarts) ──────────────
let config = { dataSource: "demo", fileName: "daily_sales.csv", roiThreshold: 1.5, storeName: "星辰优选 · 咖啡事业部" };
let importedRows = [];
let importState = { status: "not_loaded", error: null, fileName: null, rows: 0 };

function loadConfig() {
	try {
		if (existsSync(CONFIG_PATH)) {
			const parsed = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
			if (parsed && typeof parsed === "object") {
				config = { ...config, ...parsed };
				if (config.dataSource === "mock" || config.dataSource === "csv") config.dataSource = config.dataSource === "csv" ? "imported" : "demo";
				if (typeof parsed.csvPath === "string" && !parsed.fileName) config.fileName = basename(parsed.csvPath);
				if (config.dataSource !== "imported") config.dataSource = "demo";
				if (typeof config.fileName !== "string" || !config.fileName || config.fileName !== basename(config.fileName)) config.fileName = "daily_sales.csv";
			}
		}
	} catch (_e) { /* first run */ }
}
function saveConfig() {
	try {
		mkdirSync(DATA_DIR, { recursive: true });
		writeFileSync(CONFIG_PATH, JSON.stringify({
			dataSource: config.dataSource,
			fileName: config.fileName,
			roiThreshold: config.roiThreshold,
			storeName: config.storeName,
		}, null, 2));
		return { saved: true };
	} catch (e) {
		return { saved: false, reason: String(e && e.message || e) };
	}
}
function configView() {
	return { dataSource: config.dataSource, fileName: config.fileName, roiThreshold: config.roiThreshold, storeName: config.storeName, importDir: "DSH_HOME/imports/commerce-cockpit" };
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
function isValidDate(value) {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
	if (!match) return false;
	const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
	const date = new Date(Date.UTC(year, month - 1, day));
	return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
function parseNullableNumber(value, label, rowNumber, integer = false) {
	const raw = String(value ?? "").trim();
	if (raw === "") return null;
	const number = Number(raw);
	if (!Number.isFinite(number) || number < 0 || (integer && !Number.isInteger(number))) throw new Error(`${label} 第${rowNumber}行不是有效的非负${integer ? "整数" : "数字"}`);
	return number;
}
function parseImportedCsv(text) {
	const rows = parseCsv(String(text).replace(/^\uFEFF/, ""));
	if (rows.length < 2) throw new Error("CSV至少需要一行数据");
	const header = rows[0].map((h) => h.trim());
	const missing = CSV_HEADERS.filter((name) => !header.includes(name));
	if (missing.length) throw new Error("缺少字段：" + missing.join(", "));
	const idx = Object.fromEntries(CSV_HEADERS.map((name) => [name, header.indexOf(name)]));
	if (rows.length > 50001) throw new Error("CSV最多支持50000行数据");
	const seen = new Set();
	const parsed = [];
	for (let r = 1; r < rows.length; r++) {
		const row = rows[r];
		if (!row.some((field) => String(field || "").trim() !== "")) continue;
		const rowNumber = r + 1;
		const businessDate = String(row[idx.business_date] || "").trim();
		const platform = String(row[idx.platform] || "").trim();
		const storeId = String(row[idx.store_id] || "").trim();
		const channel = String(row[idx.channel] || "").trim();
		if (!isValidDate(businessDate)) throw new Error(`business_date 第${rowNumber}行必须是YYYY-MM-DD`);
		if (!platform || !storeId || !channel) throw new Error(`platform/store_id/channel 第${rowNumber}行不能为空`);
		const key = [businessDate, platform, storeId, channel].join("\u001f");
		if (seen.has(key)) throw new Error(`第${rowNumber}行与已有数据重复：${businessDate}/${platform}/${storeId}/${channel}`);
		seen.add(key);
		parsed.push({
			businessDate, platform, storeId, channel,
			gmv: parseNullableNumber(row[idx.gmv], "gmv", rowNumber),
			orders: parseNullableNumber(row[idx.orders], "orders", rowNumber, true),
			visitors: parseNullableNumber(row[idx.visitors], "visitors", rowNumber, true),
			adSpend: parseNullableNumber(row[idx.ad_spend], "ad_spend", rowNumber),
		});
	}
	if (!parsed.length) throw new Error("CSV没有有效数据行");
	return parsed;
}
function importFilePath(fileName) {
	const name = String(fileName || "").trim();
	if (!name || name !== basename(name) || name === "." || name === "..") throw new Error("只允许填写导入目录内的文件名");
	if (!/\.csv$/i.test(name)) throw new Error("只允许导入CSV文件");
	const root = resolve(IMPORT_DIR);
	const candidate = resolve(root, name);
	if (relative(root, candidate).startsWith("..")) throw new Error("文件路径超出允许目录");
	if (existsSync(candidate)) {
		const stat = lstatSync(candidate);
		if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("导入文件不能是符号链接或目录");
		const real = realpathSync(candidate);
		if (relative(root, real).startsWith("..")) throw new Error("文件真实路径超出允许目录");
	}
	return candidate;
}
function loadImportedFile() {
	importedRows = [];
	if (config.dataSource !== "imported") {
		importState = { status: "not_loaded", error: null, fileName: null, rows: 0 };
		return;
	}
	try {
		const path = importFilePath(config.fileName);
		if (!existsSync(path)) throw new Error("找不到导入文件：" + config.fileName);
		const stat = lstatSync(path);
		if (stat.size > 5 * 1024 * 1024) throw new Error("CSV文件不能超过5MB");
		importedRows = parseImportedCsv(new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(path)));
		importState = { status: "ready", error: null, fileName: config.fileName, rows: importedRows.length };
	} catch (error) {
		importState = { status: "error", error: String(error && error.message || error), fileName: config.fileName, rows: 0 };
	}
}
const TEMPLATE_CSV = [
	"business_date,platform,store_id,channel,gmv,orders,visitors,ad_spend",
	"2026-08-14,天猫,tmall-main,搜索,12800,86,2400,1800",
	"2026-08-14,天猫,tmall-main,推荐,9200,58,1800,900",
	"2026-08-15,天猫,tmall-main,搜索,13100,89,2500,1900",
	"2026-08-15,天猫,tmall-main,推荐,8700,54,1750,980",
	"2026-08-14,京东,jd-main,搜索,7600,51,1600,1200",
	"2026-08-15,京东,jd-main,搜索,8100,55,1700,1250",
	"",
].join("\n");

// ── metrics & builders ──────────────────────────────────────────────────────
function metrics(i, c) {
	const d = daily[i][c];
	const base = CHANNELS[c];
	const visitors = d.visitors;
	const conv = d.conv;
	const aov = d.aov;
	const spend = d.spend;
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
function fmtDelta(d) {
	if (d == null || !Number.isFinite(Number(d))) return "不可计算";
	if (d === 0) return "持平";
	return (d > 0 ? "↑ +" : "↓ -") + Math.abs(d * 100).toFixed(1) + "%";
}
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
function buildDemoDashboard() {
	const t = sumDay(DAYS - 1), y = sumDay(DAYS - 2);
	const pct = (a, b) => b === 0 ? 0 : (a - b) / b;
	const kpis = [
		{ key: "gmv", label: "演示日销售额", value: Math.round(t.gmv), delta: round2(pct(t.gmv, y.gmv)) },
		{ key: "profit", label: "估算经营贡献利润", value: Math.round(t.profit), delta: round2(pct(t.profit, y.profit)) },
		{ key: "spend", label: "推广花费", value: Math.round(t.spend), delta: round2(pct(t.spend, y.spend)) },
		{ key: "roi", label: "整体投放产出比", value: round2(t.roi), delta: round2(pct(t.roi, y.roi)) },
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
			insights.push({ level: "warn", title: ch.name + "整体投放产出比 " + ch.roi.toFixed(2) + " 低于 " + config.roiThreshold + " 阈值", detail: "演示日花费 ¥" + fmtInt(ch.spend) + "，建议暂停低效计划并回撤预算至产出比较高的渠道。" });
		}
	});
	if (stockWarn > 0) {
		const s = stockWarnList[0];
		insights.push({ level: "error", title: stockWarn + " 个 SKU 库存低于安全线", detail: "其中「" + s.name + "」仅剩 " + s.stock + " 件（安全线 " + s.safe + "），预计影响演示日销售，请尽快补货。" });
	}
	const gmvPct = pct(t.gmv, y.gmv);
	if (gmvPct >= 0) {
		insights.push({ level: "info", title: "演示日整体销售额环比 " + (gmvPct * 100).toFixed(1) + "%", detail: "演示日总 GMV ¥" + fmtInt(t.gmv) + "，经营平稳。" });
	} else {
		insights.push({ level: "warn", title: "演示日整体销售额环比下降 " + (Math.abs(gmvPct) * 100).toFixed(1) + "%", detail: "演示日总 GMV ¥" + fmtInt(t.gmv) + "，请结合上方渠道要点查看变化。" });
	}
	const sources = [
		{ name: "生意参谋（天猫）", updated: "08-15 06:30", status: "ok" },
		{ name: "京麦（京东）", updated: "08-15 06:15", status: "ok" },
		{ name: "多多罗盘（拼多多）", updated: "08-15 05:50", status: "ok" },
		{ name: "抖店罗盘（抖音）", updated: "08-15 06:00", status: "ok" },
		{ name: "评价中心", updated: "08-13 23:00", status: "stale" },
	];
	return { mode: "demo", asOf: DEMO_DATE, store: config.storeName, dataSource: "demo", fileName: null, roiThreshold: config.roiThreshold, kpis, stockWarn, trend, channels, insights, sources };
}
function buildDemoSnapshot() {
	const t = sumDay(DAYS - 1), y = sumDay(DAYS - 2);
	const pct = (a, b) => b === 0 ? 0 : (a - b) / b;
	return {
		mode: "demo", asOf: DEMO_DATE,
		gmv: Math.round(t.gmv), gmvDelta: round2(pct(t.gmv, y.gmv)),
		profit: Math.round(t.profit), roi: round2(t.roi),
		stockWarn: SKUS.filter((s) => s.stock < s.safe).length,
	};
}
function buildDemoP2() {
	const DAY = DAYS - 1;
	const pct = (a, b) => b === 0 ? 0 : (a - b) / b;
	const anomalies = [], actions = [];
	const c0t = metrics(DAY, 0), c0y = metrics(DAY - 1, 0);
	const dg = pct(c0t.gmv, c0y.gmv);
	if (dg <= -0.05) {
		const dv = pct(c0t.visitors, c0y.visitors), dc = pct(c0t.conv, c0y.conv), da = pct(c0t.aov, c0y.aov);
		anomalies.push({ id: "A1", level: "warn", type: "decline", title: "天猫旗舰店 GMV 环比下降 " + Math.abs(dg * 100).toFixed(1) + "%", detail: "指标变化拆解：流量 " + fmtPct(dv) + "、转化率 " + fmtPct(dc) + "、客单价 " + fmtPct(da) + "，演示判断为转化回落（大促后承接不足）。", factor: { visitors: round2(dv), conv: round2(dc), aov: round2(da), gmv: round2(dg) } });
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
		anomalies.push({ id: "A2", level: "warn", type: "waste", title: "低效投放：" + p.channel + "「" + p.name + "」整体投放产出比 " + p.roi.toFixed(2), detail: "演示日花费 ¥" + fmtInt(p.spend) + "，低于 " + config.roiThreshold + " 阈值" + (p.channel === "抖音小店" ? "，点击转化率较前一日下降约 22%" : "") + "，建议暂停或下调出价。", factor: null });
		if (i === 0) actions.push({ id: "T2", title: "暂停" + p.channel + "「" + p.name + "」并回撤预算至整体投放产出比较优计划", owner: "王投放", due: DEMO_DATE, priority: "P1", status: "待办", source: "A2" });
	});
	const stockWarnList = SKUS.filter((s) => s.stock < s.safe);
	if (stockWarnList.length > 0) {
		anomalies.push({ id: "A3", level: "error", type: "stockout", title: stockWarnList.length + " 个 SKU 库存低于安全线", detail: stockWarnList.map((s) => s.name + "（剩 " + s.stock + "/安全 " + s.safe + "）").join("、") + "。「" + stockWarnList[0].name + "」预计影响演示日销售。", factor: null });
		actions.push({ id: "T3", title: "补货：" + stockWarnList.slice(0, 3).map((s) => s.name).join("、") + " 等 " + stockWarnList.length + " 个 SKU", owner: "张供应链", due: DEMO_DATE, priority: "P0", status: "待办", source: "A3" });
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
			{ source: "抖店罗盘", scope: "业务日直播间分时 GMV", impact: "无法归因直播时段投放效果", since: "08-15 09:00" },
		],
		uncomputable: [
			{ metric: "复购率", reason: "缺少会员标签数据（尚未接入）" },
			{ metric: "拉新投放产出比", reason: "新老客拆分字段缺失" },
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
function buildDemoBrief() {
	const d = buildDemoDashboard(), p = buildDemoP2();
	const gmvKpi = d.kpis[0], profitKpi = d.kpis[1], roiKpi = d.kpis[3];
	const verdict = "演示业务日总 GMV ¥" + fmtInt(gmvKpi.value) + "（环比 " + fmtPct(gmvKpi.delta) + "），估算经营贡献利润 ¥" + fmtInt(profitKpi.value) + "，经营整体" + (gmvKpi.delta >= 0 ? "平稳" : "承压") + "；主要风险为天猫转化回落与整体投放产出比较低，已生成 " + p.dock.open + " 项演示行动。";
	const numbers = [
		{ label: "演示日 GMV", value: "¥" + fmtInt(gmvKpi.value), delta: fmtPct(gmvKpi.delta) },
		{ label: "估算经营贡献利润", value: "¥" + fmtInt(profitKpi.value), delta: fmtPct(profitKpi.delta) },
		{ label: "整体投放产出比", value: roiKpi.value.toFixed(2), delta: fmtPct(roiKpi.delta) },
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
		"估算口径：GMV − 模拟商品成本 − 推广费 − 模拟平台费（不含退货与仓储）",
		"整体投放产出比 = GMV / 推广费，不代表广告归因ROI",
		"数据源：内置演示快照，业务日期 " + DEMO_DATE + "，阈值 " + d.roiThreshold,
	];
	const markdown = [
		"# " + d.store + " 经营日报（演示数据｜业务日期 " + DEMO_DATE + "）",
		"",
		"## 一句话结论",
		verdict,
		"",
		"## 关键数字",
		"| 指标 | 数值 | 变化 |",
		"| --- | --- | --- |",
		...numbers.map((n) => "| " + n.label + " | " + n.value + " | " + n.delta + " |"),
		"",
		"## 经营要点",
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
	return { title: d.store + " 经营日报（演示）", date: DEMO_DATE, verdict, numbers, points, topActions, risks, caveats, markdown };
}
function importedDates() { return [...new Set(importedRows.map((row) => row.businessDate))].sort(); }
function importedRowsFor(date, predicate = () => true) { return importedRows.filter((row) => row.businessDate === date && predicate(row)); }
function sumField(rows, field) {
	if (!rows.length || rows.some((row) => typeof row[field] !== "number")) return null;
	return rows.reduce((sum, row) => sum + row[field], 0);
}
function importedAggregate(date, predicate = () => true) {
	const rows = importedRowsFor(date, predicate);
	return {
		rows: rows.length,
		gmv: sumField(rows, "gmv"),
		orders: sumField(rows, "orders"),
		visitors: sumField(rows, "visitors"),
		adSpend: sumField(rows, "adSpend"),
	};
}
function ratio(numerator, denominator) { return typeof numerator === "number" && typeof denominator === "number" && denominator > 0 ? numerator / denominator : null; }
function delta(current, previous) { return typeof current === "number" && typeof previous === "number" && previous !== 0 ? (current - previous) / previous : null; }
function importedKpi(key, label, value, previous, formatter = "number") {
	return { key, label, value: value == null ? null : round2(value), delta: delta(value, previous), formatter };
}
function importedCapabilities(latestRows) {
	const fields = ["gmv", "orders", "visitors", "adSpend"];
	return Object.fromEntries(fields.map((field) => [field, latestRows.length > 0 && latestRows.every((row) => typeof row[field] === "number")]));
}
function buildImportedDashboard() {
	const dates = importedDates();
	if (importState.status !== "ready" || !dates.length) {
		return {
			mode: "imported", asOf: null, store: config.storeName, dataSource: "imported", fileName: config.fileName,
			importError: importState.error || "没有可用导入数据", availableCapabilities: {},
			kpis: [], trend: [], channels: [], insights: [{ level: "error", title: "导入数据不可用", detail: importState.error || "请先将符合模板的CSV放入指定导入目录。" }],
			stockWarn: null, sources: [], roiThreshold: config.roiThreshold,
		};
	}
	const latest = dates[dates.length - 1], previous = dates.length > 1 ? dates[dates.length - 2] : null;
	const current = importedAggregate(latest), prior = previous ? importedAggregate(previous) : null;
	const latestRows = importedRowsFor(latest);
	const kpis = [
		importedKpi("gmv", "销售额", current.gmv, prior && prior.gmv, "money"),
		importedKpi("spend", "推广花费", current.adSpend, prior && prior.adSpend, "money"),
		importedKpi("roi", "整体投放产出比", ratio(current.gmv, current.adSpend), prior && ratio(prior.gmv, prior.adSpend)),
		importedKpi("orders", "订单数", current.orders, prior && prior.orders),
		importedKpi("conv", "转化率", ratio(current.orders, current.visitors) == null ? null : ratio(current.orders, current.visitors) * 100, prior && (ratio(prior.orders, prior.visitors) == null ? null : ratio(prior.orders, prior.visitors) * 100), "percent"),
		importedKpi("aov", "客单价", ratio(current.gmv, current.orders), prior && ratio(prior.gmv, prior.orders), "money"),
	];
	const previousGroups = new Map(importedRowsFor(previous || "").map((row) => [[row.platform, row.storeId, row.channel].join("\u001f"), row]));
	const groups = new Map();
	for (const row of latestRows) {
		const key = [row.platform, row.storeId, row.channel].join("\u001f");
		const entry = groups.get(key) || { name: row.platform + "/" + row.storeId + "/" + row.channel, rows: [] };
		entry.rows.push(row);
		groups.set(key, entry);
	}
	const channels = [...groups.entries()].map(([key, entry]) => {
		const old = previousGroups.get(key);
		const groupGmv = sumField(entry.rows, "gmv");
		const groupAdSpend = sumField(entry.rows, "adSpend");
		return { name: entry.name, gmv: groupGmv == null ? null : Math.round(groupGmv), share: current.gmv > 0 && groupGmv != null ? groupGmv / current.gmv : null, roi: ratio(groupGmv, groupAdSpend), spend: groupAdSpend == null ? null : Math.round(groupAdSpend), delta: old ? delta(groupGmv, old.gmv) : null };
	});
	const insights = [{ level: "info", title: "Imported模式仅使用导入文件", detail: "系统不会补入演示数据；库存、成本、退款、平台费和负责人数据未接入。" }];
	const missing = ["gmv", "orders", "visitors", "ad_spend"].filter((field) => latestRows.some((row) => row[field] == null));
	if (missing.length) insights.push({ level: "warn", title: "最新业务日存在缺失字段", detail: missing.join(", ") + "含空值，相关指标将显示为不可计算或部分汇总。" });
	const trend = dates.slice(-14).map((date) => {
		const summary = importedAggregate(date);
		return summary.gmv == null ? null : { date, gmv: Math.round(summary.gmv), profit: null };
	}).filter(Boolean);
	return {
		mode: "imported", asOf: latest, store: config.storeName, dataSource: "imported", fileName: config.fileName,
		availableCapabilities: importedCapabilities(latestRows), kpis, trend, channels, insights, stockWarn: null,
		roiThreshold: config.roiThreshold, sources: [{ name: "CSV导入（" + config.fileName + "）", updated: "已校验", status: "ok" }],
	};
}
function buildImportedSnapshot() {
	const d = buildImportedDashboard();
	const find = (key) => d.kpis.find((kpi) => kpi.key === key);
	return { mode: "imported", asOf: d.asOf, gmv: find("gmv")?.value ?? null, gmvDelta: find("gmv")?.delta ?? null, profit: null, roi: find("roi")?.value ?? null, stockWarn: null, fileName: d.fileName };
}
function buildImportedP2() {
	const d = buildImportedDashboard();
	const uncomputable = [
		{ metric: "经营贡献利润", reason: "缺少商品成本、退款和平台费字段" },
		{ metric: "库存预警", reason: "模板未包含库存字段" },
		{ metric: "负责人行动", reason: "Imported模式不生成虚构负责人和行动结果" },
	];
	return { mode: "imported", anomalies: [], actions: [], integrity: { missing: [], uncomputable, sources: d.sources }, dock: { open: 0, dueToday: 0, urgent: 0 } };
}
function buildImportedBrief() {
	const d = buildImportedDashboard();
	const available = d.kpis.filter((kpi) => kpi.value != null);
	const numbers = available.map((kpi) => ({ label: kpi.label, value: kpi.formatter === "money" ? "¥" + fmtInt(kpi.value) : kpi.formatter === "percent" ? kpi.value.toFixed(2) + "%" : String(kpi.value), delta: fmtDelta(kpi.delta) }));
	const verdict = d.asOf ? "最新业务日 " + d.asOf + " 的导入数据已完成汇总；当前仅回答文件中提供的经营指标，未接入成本、退款、平台费和库存。" : "导入数据不可用，无法生成经营简报。";
	const points = d.insights.map((insight) => ({ level: insight.level, text: insight.title + "：" + insight.detail }));
	const caveats = ["数据模式：Imported，不会回退Demo", "不可计算项：经营贡献利润、库存预警、负责人行动", "数据源：" + (d.fileName || "未导入")];
	const markdown = ["# " + d.store + " 经营数据检查（" + (d.asOf || "无日期") + "）", "", "## 一句话结论", verdict, "", "## 可用指标", "| 指标 | 数值 | 变化 |", "| --- | --- | --- |", ...numbers.map((n) => "| " + n.label + " | " + n.value + " | " + n.delta + " |"), "", "## 数据限制", ...caveats.map((caveat) => "- " + caveat)].join("\n");
	return { title: d.store + " 经营数据检查", date: d.asOf || "不可用", verdict, numbers, points, topActions: [], risks: [], caveats, markdown };
}
function answerImportedQuestion(question) {
	const d = buildImportedDashboard();
	if (d.importError) return { answer: "当前导入数据不可用：" + d.importError + "。系统没有使用Demo数据替代。", chart: null };
	const q = String(question || "").toLowerCase();
	if (["利润", "毛利", "成本", "退款", "平台费", "库存", "缺货", "竞品", "负责人", "行动"].some((word) => q.includes(word))) return { answer: "当前Imported模板没有支持这个问题所需的数据字段，不能用演示数据补答。请提供对应的成本、退款、平台费、库存或行动字段。", chart: null };
	const dates = importedDates();
	const latest = dates[dates.length - 1];
	const matches = (row) => [row.platform, row.storeId, row.channel].some((value) => q.includes(String(value).toLowerCase()));
	const predicate = importedRows.some(matches) ? matches : () => true;
	if (["趋势", "走势", "近7天", "近七天", "最近"].some((word) => q.includes(word))) {
		const series = dates.slice(-7).map((date) => ({ label: date, gmv: sumField(importedRowsFor(date, predicate), "gmv") })).filter((point) => point.gmv != null);
		return series.length ? { answer: "最新导入数据的销售额趋势：" + series.map((point) => point.label + " ¥" + fmtInt(point.gmv)).join("、") + "。", chart: { type: "line", title: "导入数据销售额趋势", series } } : { answer: "当前数据没有可用于趋势分析的GMV。", chart: null };
	}
	if (["roi", "投产", "推广", "广告"].some((word) => q.includes(word))) {
		const rows = d.channels.filter((row) => row.roi != null).sort((a, b) => a.roi - b.roi);
		return rows.length ? { answer: "最新业务日整体投放产出比从低到高：" + rows.map((row) => row.name + " " + row.roi.toFixed(2)).join("、") + "。该指标为GMV/推广费，不代表归因ROI。", chart: { type: "bar", title: "整体投放产出比", series: rows.map((row) => ({ label: row.name, value: row.roi })) } } : { answer: "当前数据没有可计算的整体投放产出比。", chart: null };
	}
	const summary = importedAggregate(latest, predicate);
	const parts = [];
	if (summary.gmv != null) parts.push("销售额 ¥" + fmtInt(summary.gmv));
	if (summary.orders != null) parts.push("订单 " + fmtInt(summary.orders) + " 单");
	if (summary.visitors != null) parts.push("访客 " + fmtInt(summary.visitors));
	if (summary.adSpend != null) parts.push("推广费 ¥" + fmtInt(summary.adSpend));
	return { answer: "最新业务日 " + latest + " 的导入数据：" + (parts.length ? parts.join("、") : "没有可计算指标") + "。", chart: null };
}
function buildDashboard() { return config.dataSource === "imported" ? buildImportedDashboard() : buildDemoDashboard(); }
function buildSnapshot() { return config.dataSource === "imported" ? buildImportedSnapshot() : buildDemoSnapshot(); }
function buildP2() { return config.dataSource === "imported" ? buildImportedP2() : buildDemoP2(); }
function buildBrief() { return config.dataSource === "imported" ? buildImportedBrief() : buildDemoBrief(); }
function answerQuestion(question) { return config.dataSource === "imported" ? answerImportedQuestion(question) : answerDemoQuestion(question); }
function answerDemoQuestion(question) {
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
			answer: name + (dg >= 0 ? "演示日销售额上升 " : "演示日销售额下降 ") + Math.abs(dg * 100).toFixed(1) + "%，指标变化拆解：流量 " + fmtPct(pct(t.visitors, y.visitors)) + "、转化率 " + fmtPct(pct(t.conv, y.conv)) + "、客单价 " + fmtPct(pct(t.aov, y.aov)) + "。" + (dg < 0 ? "演示判断为转化回落（大促后承接不足），建议核查流量结构与详情页转化。" : "演示判断为访客增长，建议复盘来源并固化打法。"),
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
			answer: "演示日各渠道整体投放产出比从低到高：" + rows.map((r) => r.name + " " + r.roi.toFixed(2)).join("、") + "。" + (rows[0].roi < config.roiThreshold ? rows[0].name + " 整体投放产出比最低且低于 " + config.roiThreshold + " 阈值（花费 ¥" + fmtInt(rows[0].spend) + "），已触发演示告警，建议暂停低效计划。" : "演示数据中的整体投放效率正常。"),
			chart: { type: "bar", title: "各渠道整体投放产出比（演示日）", series: rows.map((r) => ({ label: r.name, value: r.roi })) },
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
		answer: "演示日经营总览：GMV ¥" + fmtInt(t.gmv) + "（环比 " + fmtPct(pct(t.gmv, y.gmv)) + "）、估算经营贡献利润 ¥" + fmtInt(t.profit) + "、推广花费 ¥" + fmtInt(t.spend) + "、整体投放产出比 " + t.roi.toFixed(2) + "、订单 " + t.orders + " 单。可用「天猫为什么下滑」「近7天趋势」「哪个渠道投放产出比最低」「缺货情况」等提问获取更细分析。",
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
	loadImportedFile();

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
	safeRegister("/cockpit/api/actions", api(() => { const p = buildP2(); return { mode: p.mode || "demo", dock: p.dock, actions: p.actions }; }), "cockpit: actions");
	safeRegister("/cockpit/api/brief", api(buildBrief), "cockpit: brief");
	safeRegister("/cockpit/api/config", async (req, res) => {
		if (req.method === "GET") return json(res, 200, { config: configView(), importState });
		const body = await readBody(req);
		if (typeof body.roiThreshold === "number" && Number.isFinite(body.roiThreshold) && body.roiThreshold > 0) config.roiThreshold = body.roiThreshold;
		if (typeof body.storeName === "string" && body.storeName.trim()) config.storeName = body.storeName.trim();
		if (typeof body.fileName === "string" && body.fileName.trim()) {
			try { importFilePath(body.fileName.trim()); config.fileName = basename(body.fileName.trim()); } catch (error) { return json(res, 400, { ok: false, error: String(error && error.message || error) }); }
		}
		const save = saveConfig();
		loadImportedFile();
		return json(res, 200, { config: configView(), importState, save });
	}, "cockpit: config");
	safeRegister("/cockpit/api/import-csv", async (req, res) => {
		const body = await readBody(req);
		if (body.clear) {
			importedRows = [];
			config.dataSource = "demo";
			const save = saveConfig();
			loadImportedFile();
			return json(res, 200, { ok: true, cleared: true, mode: "demo", save });
		}
		try {
			const fileName = String(body.fileName || config.fileName || "").trim();
			const path = importFilePath(fileName);
			if (!existsSync(path)) throw new Error("找不到导入文件：" + fileName);
			const stat = lstatSync(path);
			if (stat.size > 5 * 1024 * 1024) throw new Error("CSV文件不能超过5MB");
			const rowsData = parseImportedCsv(new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(path)));
			importedRows = rowsData;
			config.dataSource = "imported";
			config.fileName = basename(fileName);
			importState = { status: "ready", error: null, fileName: config.fileName, rows: rowsData.length };
			const save = saveConfig();
			return json(res, 200, { ok: true, mode: "imported", rows: rowsData.length, dates: new Set(rowsData.map((row) => row.businessDate)).size, save });
		} catch (e) {
			return json(res, 400, { ok: false, error: "读取文件失败：" + String(e && e.message || e) });
		}
	}, "cockpit: import-csv");
	safeRegister("/cockpit/api/export-template", async (_req, res) => {
		try {
			mkdirSync(IMPORT_DIR, { recursive: true });
			writeFileSync(TEMPLATE_PATH, TEMPLATE_CSV);
			return json(res, 200, { ok: true, fileName: basename(TEMPLATE_PATH), directory: "DSH_HOME/imports/commerce-cockpit" });
		} catch (e) {
			return json(res, 200, { ok: false, error: String(e && e.message || e) });
		}
	}, "cockpit: export-template");

	// Model-visible tool: answers against the active Demo or Imported dataset.
	ctx.tools.register(defineTool({
		name: "cockpit_ask",
		description: "查询「电商经营驾驶舱」当前数据模式并回答可支持的国内电商经营问题。Demo为固定演示快照；Imported只使用指定CSV中的业务日期、平台、店铺、渠道、销售额、订单、访客和推广费，不会回退Demo。",
		parameters: { question: { type: "string", required: true, description: "自然语言经营问题" } },
		output: {
			schema: { type: "object", properties: { answer: { type: "string", required: true, description: "面向老板的回答文本" }, chart: { type: "json", description: "可选的图表数据 {type, title, series} 或 null" } }, additionalProperties: false },
			render(_args, value) { return [{ type: "text", text: value.answer }]; },
		},
		async execute(args) { return answerQuestion(args.question); },
	}));

	ctx.logger.info("commerce-cockpit: active (" + config.dataSource + " data source" + (config.dataSource === "imported" ? " from " + config.fileName : "") + ")");
}

export { CSV_HEADERS, importFilePath, parseImportedCsv };
export default { name: "commerce-cockpit", inject, apply };
