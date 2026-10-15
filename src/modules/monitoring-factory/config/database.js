import env from '../../../config/env.js';

// Values come from .env (see .env.example)
export default {
    mongoDB: env.mongo.uri,
    mongoDBName: env.mongo.db,
    oracleDB: env.oracle,
}
