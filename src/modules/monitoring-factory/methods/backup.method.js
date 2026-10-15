import pkg from "xlsx";
const { readFile, writeFile, utils } = pkg;

import fs from "fs";
import path from "path";
const fsp = fs.promises;

import config from "../config/backup.js";
import Kv1Records from "../models/kv1_records.js";
import Kv2Records from "../models/kv2_records.js";
import Kv3Records from "../models/kv3_records.js";
import Kv4Records from "../models/kv4_records.js";
import Kv5Records from "../models/kv5_records.js";

export const KV_MODELS = {
    kv1: Kv1Records,
    kv2: Kv2Records,
    kv3: Kv3Records,
    kv4: Kv4Records,
    kv5: Kv5Records,
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SHEET = "data";

let methods = {};
let timer;
let lastRunDay = null;
const running = {};
methods.lastRun = null;

const pad = (n) => String(n).padStart(2, "0");
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const stamp = (d) =>
    `${dayKey(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

methods.isKv = (kv) => Object.prototype.hasOwnProperty.call(KV_MODELS, kv);
methods.isDate = (date) => DATE_RE.test(date);

methods.kvDir = (kv, dir = config.dir) => path.join(dir, kv);
methods.filePath = (kv, date, dir = config.dir) => path.join(methods.kvDir(kv, dir), `${date}.xlsx`);

// Start of the local day `days` before `now`; records older than this are complete
methods.cutoff = (now = new Date(), days = config.completeAfterDays) =>
    new Date(now.getFullYear(), now.getMonth(), now.getDate() - days + 1);

// Record document -> spreadsheet row: date first, devices sorted, _id last
const toRow = (rec) => {
    const row = { date: stamp(new Date(rec.date)) };
    Object.keys(rec)
        .filter((k) => k !== "_id" && k !== "date" && k !== "seq")
        .sort()
        .forEach((k) => (row[k] = rec[k]));
    row._id = String(rec._id);
    return row;
};

const readRows = (file) => {
    const wb = readFile(file);
    const ws = wb.Sheets[SHEET] || wb.Sheets[wb.SheetNames[0]];
    return utils.sheet_to_json(ws, { defval: null });
};

const writeRows = async(file, rows) => {
    const headers = ["date"];
    const devices = new Set();
    rows.forEach((r) => Object.keys(r).forEach((k) => k !== "date" && k !== "_id" && devices.add(k)));
    headers.push(...[...devices].sort(), "_id");

    const ws = utils.json_to_sheet(rows, { header: headers });
    const wb = { Sheets: {
            [SHEET]: ws }, SheetNames: [SHEET] };
    const tmp = `${file}.tmp.xlsx`;
    writeFile(wb, tmp);
    await fsp.rename(tmp, file);
};

const indexPath = (kv, dir) => path.join(methods.kvDir(kv, dir), "index.json");

const readIndex = async(kv, dir) => {
    try {
        return JSON.parse(await fsp.readFile(indexPath(kv, dir), "utf8"));
    } catch {
        return {};
    }
};

const writeIndex = async(kv, dir, index) => {
    await fsp.writeFile(indexPath(kv, dir), JSON.stringify(index, null, 2));
};

/**
 * Back up every complete day of `kv` records into one xlsx per day, then
 * delete exactly the records that were verified in the written file.
 * Re-running is safe: late records are merged into the existing day file.
 */
methods.backupKv = async(kv, { Model = KV_MODELS[kv], dir = config.dir, now = new Date() } = {}) => {
    if (running[kv]) return { kv, skipped: "already running" };
    running[kv] = true;
    const result = { kv, files: [], backedUp: 0, deleted: 0 };
    try {
        const records = await Model.find({ date: { $lt: methods.cutoff(now) } })
            .sort({ date: 1 })
            .lean();
        if (records.length === 0) return result;

        const byDay = new Map();
        for (const rec of records) {
            const key = dayKey(new Date(rec.date));
            if (!byDay.has(key)) byDay.set(key, []);
            byDay.get(key).push(rec);
        }

        await fsp.mkdir(methods.kvDir(kv, dir), { recursive: true });
        const index = await readIndex(kv, dir);

        for (const [date, recs] of byDay) {
            const file = methods.filePath(kv, date, dir);
            const newRows = recs.map(toRow);

            // Merge with an existing file (late records, or a re-run)
            let rows = newRows;
            if (fs.existsSync(file)) {
                const existing = readRows(file);
                const seen = new Set(existing.map((r) => String(r._id)));
                rows = existing.concat(newRows.filter((r) => !seen.has(r._id)));
                rows.sort((a, b) => String(a.date).localeCompare(String(b.date)));
            }
            await writeRows(file, rows);

            // Verify before deleting anything
            const written = new Set(readRows(file).map((r) => String(r._id)));
            const ids = recs.map((r) => r._id).filter((id) => written.has(String(id)));
            if (ids.length !== recs.length) {
                throw new Error(`${kv} ${date}: verification failed (${ids.length}/${recs.length})`);
            }

            const del = await Model.deleteMany({ _id: { $in: ids } });
            const stat = await fsp.stat(file);
            index[date] = { date, rows: rows.length, size: stat.size, updatedAt: new Date().toISOString() };
            await writeIndex(kv, dir, index);

            result.files.push(date);
            result.backedUp += recs.length;
            result.deleted += (del && del.deletedCount) || 0;
        }
        return result;
    } catch (error) {
        console.error(`backup ${kv} failed:`, error);
        result.error = error.message;
        return result;
    } finally {
        running[kv] = false;
    }
};

methods.backupAll = async(opts = {}) => {
    const results = [];
    for (const kv of Object.keys(KV_MODELS)) {
        results.push(await methods.backupKv(kv, opts));
    }
    methods.lastRun = { at: new Date().toISOString(), results };
    console.log("backup finished", JSON.stringify(results));
    return results;
};

// List backup files for a kv, newest first
methods.list = async(kv, dir = config.dir) => {
    let names = [];
    try {
        names = await fsp.readdir(methods.kvDir(kv, dir));
    } catch {
        return [];
    }
    const index = await readIndex(kv, dir);
    const items = [];
    for (const name of names) {
        const date = name.replace(/\.xlsx$/, "");
        if (!name.endsWith(".xlsx") || !methods.isDate(date)) continue;
        const stat = await fsp.stat(path.join(methods.kvDir(kv, dir), name));
        const meta = index[date] || {};
        items.push({
            date,
            rows: meta.rows != null ? meta.rows : null,
            size: stat.size,
            updatedAt: meta.updatedAt || stat.mtime.toISOString(),
        });
    }
    return items.sort((a, b) => b.date.localeCompare(a.date));
};

methods.view = (kv, date, dir = config.dir) => {
    const file = methods.filePath(kv, date, dir);
    if (!fs.existsSync(file)) return null;
    const rows = readRows(file).map((r) => {
        const { _id, ...rest } = r;
        return rest;
    });
    const columns = rows.length ? Object.keys(rows[0]).filter((k) => k !== "date") : [];
    return { kv, date, columns, rows };
};

// Run once a day at config.hour:config.minute, and catch up on start-up
methods.schedule = () => {
    clearInterval(timer);
    const tick = () => {
        const now = new Date();
        const today = dayKey(now);
        const due = now.getHours() * 60 + now.getMinutes() >= config.hour * 60 + config.minute;
        if (due && lastRunDay !== today) {
            lastRunDay = today;
            methods.backupAll();
        }
    };
    timer = setInterval(tick, 30 * 1000);
    setTimeout(tick, 60 * 1000);
};

export default methods;
