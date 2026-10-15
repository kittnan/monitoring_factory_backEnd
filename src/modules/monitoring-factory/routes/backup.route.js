import { Router } from 'express';
const routes = Router();

import backup from '../methods/backup.method.js';
import PasswordModel from '../models/password.js';
import { asyncRoute } from './route.helpers.js';

const validKv = (req, res, next) => {
  if (!backup.isKv(req.params.kv)) return res.status(400).json({ error: 'invalid kv' });
  if (req.params.date !== undefined && !backup.isDate(req.params.date)) {
    return res.status(400).json({ error: 'invalid date' });
  }
  next();
};

// List backup files for a page, newest first
routes.route('/list/:kv').get(validKv, asyncRoute(async (req, res) => {
  res.json(await backup.list(req.params.kv));
}));

// Rows of one day, for viewing in the app
routes.route('/view/:kv/:date').get(validKv, (req, res) => {
  const data = backup.view(req.params.kv, req.params.date);
  if (!data) return res.status(404).json({ error: 'not found' });
  res.json(data);
});

// Download the xlsx file of one day
routes.route('/file/:kv/:date').get(validKv, (req, res) => {
  const file = backup.filePath(req.params.kv, req.params.date);
  res.download(file, `${req.params.kv}_${req.params.date}.xlsx`, (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: 'not found' });
  });
});

routes.route('/status').get((req, res) => {
  res.json(backup.lastRun);
});

// Run a backup now (all pages, or one kv). Requires the download password.
routes.route('/run').post(asyncRoute(async (req, res) => {
  const pass = await PasswordModel.findOne({ password: String(req.body.password || '') });
  if (!pass) return res.status(401).json({ error: 'password not correct' });

  const kv = req.body.kv;
  if (kv !== undefined && !backup.isKv(kv)) return res.status(400).json({ error: 'invalid kv' });
  const results = kv ? [await backup.backupKv(kv)] : await backup.backupAll();
  res.json(results);
}));

export default routes;
