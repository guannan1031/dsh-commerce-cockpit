import test from "node:test";
import assert from "node:assert/strict";
import { CSV_HEADERS, importFilePath, parseImportedCsv } from "../index.js";

const validCsv = [
	CSV_HEADERS.join(","),
	"2026-08-15,天猫,tmall-main,搜索,100,0,0,0",
].join("\n");

test("imports the minimum multi-store schema and preserves zero values", () => {
	const rows = parseImportedCsv(validCsv);
	assert.equal(rows.length, 1);
	assert.equal(rows[0].businessDate, "2026-08-15");
	assert.equal(rows[0].storeId, "tmall-main");
	assert.equal(rows[0].orders, 0);
	assert.equal(rows[0].visitors, 0);
	assert.equal(rows[0].adSpend, 0);
});

test("keeps blank values unavailable instead of converting them to zero", () => {
	const rows = parseImportedCsv(validCsv.replace(",100,0,0,0", ",100,,0,0"));
	assert.equal(rows[0].orders, null);
	assert.equal(rows[0].visitors, 0);
});

test("rejects a missing required header", () => {
	assert.throws(() => parseImportedCsv("business_date,platform,store_id,channel\n2026-08-15,天猫,a,搜索"), /缺少字段/);
});

test("rejects duplicate business date/store/channel rows", () => {
	const duplicate = validCsv + "\n2026-08-15,天猫,tmall-main,搜索,120,1,2,3";
	assert.throws(() => parseImportedCsv(duplicate), /重复/);
});

test("rejects invalid dates and negative numbers", () => {
	assert.throws(() => parseImportedCsv(validCsv.replace("2026-08-15", "08-15")), /YYYY-MM-DD/);
	assert.throws(() => parseImportedCsv(validCsv.replace("2026-08-15", "2026-02-30")), /YYYY-MM-DD/);
	assert.throws(() => parseImportedCsv(validCsv.replace(",100,", ",-1,")), /非负数字/);
});

test("rejects absolute paths and traversal", () => {
	assert.throws(() => importFilePath("/tmp/data.csv"), /文件名/);
	assert.throws(() => importFilePath("../data.csv"), /文件名/);
	assert.throws(() => importFilePath("data.txt"), /CSV/);
});
