import env from '../../../config/env.js';

// Values come from .env: BACKUP_DIR, BACKUP_TIME, BACKUP_COMPLETE_AFTER_DAYS
export default {
    // Root folder for backup files: <dir>/<kv>/<YYYY-MM-DD>.xlsx
    dir: env.backup.dir,
    // Daily run time (server local time)
    hour: env.backup.hour,
    minute: env.backup.minute,
    // Records reach *_records about 24h late, so a day is complete only
    // once it is this many days old. Younger days stay in the buffer.
    completeAfterDays: env.backup.completeAfterDays,
}
