// Shared helpers for the kv routes.

// Express 4 does not catch errors thrown by async handlers; a rejected promise
// would crash the whole process. This forwards them to the error handler instead.
export const asyncRoute = (fn) => (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);

// Picks the model for req.body.kv ("kv1".."kv5") into req.Model,
// or answers 400 for a missing/unknown kv instead of crashing on undefined.
export const modelFor = (models) => (req, res, next) => {
    const kv = req.body && req.body.kv;
    if (typeof kv !== 'string' || !Object.prototype.hasOwnProperty.call(models, kv)) {
        return res.status(400).json({ error: `invalid kv: ${JSON.stringify(kv)} (expected one of ${Object.keys(models).join(', ')})` });
    }
    req.Model = models[kv];
    next();
};
