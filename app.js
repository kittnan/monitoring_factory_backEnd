import env from './src/config/env.js'; // loads .env first
import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';

const app = express();
app.use(bodyParser.json());
app.use(cors());



import monitoringFactory from './src/modules/monitoring-factory/monitoring-factory.js'
app.use('', monitoringFactory);

// Any error from a route ends up here: log it and answer 500 instead of crashing
app.use((err, req, res, next) => {
    console.error(new Date().toLocaleString(), `${req.method} ${req.originalUrl}`, err);
    if (res.headersSent) return next(err);
    res.status(err.status || 500).json({ error: err.expose ? err.message : 'server error' });
});

// Safety net: a forgotten promise rejection is logged, not fatal
process.on('unhandledRejection', (reason) => {
    console.error(new Date().toLocaleString(), 'unhandledRejection', reason);
});

const port = env.port;
const server = app.listen(port, () => {
    console.log('Listening on port ' + server.address().port);
});