const createError = require('http-errors');

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getViewerId(req) {
  const id = req.user?.id;
  if (typeof id !== 'string' || !uuid.test(id)) {
    throw createError(401, 'A signed-in Luvora account is required.');
  }
  return id;
}

module.exports = { getViewerId, uuid };
