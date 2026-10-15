import { Router } from 'express';
const routes = Router();

import Kv1SetModel from '../models/kv1_set.js';
import Kv2SetModel from '../models/kv2_set.js';
import Kv3SetModel from '../models/kv3_set.js';
import Kv4SetModel from '../models/kv4_set.js';
import Kv5SetModel from '../models/kv5_set.js';
import { asyncRoute, modelFor } from './route.helpers.js';

const byKv = modelFor({
    kv1: Kv1SetModel,
    kv2: Kv2SetModel,
    kv3: Kv3SetModel,
    kv4: Kv4SetModel,
    kv5: Kv5SetModel,
});

routes.route('/post/get-data').post(byKv, asyncRoute(async(req, res) => {
    res.json(await req.Model.find(req.body.obj || {}).limit(1));
}));

routes.route('/put/update-data').put(byKv, asyncRoute(async(req, res) => {
    const KV = req.Model;
    const find = await KV.findOne({ key: req.body.key });
    if (find) {
        req.body.date = new Date();
        res.json(await KV.findOneAndUpdate({ _id: find._id }, { $set: req.body }, { upsert: true }));
    } else {
        let insert = new KV(req.body.obj);
        insert.date = new Date();
        res.json(await KV.create(insert));
    }
}));

routes.route('/put/delete').put(byKv, asyncRoute(async(req, res) => {
    res.json(await req.Model.deleteOne(req.body.data || {}));
}));

export default routes;
