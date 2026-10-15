import { Router } from "express";
const routes = Router();

import Kv1Model from "../models/kv1.js";
import Kv2Model from "../models/kv2.js";
import Kv3Model from "../models/kv3.js";
import Kv4Model from "../models/kv4.js";
import Kv5Model from "../models/kv5.js";
import { asyncRoute, modelFor } from "./route.helpers.js";

const byKv = modelFor({
  kv1: Kv1Model,
  kv2: Kv2Model,
  kv3: Kv3Model,
  kv4: Kv4Model,
  kv5: Kv5Model,
});

routes.route("/").get(async (req, res) => {
  res.send("ok");
});

routes.route("/count").post(byKv, asyncRoute(async (req, res) => {
  res.json(await req.Model.countDocuments({}));
}));

routes.route("/post/get-data").post(byKv, asyncRoute(async (req, res) => {
  let query = req.Model.find(req.body.obj || {}).sort({ date: -1, key: 1 });
  if (req.body.limit) query = query.limit(Number(req.body.limit));
  res.json(await query);
}));

// Defined delete | remove | destroy route
routes.route("/put/delete-many").put(byKv, asyncRoute(async (req, res) => {
  res.json(await req.Model.deleteMany(req.body.obj || {}));
}));

export default routes;
