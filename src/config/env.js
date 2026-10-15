// Loads KEY=VALUE pairs from the backend's .env file into process.env.
// Import this first (see app.js) so every config module sees the values.
// Real environment variables win over .env; values are taken literally,
// so Windows paths like D:\MonitoringFactoryCSV need no escaping.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const envFile = path.join(root, '.env');

if (fs.existsSync(envFile)) {
    const lines = fs.readFileSync(envFile, 'utf8').split(/\r?\n/);
    for (const raw of lines) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        const eq = line.indexOf('=');
        if (eq === -1) continue;
        const key = line.slice(0, eq).trim();
        let value = line.slice(eq + 1).trim();
        const quoted = value.match(/^(['"])(.*)\1$/);
        if (quoted) value = quoted[2];
        else value = value.replace(/\s+#.*$/, '');
        if (!(key in process.env)) process.env[key] = value;
    }
} else {
    console.warn(`No .env file at ${envFile} - copy .env.example to .env and fill it in`);
}

const env = (key, fallback) => {
    const value = process.env[key];
    return value === undefined || value === '' ? fallback : value;
};

const required = (key) => {
    const value = env(key);
    if (value === undefined) throw new Error(`Missing ${key} in .env (see .env.example)`);
    return value;
};

const number = (key, fallback) => {
    const value = Number(env(key, fallback));
    if (Number.isNaN(value)) throw new Error(`${key} must be a number`);
    return value;
};

const positive = (key, fallback) => {
    const value = number(key, fallback);
    if (!(value > 0)) throw new Error(`${key} must be greater than 0`);
    return value;
};

const time = (key, fallback) => {
    const [h, m] = String(env(key, fallback)).split(':').map(Number);
    if (!(h >= 0 && h < 24 && m >= 0 && m < 60)) throw new Error(`${key} must be HH:MM`);
    return { hour: h, minute: m };
};

export default {
    port: number('PORT', 4014),

    mongo: {
        uri: required('MONGODB_URI'),
        db: env('MONGODB_DB', 'monitoring-factory'),
    },

    oracle: {
        user: env('ORACLE_USER'),
        password: env('ORACLE_PASSWORD'),
        connectString: env('ORACLE_CONNECT_STRING'),
    },

    ftp: {
        host: required('FTP_HOST'),
        user: required('FTP_USER'),
        password: required('FTP_PASSWORD'),
        remoteDir: env('FTP_REMOTE_DIR', '/MMC'),
        timeout: number('FTP_TIMEOUT_MS', 10000),
    },

    csvDir: env('CSV_DIR', 'D:\\MonitoringFactoryCSV\\ftpData'),

    jobs: {
        ftpEveryMs: positive('JOB_FTP_EVERY_SEC', 30) * 1000,
        importEveryMs: positive('JOB_IMPORT_EVERY_SEC', 5) * 1000,
        reconstructEveryMs: positive('JOB_RECONSTRUCT_EVERY_SEC', 60) * 1000,
        reconstructMaxPerRun: positive('JOB_RECONSTRUCT_MAX_PER_RUN', 500),
    },

    backup: {
        dir: env('BACKUP_DIR', 'D:\\MonitoringFactoryBackup'),
        ...time('BACKUP_TIME', '00:10'),
        completeAfterDays: number('BACKUP_COMPLETE_AFTER_DAYS', 2),
    },
};
