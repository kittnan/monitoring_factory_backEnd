import { Router } from "express";
const routes = Router();

import Kv1RecordsModel from "../models/kv1_records.js";
import Kv2RecordsModel from "../models/kv2_records.js";
import Kv3RecordsModel from "../models/kv3_records.js";
import Kv4RecordsModel from "../models/kv4_records.js";
import Kv5RecordsModel from "../models/kv5_records.js";
import { asyncRoute, modelFor } from "./route.helpers.js";

const byKv = modelFor({
    kv1: Kv1RecordsModel,
    kv2: Kv2RecordsModel,
    kv3: Kv3RecordsModel,
    kv4: Kv4RecordsModel,
    kv5: Kv5RecordsModel,
});

routes.route("/count").post(byKv, asyncRoute(async(req, res) => {
    res.json(await req.Model.countDocuments({}));
}));

routes.route("/query").post(byKv, asyncRoute(async(req, res) => {
    res.json(await req.Model.find(req.body.data || {}));
}));

routes.route("/delete").put(byKv, asyncRoute(async(req, res) => {
    res.json(await req.Model.deleteMany(req.body.data || {}));
}));

export default routes;
