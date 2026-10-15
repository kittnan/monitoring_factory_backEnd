import { Client } from "basic-ftp";
import pkg from "xlsx";
const { readFile, utils } = pkg;

import fs from "fs";
import path from "path";
const fsp = fs.promises;

import env from "../../../config/env.js";

import Kv1Model from "../models/kv1.js";
import Kv1Records from "../models/kv1_records.js";

import Kv2Model from "../models/kv2.js";
import Kv2Records from "../models/kv2_records.js";

import Kv3Model from "../models/kv3.js";
import Kv3Records from "../models/kv3_records.js";

import Kv4Model from "../models/kv4.js";
import Kv4Records from "../models/kv4_records.js";

import Kv5Model from "../models/kv5.js";
import Kv5Records from "../models/kv5_records.js";

// Paths and FTP login come from .env
const CSV_DIR = env.csvDir;
const FTP_DIR = env.ftp.remoteDir;

// Each page (kv) reads the CSV logs of one FTP folder
const KVS = [
    { name: "kv1", dir: "log0", Model: Kv1Model, Records: Kv1Records },
    { name: "kv2", dir: "log1", Model: Kv2Model, Records: Kv2Records },
    { name: "kv3", dir: "log2", Model: Kv3Model, Records: Kv3Records },
    { name: "kv4", dir: "log3", Model: Kv4Model, Records: Kv4Records },
    { name: "kv5", dir: "log4", Model: Kv5Model, Records: Kv5Records },
];

// Job timing comes from .env (JOB_* settings)
const FTP_EVERY_MS = env.jobs.ftpEveryMs;
const IMPORT_EVERY_MS = env.jobs.importEveryMs;
const RECONSTRUCT_EVERY_MS = env.jobs.reconstructEveryMs;
// Readings move from kv* to kv*_records once they are this old
const RECONSTRUCT_AFTER_MS = 24 * 3600 * 1000;
// Upper bound per run so a large backlog can't block the event loop for long
const RECONSTRUCT_MAX_PER_RUN = env.jobs.reconstructMaxPerRun;
// CSV columns: A = DATA No, B = DATE, C = TIME, devices from D (__EMPTY_2)
const COL_START = 2;

let methods = {};
let timers = [];
const busy = {};

const now = () => new Date().toLocaleString();
const log = (...args) => console.log(now(), ...args);
const logError = (job, err) => console.error(now(), `[${job}]`, (err && err.stack) || err);

// Runs `fn` unless the previous run of the same job is still going.
// Never throws, so a DB/FTP/file error can't crash the process.
methods.runOnce = async(job, fn) => {
    if (busy[job]) return;
    busy[job] = true;
    try {
        await fn();
    } catch (err) {
        logError(job, err);
    } finally {
        busy[job] = false;
    }
};

methods.interval = () => {
    methods.stop();
    const every = (ms, job, fn) => {
        timers.push(setInterval(() => methods.runOnce(job, fn), ms));
    };

    every(FTP_EVERY_MS, "ftp", methods.kvFTP);
    for (const kv of KVS) {
        every(IMPORT_EVERY_MS, `import ${kv.name}`, () => methods.kv(kv.Model, kv.dir, kv.Records));
        every(RECONSTRUCT_EVERY_MS, `reconstruct ${kv.name}`, () =>
            methods.reconstruct(kv.Model, kv.Records)
        );
    }
    log(`jobs started: ftp every ${FTP_EVERY_MS / 1000}s, import every ${IMPORT_EVERY_MS / 1000}s, reconstruct every ${RECONSTRUCT_EVERY_MS / 1000}s`);
};

methods.stop = () => {
    timers.forEach(clearInterval);
    timers = [];
};

// Download every CSV waiting on the FTP into CSV_DIR, then remove it from the FTP.
// Files are written as *.part and renamed when complete, so the importer never
// sees a half-written file.
let fileCounter = 0;
methods.kvFTP = async(client = new Client(env.ftp.timeout)) => {
    try {
        await client.access({
            host: env.ftp.host,
            user: env.ftp.user,
            password: env.ftp.password,
            secure: false,
        });
        await fsp.mkdir(CSV_DIR, { recursive: true });

        for (const kv of KVS) {
            const remoteDir = `${FTP_DIR}/${kv.dir}`;
            const files = (await client.list(remoteDir)).filter((f) => f.isFile);
            for (const file of files) {
                const name = `${kv.dir}_${Date.now()}_${String(fileCounter++ % 1000).padStart(3, "0")}.csv`;
                const target = path.join(CSV_DIR, name);
                const part = `${target}.part`;
                try {
                    await client.downloadTo(part, `${remoteDir}/${file.name}`);
                    await fsp.rename(part, target);
                } catch (err) {
                    await fsp.rm(part, { force: true });
                    throw err;
                }
                // Only remove from the FTP once the local copy is complete
                await client.remove(`${remoteDir}/${file.name}`);
                log(`ftp downloaded ${kv.dir}/${file.name} -> ${name}`);
            }
        }
    } finally {
        client.close();
    }
};

// Import every pending CSV of one page, oldest first
methods.kv = async(KVModel, directory, KVRecords) => {
    let files;
    try {
        files = await fsp.readdir(CSV_DIR);
    } catch (err) {
        if (err.code === "ENOENT") return; // nothing downloaded yet
        throw err;
    }
    const mine = files
        .filter((f) => f.toLowerCase().includes(directory) && f.toLowerCase().endsWith(".csv"))
        .sort();
    for (const file of mine) {
        await methods.importFile(KVModel, path.join(CSV_DIR, file), KVRecords);
    }
};

// Insert every row newer than what is already stored, then delete the file.
// If the insert fails the file stays and is retried on the next run.
methods.importFile = async(KVModel, file, KVRecords) => {
    const rows = methods.parseCsv(file);
    if (rows.length) {
        const latest = async(Model) => {
            if (!Model) return -Infinity;
            const doc = await Model.findOne({}, { date: 1 }).sort({ date: -1 }).lean();
            return doc ? new Date(doc.date).getTime() : -Infinity;
        };
        // Records already moved to kv*_records count as stored too
        const lastTime = Math.max(await latest(KVModel), await latest(KVRecords));
        const fresh = rows.filter((r) => r.date > lastTime);
        if (fresh.length) {
            const docs = [];
            for (const row of fresh) {
                row.values.forEach((v, index) => {
                    docs.push({ seq: index, key: v.key, value: v.value, date: row.date });
                });
            }
            await KVModel.insertMany(docs);
            log(`imported ${fresh.length} row(s) from ${path.basename(file)}`);
        }
    }
    await fsp.rm(file, { force: true });
};

// CSV -> [{ date: ms, values: [{ key, value }] }] sorted by date
methods.parseCsv = (file) => {
    const workBook = readFile(file);
    const ws = workBook.Sheets[workBook.SheetNames[0]];
    if (!ws || !ws["!ref"] || ws["!ref"] === "A1") return [];

    const obj = utils.sheet_to_json(ws);
    if (obj.length < 2) return [];

    // obj[0] is the header row with the device names
    const keys = Array.from({ length: methods.columnLoop(obj) }, (_, i) =>
        obj[0]["__EMPTY_" + (i + COL_START)] || 0
    );

    const rows = [];
    for (let i = 1; i < obj.length; i++) {
        const sheetRow = (obj[i].__rowNum__ !== undefined ? obj[i].__rowNum__ : i + 1) + 1;
        const date = methods.parseDate(ws[`B${sheetRow}`]?.w, ws[`C${sheetRow}`]?.v);
        if (date === null) continue;
        const values = keys.map((key, index) => {
            const raw = obj[i]["__EMPTY_" + (index + COL_START)];
            return { key, value: !isNaN(raw) ? Number(raw) : 0 };
        });
        rows.push({ date, values });
    }
    return rows.sort((a, b) => a.date - b.date);
};

// Number of device columns in the header row
methods.columnLoop = (obj) => {
    let i = COL_START;
    while (i < COL_START + 100 && obj[0]["__EMPTY_" + i]) i++;
    return i - COL_START;
};

// DATE is shown by xlsx as m/d/yy, TIME as HH:mm:ss
methods.parseDate = (strDate, strTime) => {
    if (!strDate || !strTime || typeof strTime !== "string") return null;
    const [m, d, y] = String(strDate).split("/").map(Number);
    const [h, min, s] = strTime.split(":").map(Number);
    if ([m, d, y, h, min].some((n) => Number.isNaN(n))) return null;
    const year = y < 100 ? 2000 + y : y;
    const time = new Date(year, m - 1, d, h, min, s || 0).getTime();
    return Number.isNaN(time) ? null : time;
};

// Next seq for kv*_records. Uses the highest seq (not the count), so numbers
// stay unique after the auto backup deletes old records.
methods.nextSeq = async(KVRecord) => {
    const last = await KVRecord.findOne({}, { seq: 1 }).sort({ seq: -1 }).lean();
    return last && !Number.isNaN(Number(last.seq)) ? Number(last.seq) + 1 : 1;
};

// Merge readings older than 24h into one kv*_records row per timestamp.
// Catches up on a backlog (up to RECONSTRUCT_MAX_PER_RUN timestamps per run).
methods.reconstruct = async(KVModel, KVRecord) => {
    const cutoff = new Date(Date.now() - RECONSTRUCT_AFTER_MS);
    let moved = 0;
    while (moved < RECONSTRUCT_MAX_PER_RUN) {
        const first = await KVModel.findOne({ date: { $lt: cutoff } }, { date: 1 })
            .sort({ date: 1 })
            .lean();
        if (!first) break;

        const date = first.date;
        const readings = await KVModel.find({ date }).lean();
        const obj = { seq: await methods.nextSeq(KVRecord), date };
        for (const r of readings) obj[r.key] = r.value;

        await KVRecord.create(obj);
        await KVModel.deleteMany({ date });
        moved++;
    }
    if (moved > 1) log(`reconstruct moved ${moved} timestamps into ${KVRecord.collection.name}`);
};

export default methods;
