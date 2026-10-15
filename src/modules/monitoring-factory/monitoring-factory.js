import express from 'express';
import mongoose from 'mongoose';
import config from './config/database.js';

import kvRoute from './routes/kv.route.js';
import kvSetRoute from './routes/kv_set.route.js';
import kvRecordsRoute from './routes/kv_records.route.js';
import passwordRoute from './routes/password.route.js';
import backupRoute from './routes/backup.route.js';
import kvMethods from './methods/kv.method.js';
import backupMethods from './methods/backup.method.js';

mongoose.Promise = global.Promise;
mongoose.connect(`${config.mongoDB}/${config.mongoDBName}`, { useNewUrlParser: true, useUnifiedTopology: true, useFindAndModify: false }).then(
    () => {
        kvMethods.interval();
        backupMethods.schedule();
        console.log(`Monitoring Factory database is connected`);
    }, err => {
        console.log(`Can not connect to the database ${err}`);
    }
);

const app = express();
app.use('/kv', kvRoute);
app.use('/kvSet', kvSetRoute);
app.use('/kvRecords', kvRecordsRoute);
app.use('/kvPassword', passwordRoute);
app.use('/backup', backupRoute);

export default app;