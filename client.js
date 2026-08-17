/**
 * @ekzc/dsh-commerce-cockpit — client half (plain JS bundle, React via require)
 *
 * Loaded through `dsh-client-modules` into the browser boot graph. Mounts:
 *  - the "驾驶舱" view tab in the conversation view ring,
 *  - the sidebar-footer "驾驶舱" quick entry + snapshot popover,
 *  - the action-list dock above the composer,
 *  - the blue brand theme via theme.overrideTokens.
 *
 * Data comes from the host half's JSON routes under /cockpit/api/* via fetch.
 */
window.__ModuleLoader__.load({
	id: "@ekzc/dsh-commerce-cockpit",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		const React = require("react");

		// ── data access (host JSON API) ──────────────────────────────────────
		const api = (path, body) => fetch(path, {
			method: body === undefined ? "GET" : "POST",
			headers: body === undefined ? undefined : { "content-type": "application/json" },
			body: body === undefined ? undefined : JSON.stringify(body),
		}).then((r) => r.json());

		// ── helpers ─────────────────────────────────────────────────────────
		function fmtMoney(v) {
			return "¥" + String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
		}
		function fmtDelta(d) {
			if (d == null || d === 0) return "持平";
			const sign = d > 0 ? "↑ +" : "↓ -";
			return sign + Math.abs(Math.round(d * 1000) / 10) + "%";
		}

		// ── components ──────────────────────────────────────────────────────
		function KpiCard({ kpi }) {
			const up = kpi.delta > 0.0001;
			const down = kpi.delta < -0.0001;
			const cls = up ? "cockpit-up" : (down ? "cockpit-down" : "cockpit-flat");
			let value = String(kpi.value);
			if (kpi.key === "gmv" || kpi.key === "profit" || kpi.key === "spend" || kpi.key === "aov") value = fmtMoney(kpi.value);
			if (kpi.key === "conv") value = kpi.value + "%";
			if (kpi.key === "roi") value = kpi.value.toFixed(2);
			return React.createElement("div", { className: "kpi-card" },
				React.createElement("div", { className: "kpi-label" }, kpi.label),
				React.createElement("div", { className: "kpi-value" }, value),
				React.createElement("div", { className: "kpi-delta " + cls }, fmtDelta(kpi.delta) + " 较昨日"));
		}
		function TrendChart({ id, points, stroke, label }) {
			const W = 560, H = 180, PAD = 26;
			const values = points.map((p) => p.v);
			const min = Math.min.apply(null, values);
			const max = Math.max.apply(null, values);
			const span = max - min || 1;
			const coords = points.map((p, i) => {
				const x = PAD + (i * (W - PAD * 2)) / Math.max(points.length - 1, 1);
				const y = H - PAD - ((p.v - min) / span) * (H - PAD * 2);
				return [x, y];
			});
			const line = coords.map((c) => c[0].toFixed(1) + "," + c[1].toFixed(1)).join(" ");
			const area = "M" + coords[0][0].toFixed(1) + "," + (H - PAD) + " L" + coords.map((c) => c[0].toFixed(1) + "," + c[1].toFixed(1)).join(" L") + " L" + coords[coords.length - 1][0].toFixed(1) + "," + (H - PAD) + " Z";
			const last = coords[coords.length - 1];
			return React.createElement("svg", { viewBox: "0 0 " + W + " " + H, className: "cockpit-chart" },
				React.createElement("defs", null,
					React.createElement("linearGradient", { id: "cockpit-area-" + id, x1: 0, y1: 0, x2: 0, y2: 1 },
						React.createElement("stop", { offset: 0, stopColor: stroke, stopOpacity: 0.22 }),
						React.createElement("stop", { offset: 1, stopColor: stroke, stopOpacity: 0 }))),
				React.createElement("path", { d: area, fill: "url(#cockpit-area-" + id + ")" }),
				React.createElement("polyline", { points: line, fill: "none", stroke, strokeWidth: 2, strokeLinejoin: "round", strokeLinecap: "round" }),
				React.createElement("circle", { cx: last[0], cy: last[1], r: 4, fill: stroke }),
				React.createElement("text", { x: PAD, y: H - 6, fontSize: 11, fill: "var(--dsw-alias-label-secondary)" }, points[0].label),
				React.createElement("text", { x: W - PAD, y: H - 6, fontSize: 11, fill: "var(--dsw-alias-label-secondary)", textAnchor: "end" }, points[points.length - 1].label),
				React.createElement("text", { x: W - PAD, y: 14, fontSize: 11, fill: stroke, textAnchor: "end" }, label));
		}
		function ActionsCard({ actions }) {
			return React.createElement("div", { className: "cockpit-card" },
				React.createElement("div", { className: "cockpit-card-title" }, "行动清单（" + actions.length + " 项）"),
				actions.map((a) => React.createElement("div", { key: a.id, className: "action-row" },
					React.createElement("span", { className: "prio-badge prio-" + a.priority.toLowerCase() }, a.priority),
					React.createElement("span", { className: "action-title" }, a.title),
					React.createElement("span", { className: "action-meta" }, a.owner + " · " + a.due),
					React.createElement("span", { className: "status-badge" }, a.status))));
		}
		function AnomaliesCard({ anomalies }) {
			const taskOf = (id) => id === "A1" ? "T1" : id === "A2" ? "T2" : id === "A3" ? "T3" : id === "A4" ? "T4" : id === "A5" ? "T5" : id === "A6" ? "T6" : "—";
			return React.createElement("div", { className: "cockpit-card" },
				React.createElement("div", { className: "cockpit-card-title" }, "异常与机会（" + anomalies.length + "）"),
				anomalies.map((a) => React.createElement("div", { key: a.id, className: "insight" },
					React.createElement("div", { className: "insight-dot dot-" + a.level }),
					React.createElement("div", { className: "anomaly-body" },
						React.createElement("div", { className: "insight-title" }, a.title),
						React.createElement("div", { className: "insight-detail" }, a.detail),
						React.createElement("div", { className: "anomaly-tag" }, "关联任务：" + taskOf(a.id))))));
		}
		function IntegrityCard({ integrity }) {
			return React.createElement("div", { className: "cockpit-card" },
				React.createElement("div", { className: "cockpit-card-title" }, "数据完整性"),
				React.createElement("div", { className: "integrity-grid" },
					React.createElement("div", null,
						React.createElement("div", { className: "integrity-sub" }, "缺失数据（" + integrity.missing.length + "）"),
						integrity.missing.map((m, i) => React.createElement("div", { key: i, className: "integrity-item" },
							React.createElement("div", { className: "integrity-name" }, m.source + "：" + m.scope),
							React.createElement("div", { className: "integrity-desc" }, m.impact + "（自 " + m.since + "）")))),
					React.createElement("div", null,
						React.createElement("div", { className: "integrity-sub" }, "无法计算的指标（" + integrity.uncomputable.length + "）"),
						integrity.uncomputable.map((u, i) => React.createElement("div", { key: i, className: "integrity-item" },
							React.createElement("div", { className: "integrity-name" }, u.metric),
							React.createElement("div", { className: "integrity-desc" }, u.reason))))));
		}
		function BriefModal({ brief, onClose }) {
			const [showMd, setShowMd] = React.useState(false);
			return React.createElement("div", { className: "brief-mask" },
				React.createElement("div", { className: "brief-modal" },
					React.createElement("div", { className: "brief-head" },
						React.createElement("div", null,
							React.createElement("div", { className: "brief-title" }, brief.title),
							React.createElement("div", { className: "brief-sub" }, brief.date + " · 一页经营简报")),
						React.createElement("div", { className: "brief-actions" },
							React.createElement("button", { className: "cockpit-refresh", onClick: () => setShowMd(!showMd) }, showMd ? "返回视图" : "查看 Markdown"),
							React.createElement("button", { className: "brief-close", onClick: onClose }, "✕")))),
					showMd ? React.createElement("pre", { className: "brief-md" }, brief.markdown)
					: React.createElement("div", { className: "brief-body" },
						React.createElement("div", { className: "brief-verdict" }, brief.verdict),
						React.createElement("div", { className: "brief-numbers" },
							brief.numbers.map((n, i) => React.createElement("div", { key: i, className: "brief-num" },
								React.createElement("div", { className: "brief-num-label" }, n.label),
								React.createElement("div", { className: "brief-num-value" }, n.value),
								React.createElement("div", { className: "brief-num-delta" }, n.delta)))),
						React.createElement("div", { className: "brief-section" },
							React.createElement("div", { className: "brief-section-title" }, "今日要点"),
							brief.points.map((pnt, i) => React.createElement("div", { key: i, className: "brief-point" }, "· " + pnt.text))),
						React.createElement("div", { className: "brief-section" },
							React.createElement("div", { className: "brief-section-title" }, "首要行动"),
							brief.topActions.map((a) => React.createElement("div", { key: a.id, className: "brief-point" }, "· [" + a.priority + "] " + a.title + "（" + a.owner + "，" + a.due + "）"))),
						React.createElement("div", { className: "brief-section" },
							React.createElement("div", { className: "brief-section-title" }, "风险与关注"),
							brief.risks.map((r, i) => React.createElement("div", { key: i, className: "brief-point" }, "· " + r.title + "：" + r.detail))),
						React.createElement("div", { className: "brief-caveats" },
							brief.caveats.map((c, i) => React.createElement("div", { key: i, className: "brief-caveat" }, "※ " + c)))));
		}
		function DataConfigCard({ onImported }) {
			const [cfg, setCfg] = React.useState(null);
			const [path, setPath] = React.useState("");
			const [thr, setThr] = React.useState("1.5");
			const [store, setStore] = React.useState("");
			const [busy, setBusy] = React.useState(null);
			const [msg, setMsg] = React.useState(null);
			const refresh = () => {
				api("/cockpit/api/config").then((r) => {
					setCfg(r.config);
					setPath(r.config.csvPath);
					setThr(String(r.config.roiThreshold));
					setStore(r.config.storeName);
				}).catch(() => {});
			};
			React.useEffect(refresh, []);
			const run = (label, promise) => {
				setBusy(label);
				setMsg(null);
				promise.then((r) => {
					setBusy(null);
					if (r && r.ok === false) { setMsg("操作失败：" + (r.error || "未知错误")); return; }
					setMsg(label + "完成" + (r && r.covered ? "：覆盖 " + r.covered + " 行 / " + r.dates + " 个日期" : "") + (r && r.path ? " → " + r.path : ""));
					refresh();
					if (onImported) onImported();
				}).catch((e) => { setBusy(null); setMsg("操作失败：" + String(e && e.message || e)); });
			};
			const onImport = () => run("导入", api("/cockpit/api/import-csv", { path: path.trim() || undefined }));
			const onClear = () => run("恢复 Mock", api("/cockpit/api/import-csv", { clear: true }));
			const onTemplate = () => run("生成示例", api("/cockpit/api/export-template"));
			const onSave = () => run("保存配置", api("/cockpit/api/config", { roiThreshold: parseFloat(thr), storeName: store, csvPath: path.trim() }));
			return React.createElement("div", { className: "cockpit-card" },
				React.createElement("div", { className: "cockpit-card-title" }, "数据源与配置"),
				React.createElement("div", { className: "cfg-status" },
					React.createElement("span", { className: "source-chip " + (cfg && cfg.dataSource === "csv" ? "source-stale" : "") }, cfg && cfg.dataSource === "csv" ? "CSV 数据源" : "内置 Mock 数据"),
					cfg && cfg.dataSource === "csv" ? React.createElement("span", { className: "cfg-file" }, "当前文件：" + cfg.csvPath.split("/").pop()) : React.createElement("span", { className: "cfg-file" }, "未导入 CSV，全部指标由 mock 生成")),
				React.createElement("div", { className: "cfg-row" },
					React.createElement("input", { className: "cfg-input cfg-path", value: path, onChange: (e) => setPath(e.target.value), placeholder: "CSV 文件路径（date,channel,visitors,conv,aov,spend）" }),
					React.createElement("button", { className: "cockpit-refresh", onClick: onImport, disabled: busy !== null }, busy === "导入" ? "导入中…" : "导入 CSV"),
					React.createElement("button", { className: "cockpit-refresh", onClick: onTemplate, disabled: busy !== null }, "生成示例"),
					React.createElement("button", { className: "cockpit-refresh", onClick: onClear, disabled: busy !== null }, "恢复 Mock")),
				React.createElement("div", { className: "cfg-row" },
					React.createElement("label", { className: "cfg-label" }, "ROI 阈值"),
					React.createElement("input", { className: "cfg-input cfg-small", type: "number", step: "0.1", value: thr, onChange: (e) => setThr(e.target.value) }),
					React.createElement("label", { className: "cfg-label" }, "店铺名称"),
					React.createElement("input", { className: "cfg-input cfg-mid", value: store, onChange: (e) => setStore(e.target.value) }),
					React.createElement("button", { className: "cockpit-refresh", onClick: onSave, disabled: busy !== null }, "保存配置")),
				msg ? React.createElement("div", { className: "cfg-msg" }, msg) : null);
		}
		function CockpitView() {
			const [state, setState] = React.useState({ loading: true, error: null, data: null, p2: null, brief: null, briefOpen: false });
			const load = () => {
				setState((s) => ({ ...s, loading: true, error: null }));
				api("/cockpit/api/dashboard").then((data) => {
					setState((s) => ({ ...s, loading: false, error: null, data }));
				}).catch((err) => {
					setState((s) => ({ ...s, loading: false, error: String(err && err.message || err), data: null }));
				});
			};
			React.useEffect(load, []);
			React.useEffect(() => {
				api("/cockpit/api/p2").then((p2) => setState((s) => ({ ...s, p2 }))).catch(() => {});
			}, []);
			const refreshAll = () => {
				load();
				api("/cockpit/api/p2").then((p2) => setState((s) => ({ ...s, p2 }))).catch(() => {});
			};
			const openBrief = () => {
				if (state.brief) { setState((s) => ({ ...s, briefOpen: true })); return; }
				api("/cockpit/api/brief").then((brief) => setState((s) => ({ ...s, brief, briefOpen: true }))).catch(() => {});
			};
			if (state.loading && !state.data) {
				return React.createElement("div", { className: "cockpit-root" }, React.createElement("div", { className: "cockpit-loading" }, "经营数据加载中…"));
			}
			if (state.error && !state.data) {
				return React.createElement("div", { className: "cockpit-root" },
					React.createElement("div", { className: "cockpit-error" }, "加载失败：" + state.error),
					React.createElement("div", { className: "cockpit-error-actions" },
						React.createElement("button", { className: "cockpit-refresh", onClick: load }, "重试")));
			}
			const d = state.data;
			const p2 = state.p2;
			const gmvPoints = d.trend.map((p) => ({ label: p.date, v: p.gmv }));
			const profitPoints = d.trend.map((p) => ({ label: p.date, v: p.profit }));
			return React.createElement("div", { className: "cockpit-root" },
				React.createElement("div", { className: "cockpit-header" },
					React.createElement("div", { className: "cockpit-logo" }, "电"),
					React.createElement("div", { className: "cockpit-title-wrap" },
						React.createElement("div", { className: "cockpit-title" }, "电商经营驾驶舱"),
						React.createElement("div", { className: "cockpit-sub" }, d.store + " · 数据日期 " + d.asOf + " · 更新时间 08:30" + (d.dataSource === "csv" ? " · 数据源 CSV" : ""))),
					React.createElement("div", { className: "cockpit-header-right" },
						React.createElement("button", { className: "cockpit-refresh", onClick: openBrief }, "生成简报"),
						React.createElement("button", { className: "cockpit-refresh", onClick: refreshAll }, state.loading ? "刷新中…" : "刷新"))),
				React.createElement("div", { className: "kpi-grid" },
					d.kpis.map((k) => React.createElement(KpiCard, { key: k.key, kpi: k })),
					React.createElement("div", { className: "kpi-card kpi-stock" },
						React.createElement("div", { className: "kpi-label" }, "缺货预警"),
						React.createElement("div", { className: "kpi-value" }, d.stockWarn),
						React.createElement("div", { className: "kpi-delta " + (d.stockWarn > 0 ? "cockpit-warn" : "cockpit-flat") }, d.stockWarn > 0 ? "个 SKU 低于安全线" : "库存健康"))),
				React.createElement("div", { className: "charts-row" },
					React.createElement("div", { className: "cockpit-card" },
						React.createElement("div", { className: "cockpit-card-title" }, "近 14 天销售趋势"),
						React.createElement(TrendChart, { id: "gmv", points: gmvPoints, stroke: "#2563EB", label: "GMV" }),
						React.createElement(TrendChart, { id: "profit", points: profitPoints, stroke: "#16A34A", label: "毛利" })),
					React.createElement("div", { className: "cockpit-card" },
						React.createElement("div", { className: "cockpit-card-title" }, "渠道分布（今日）"),
						d.channels.map((ch) => React.createElement("div", { key: ch.name, className: "channel-row" },
							React.createElement("div", { className: "channel-name" }, ch.name),
							React.createElement("div", { className: "channel-track" },
								React.createElement("div", { className: "channel-bar", style: { width: Math.max(4, Math.round(ch.share * 100)) + "%" } })),
							React.createElement("div", { className: "channel-meta" },
								fmtMoney(ch.gmv) + " · ROI " + ch.roi.toFixed(2) + " · " + fmtDelta(ch.delta)))))),
				React.createElement("div", { className: "cockpit-card" },
					React.createElement("div", { className: "cockpit-card-title" }, "今日要点"),
					d.insights.map((ins, i) => React.createElement("div", { key: i, className: "insight" },
						React.createElement("div", { className: "insight-dot dot-" + ins.level }),
						React.createElement("div", null,
							React.createElement("div", { className: "insight-title" }, ins.title),
							React.createElement("div", { className: "insight-detail" }, ins.detail))))),
				p2 ? React.createElement("div", null,
					React.createElement(ActionsCard, { actions: p2.actions }),
					React.createElement(AnomaliesCard, { anomalies: p2.anomalies }),
					React.createElement(IntegrityCard, { integrity: p2.integrity }),
					React.createElement(DataConfigCard, { onImported: refreshAll }))
				: React.createElement("div", { className: "cockpit-card" },
					React.createElement("div", { className: "cockpit-card-title" }, "异常与行动分析"),
					React.createElement("div", { className: "cockpit-loading" }, "加载中…")),
				React.createElement("div", { className: "cockpit-sources" },
					React.createElement("span", { className: "cockpit-sources-label" }, "数据来源："),
					(p2 ? p2.integrity.sources : d.sources).map((s) => React.createElement("span", { key: s.name, className: "source-chip " + (s.status === "ok" ? "source-ok" : "source-stale") }, s.name + " · " + s.updated + (s.status === "stale" ? "（延迟）" : "")))),
				state.briefOpen && state.brief ? React.createElement(BriefModal, { brief: state.brief, onClose: () => setState((s) => ({ ...s, briefOpen: false })) }) : null);
		}
		function ActionsDock() {
			const [open, setOpen] = React.useState(false);
			const [state, setState] = React.useState({ loading: true, actions: null });
			React.useEffect(() => {
				api("/cockpit/api/actions").then((d) => setState({ loading: false, actions: d })).catch(() => setState({ loading: false, actions: null }));
			}, []);
			const a = state.actions;
			const summary = a ? a.dock : null;
			return React.createElement("div", { className: "dock-actions" },
				React.createElement("button", { className: "dock-actions-btn", onClick: () => setOpen(!open), title: "行动清单" },
					React.createElement("span", { className: "dock-actions-ico" }, "📋"),
					React.createElement("span", { className: "dock-actions-text" }, summary ? "行动清单 · " + summary.open + " 项待办 · 今天到期 " + summary.dueToday + " 项" + (summary.urgent > 0 ? " · 紧急 " + summary.urgent + " 项" : "") : (state.loading ? "行动清单加载中…" : "行动清单暂不可用")),
					React.createElement("span", { className: "dock-actions-toggle" }, open ? "收起 ▴" : "展开 ▾")),
				open && a ? React.createElement("div", { className: "dock-actions-panel" },
					a.actions.map((t) => React.createElement("div", { key: t.id, className: "dock-actions-row" },
						React.createElement("span", { className: "prio-badge prio-" + t.priority.toLowerCase() }, t.priority),
						React.createElement("span", { className: "dock-actions-title" }, t.title),
						React.createElement("span", { className: "dock-actions-owner" }, t.owner + " · " + t.due),
						React.createElement("span", { className: "status-badge" }, t.status))))
				: null);
		}
		function CockpitEntry(props) {
			const [open, setOpen] = React.useState(false);
			const [data, setData] = React.useState(null);
			const toggle = () => {
				const next = !open;
				setOpen(next);
				if (next && !data) {
					api("/cockpit/api/snapshot").then(setData).catch(() => setData(null));
				}
			};
			return React.createElement("div", { className: "cockpit-entry" },
				React.createElement("button", { className: "cockpit-entry-btn", onClick: toggle, title: "电商经营驾驶舱" },
					React.createElement("span", { className: "cockpit-entry-logo" }, "电"),
					props.wide ? React.createElement("span", { className: "cockpit-entry-label" }, "驾驶舱") : null),
				open ? React.createElement("div", { className: "cockpit-pop" },
					React.createElement("div", { className: "cockpit-pop-head" },
						React.createElement("b", null, "经营速览 · " + (data ? data.asOf : "")),
						React.createElement("button", { className: "cockpit-pop-close", onClick: () => setOpen(false) }, "✕")),
					data ? React.createElement("div", { className: "cockpit-pop-body" },
						React.createElement("div", { className: "cockpit-pop-row" }, React.createElement("span", null, "今日销售额"), React.createElement("b", null, fmtMoney(data.gmv) + " " + fmtDelta(data.gmvDelta))),
						React.createElement("div", { className: "cockpit-pop-row" }, React.createElement("span", null, "今日毛利"), React.createElement("b", null, fmtMoney(data.profit))),
						React.createElement("div", { className: "cockpit-pop-row" }, React.createElement("span", null, "推广 ROI"), React.createElement("b", null, data.roi.toFixed(2))),
						React.createElement("div", { className: "cockpit-pop-row" }, React.createElement("span", null, "缺货预警"), React.createElement("b", { className: data.stockWarn > 0 ? "cockpit-warn" : "" }, data.stockWarn + " 个")),
						React.createElement("div", { className: "cockpit-pop-hint" }, "完整视图请在会话顶部点击「驾驶舱」标签"))
					: React.createElement("div", { className: "cockpit-pop-load" }, "加载中…"))
				: null);
		}

		// ── styles (persistent form: document style tag, whale-skin pattern) ──
		const CSS = `
.cockpit-root { padding: 24px 28px 48px; max-width: 1120px; margin: 0 auto; color: var(--dsw-alias-label-primary); font-size: 14px; }
.cockpit-loading, .cockpit-error { padding: 48px; text-align: center; color: var(--dsw-alias-label-secondary); }
.cockpit-error { color: var(--dsw-alias-state-error-primary); }
.cockpit-error-actions { text-align: center; margin-top: -24px; }
.cockpit-header { display: flex; align-items: center; gap: 12px; margin-bottom: 18px; flex-wrap: wrap; }
.cockpit-logo { width: 38px; height: 38px; border-radius: 10px; background: linear-gradient(135deg, #2563EB, #1E40AF); color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 18px; flex: none; }
.cockpit-title { font-size: 19px; font-weight: 700; }
.cockpit-sub { font-size: 12px; color: var(--dsw-alias-label-secondary); margin-top: 2px; }
.cockpit-header-right { margin-left: auto; display: flex; gap: 8px; }
.cockpit-refresh { background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l2); color: var(--dsw-alias-label-primary); border-radius: 8px; padding: 6px 14px; font-size: 13px; cursor: pointer; }
.cockpit-refresh:hover { border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-brand-primary); }
.cockpit-refresh:disabled { opacity: 0.5; cursor: default; }
.kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
@media (max-width: 960px) { .kpi-grid { grid-template-columns: repeat(2, 1fr); } }
.kpi-card { background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; padding: 14px 16px; }
.kpi-label { font-size: 12px; color: var(--dsw-alias-label-secondary); }
.kpi-value { font-size: 23px; font-weight: 700; margin-top: 5px; font-variant-numeric: tabular-nums; }
.kpi-delta { font-size: 12px; margin-top: 5px; }
.cockpit-up { color: #E53E3E; }
.cockpit-down { color: #2F855A; }
.cockpit-flat { color: var(--dsw-alias-label-secondary); }
.cockpit-warn { color: var(--dsw-alias-state-warn-primary); font-weight: 600; }
.charts-row { display: grid; grid-template-columns: 1.7fr 1fr; gap: 12px; margin-top: 12px; }
@media (max-width: 960px) { .charts-row { grid-template-columns: 1fr; } }
.cockpit-card { background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; padding: 16px; margin-top: 12px; }
.cockpit-card-title { font-size: 14px; font-weight: 600; margin-bottom: 8px; }
.cockpit-chart { width: 100%; height: 132px; display: block; }
.channel-row { display: flex; align-items: center; gap: 10px; margin: 9px 0; }
.channel-name { width: 92px; flex: none; font-size: 12px; color: var(--dsw-alias-label-secondary); }
.channel-track { flex: 1; height: 8px; border-radius: 4px; background: var(--dsw-alias-bg-layer-2); overflow: hidden; }
.channel-bar { height: 100%; border-radius: 4px; background: linear-gradient(90deg, #2563EB, #60A5FA); }
.channel-meta { font-size: 11px; color: var(--dsw-alias-label-secondary); white-space: nowrap; }
.insight { display: flex; gap: 10px; padding: 10px 2px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.insight:last-child { border-bottom: none; }
.insight-dot { width: 8px; height: 8px; border-radius: 50%; margin-top: 6px; flex: none; }
.dot-info { background: var(--dsw-alias-brand-primary); }
.dot-warn { background: var(--dsw-alias-state-warn-primary); }
.dot-error { background: var(--dsw-alias-state-error-primary); }
.insight-title { font-weight: 600; font-size: 13px; }
.insight-detail { font-size: 12px; color: var(--dsw-alias-label-secondary); margin-top: 3px; }
.anomaly-body { flex: 1; }
.anomaly-tag { font-size: 11px; color: var(--dsw-alias-brand-primary); margin-top: 4px; }
.action-row { display: flex; align-items: center; gap: 10px; padding: 8px 2px; border-bottom: 1px solid var(--dsw-alias-border-l1); font-size: 13px; }
.action-row:last-child { border-bottom: none; }
.action-title { flex: 1; }
.action-meta { font-size: 11.5px; color: var(--dsw-alias-label-secondary); white-space: nowrap; }
.prio-badge { font-size: 10.5px; font-weight: 700; padding: 2px 7px; border-radius: 999px; color: #fff; flex: none; }
.prio-p0 { background: var(--dsw-alias-state-error-primary); }
.prio-p1 { background: var(--dsw-alias-state-warn-primary); }
.prio-p2 { background: var(--dsw-alias-brand-primary); }
.prio-p3 { background: #94A3B8; }
.status-badge { font-size: 11px; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--dsw-alias-border-l2); color: var(--dsw-alias-label-secondary); white-space: nowrap; }
.integrity-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
@media (max-width: 960px) { .integrity-grid { grid-template-columns: 1fr; } }
.integrity-sub { font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-secondary); margin-bottom: 6px; }
.integrity-item { padding: 6px 0; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.integrity-item:last-child { border-bottom: none; }
.integrity-name { font-size: 12.5px; }
.integrity-desc { font-size: 11.5px; color: var(--dsw-alias-label-secondary); margin-top: 2px; }
.cockpit-sources { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 14px; }
.cockpit-sources-label { font-size: 12px; color: var(--dsw-alias-label-secondary); }
.source-chip { font-size: 11px; padding: 3px 9px; border-radius: 999px; border: 1px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-label-secondary); }
.source-stale { border-color: var(--dsw-alias-state-warn-primary); color: var(--dsw-alias-state-warn-primary); }
.cfg-status { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; font-size: 12.5px; }
.cfg-file { color: var(--dsw-alias-label-secondary); }
.cfg-row { display: flex; align-items: center; gap: 8px; margin: 8px 0; flex-wrap: wrap; }
.cfg-label { font-size: 12px; color: var(--dsw-alias-label-secondary); }
.cfg-input { background: var(--dsw-alias-bg-base); border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; color: var(--dsw-alias-label-primary); padding: 6px 10px; font-size: 12.5px; }
.cfg-input:focus { outline: none; border-color: var(--dsw-alias-brand-primary); }
.cfg-path { flex: 1; min-width: 280px; }
.cfg-small { width: 64px; }
.cfg-mid { flex: 1; max-width: 220px; }
.cfg-msg { font-size: 12px; color: var(--dsw-alias-state-success-primary); margin-top: 6px; }
.brief-mask { position: fixed; inset: 0; background: rgba(8, 18, 40, 0.45); display: flex; align-items: center; justify-content: center; z-index: 1200; padding: 24px; }
.brief-modal { width: min(760px, 94vw); max-height: 88vh; overflow: auto; background: var(--dsw-alias-bg-overlay); border: 1px solid var(--dsw-alias-border-l2); border-radius: 14px; padding: 22px 26px; }
.brief-head { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 14px; }
.brief-title { font-size: 18px; font-weight: 700; }
.brief-sub { font-size: 12px; color: var(--dsw-alias-label-secondary); margin-top: 3px; }
.brief-actions { display: flex; gap: 8px; }
.brief-close { background: none; border: none; color: var(--dsw-alias-label-secondary); font-size: 16px; cursor: pointer; }
.brief-verdict { background: var(--dsw-alias-bg-layer-2); border-radius: 10px; padding: 12px 14px; font-size: 13.5px; line-height: 1.6; margin-bottom: 14px; }
.brief-numbers { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; margin-bottom: 14px; }
@media (max-width: 960px) { .brief-numbers { grid-template-columns: repeat(2, 1fr); } }
.brief-num { background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; padding: 10px 12px; }
.brief-num-label { font-size: 11px; color: var(--dsw-alias-label-secondary); }
.brief-num-value { font-size: 17px; font-weight: 700; margin-top: 3px; }
.brief-num-delta { font-size: 11px; color: var(--dsw-alias-label-secondary); margin-top: 2px; }
.brief-section { margin-bottom: 12px; }
.brief-section-title { font-size: 13px; font-weight: 600; margin-bottom: 6px; }
.brief-point { font-size: 12.5px; line-height: 1.55; padding: 3px 0; color: var(--dsw-alias-label-primary); }
.brief-caveats { border-top: 1px dashed var(--dsw-alias-border-l2); padding-top: 10px; }
.brief-caveat { font-size: 11px; color: var(--dsw-alias-label-secondary); padding: 2px 0; }
.brief-md { white-space: pre-wrap; font-size: 12.5px; line-height: 1.65; background: var(--dsw-alias-bg-layer-2); border-radius: 10px; padding: 14px; overflow: auto; max-height: 62vh; }
.cockpit-entry { position: relative; }
.cockpit-entry-btn { display: flex; align-items: center; gap: 8px; width: 100%; padding: 8px 12px; background: transparent; border: none; color: var(--dsw-alias-label-primary); cursor: pointer; border-radius: 8px; font-size: 13px; }
.cockpit-entry-btn:hover { background: var(--dsw-alias-bg-layer-2); }
.cockpit-entry-logo { width: 20px; height: 20px; border-radius: 6px; background: linear-gradient(135deg, #2563EB, #1E40AF); color: #fff; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; flex: none; }
.cockpit-pop { position: absolute; left: calc(100% + 10px); bottom: 0; width: 300px; background: var(--dsw-alias-bg-overlay); border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; box-shadow: 0 14px 36px rgba(10, 25, 60, 0.25); padding: 14px; z-index: 1000; }
.cockpit-pop-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.cockpit-pop-close { background: none; border: none; color: var(--dsw-alias-label-secondary); cursor: pointer; font-size: 13px; }
.cockpit-pop-row { display: flex; justify-content: space-between; padding: 7px 0; font-size: 13px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.cockpit-pop-row span { color: var(--dsw-alias-label-secondary); }
.cockpit-pop-hint { font-size: 11px; color: var(--dsw-alias-label-secondary); margin-top: 10px; }
.cockpit-pop-load { color: var(--dsw-alias-label-secondary); padding: 12px 0; text-align: center; }
.dock-actions { position: relative; display: flex; justify-content: center; padding: 2px 16px 6px; }
.dock-actions-btn { display: flex; align-items: center; gap: 8px; background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; padding: 6px 14px; font-size: 12.5px; color: var(--dsw-alias-label-primary); cursor: pointer; }
.dock-actions-btn:hover { border-color: var(--dsw-alias-brand-primary); }
.dock-actions-ico { font-size: 13px; }
.dock-actions-toggle { color: var(--dsw-alias-label-secondary); font-size: 11.5px; }
.dock-actions-panel { position: absolute; bottom: calc(100% + 8px); left: 50%; transform: translateX(-50%); width: min(700px, 92vw); background: var(--dsw-alias-bg-overlay); border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; box-shadow: 0 14px 36px rgba(10, 25, 60, 0.25); padding: 12px 14px; z-index: 900; max-height: 62vh; overflow: auto; }
.dock-actions-row { display: flex; align-items: center; gap: 10px; padding: 7px 2px; border-bottom: 1px solid var(--dsw-alias-border-l1); font-size: 12.5px; }
.dock-actions-row:last-child { border-bottom: none; }
.dock-actions-title { flex: 1; }
.dock-actions-owner { color: var(--dsw-alias-label-secondary); font-size: 11.5px; white-space: nowrap; }
`;
		function ensureCss() {
			if (typeof document === "undefined") return;
			const tagId = "@ekzc/dsh-commerce-cockpit/styles";
			if (document.querySelector("style[data-plugin-css=\"" + tagId + "\"]")) return;
			const tag = document.createElement("style");
			tag.dataset.plugin = "@ekzc/dsh-commerce-cockpit";
			tag.dataset.pluginCss = tagId;
			tag.textContent = CSS;
			document.head.appendChild(tag);
		}

		function apply(ctx) {
			ensureCss();
			ctx.effect(() => ctx.theme.overrideTokens("cockpit-brand", {
				"--dsw-alias-brand-primary": { light: "#2563EB", dark: "#3B82F6" },
				"--dsw-alias-bg-base": { light: "#F4F7FC", dark: "#0B1220" },
				"--dsw-alias-bg-layer-1": { light: "#FFFFFF", dark: "#131C2E" },
				"--dsw-alias-bg-layer-2": { light: "#EAF0F9", dark: "#1B2740" },
				"--dsw-alias-bg-overlay": { light: "#FFFFFF", dark: "#16203A" },
				"--dsw-alias-border-l1": { light: "#DCE5F2", dark: "#243450" },
				"--dsw-alias-border-l2": { light: "#C3D2E8", dark: "#33476B" },
				"--dsw-alias-label-primary": { light: "#0F1E3D", dark: "#EEF4FF" },
				"--dsw-alias-label-secondary": { light: "#55688C", dark: "#9DB0D4" },
				"--dsw-alias-state-error-primary": { light: "#D92D20", dark: "#F97066" },
				"--dsw-alias-state-success-primary": { light: "#15803D", dark: "#4ADE80" },
				"--dsw-alias-state-warn-primary": { light: "#B54708", dark: "#FDB022" },
				"--dsw-alias-specific-sidebar-fill": { light: "#0C2340", dark: "#0A1628" },
			}));
			ctx.slots.inject("conversation.view", () => ctx.slots.register(
				{ name: "conversation.view", id: "cockpit", order: 20, label: () => "驾驶舱" },
				() => React.createElement(CockpitView)));
			ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register(
				{ name: "sidebar.footer.action", id: "cockpit-entry", order: 100, label: () => "驾驶舱" },
				(props) => React.createElement(CockpitEntry, { wide: props.wide })));
			ctx.slots.inject("conversation.input.dock", () => ctx.slots.register(
				{ name: "conversation.input.dock", id: "cockpit-actions", order: 30, label: () => "行动清单" },
				() => React.createElement(ActionsDock)));
		}

		exports.apply = apply;
		exports.inject = ["slots", "theme"];
		return module.exports;
	}
});
