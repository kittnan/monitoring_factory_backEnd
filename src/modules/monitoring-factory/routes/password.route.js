import { Router } from 'express';
const routes = Router();

import PasswordModel from '../models/password.js';
import { asyncRoute } from './route.helpers.js';

routes.route('/query/bypassword').post(asyncRoute(async (req, res) => {
  // Only match on the password string; passing req.body straight into the
  // query would let {"password": {"$ne": null}} through without a password.
  const pass = await PasswordModel.findOne({ password: String(req.body.password || '') });
  res.json(pass);
}));

export default routes;
