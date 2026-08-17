# 电商经营驾驶舱 · Ecommerce Business Cockpit

> 面向电商老板的 DeepSeek Harness 常驻插件 —— 从"数据报表"到"决策驾驶舱"。
> A persistent DeepSeek Harness plugin that turns raw ecommerce data into daily decisions.

回答老板每天早上问的四个问题 / Answers the four questions a founder asks every morning:
**今天哪里赚钱/亏钱 → 为什么变 → 下一步做什么 → 谁负责、何时完成**

!<img width="2340" height="1154" alt="image" src="https://github.com/user-attachments/assets/b90ed7bb-c6eb-4135-90ce-47565e82a9b0" /><img width="2262" height="1156" alt="image" src="https://github.com/user-attachments/assets/546564e4-6183-4816-8678-a2f53252712e" /><img width="2274" height="1028" alt="image" src="https://github.com/user-attachments/assets/be463eb3-cd2f-434f-9114-3d67e7a161e9" /><img width="2288" height="1020" alt="image" src="https://github.com/user-attachments/assets/2b3b5d02-0b5d-4854-a484-fd2dcbae1c97" />
<img width="1450" height="526" alt="image" src="https://github.com/user-attachments/assets/002b6707-f0f7-44a0-b577-b8f2c4af6841" />





## 功能亮点 / Highlights

- **经营总览 Overview**：今日 GMV / 毛利 / 推广 ROI / 转化率 / 客单价 / 缺货预警 + 14 天趋势 + 渠道分布
- **异常与机会 Anomalies**：四因子归因（流量/转化/客单）、推广浪费告警、缺货明细、竞品变化
- **行动清单 Actions**：异常自动生成任务（优先级 / 负责人 / 截止时间）
- **老板汇报 Brief**：一键生成一页经营简报（Markdown 导出）
- **对话分析 Q&A**：`cockpit_ask` — "天猫今天为什么下滑？" 直接问
- **数据接入 Data**：mock 演示 + CSV 导入覆盖（`date,channel,visitors,conv,aov,spend`）

## 安装 / Install

DeepSeek Harness Web profile 下，npm 包：`@guannan1031/dsh-commerce-cockpit`（已发布）+ `cordis.patch.yml` 一行，重启即常驻。详见安装说明。

## 定制与合作 / Customization

公开包为**混淆演示版**（功能完整可体验）。深度定制请直接联系作者：

**微信 lijieai2025（备注：电商驾驶舱定制）· guannan1031@gmail.com · guannan1031@163.com**

- 真实店铺/平台数据接入（天猫/京东/拼多多/抖音/Shopify API 或报表）
- 私有归因逻辑 / 专属报表 / 多店铺多品牌
- 源码授权（私有交付 + 部署支持）
- 持续迭代服务（新渠道/新指标/新规则）

> ⚠️ 演示数据为 2026-08-15 mock 快照，接入真实数据前请勿据此决策。
