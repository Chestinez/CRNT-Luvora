const createError = require('http-errors');
const withViewer = require('../../db/with-viewer');
const model = require('../../models/discovery/discovery.model');

const pageSize = 30;

function listProfiles(viewerId) {
  return withViewer(viewerId, async (db) => {
    const { rows } = await model.listProfiles(db, viewerId, pageSize);
    return rows;
  });
}

function listActionProfiles(viewerId, action) {
  return withViewer(viewerId, async (db) => {
    const { rows } = await model.listActionProfiles(db, viewerId, action);
    return rows;
  });
}

async function addProfileAction(viewerId, targetId, action) {
  const {
    rows: [result],
  } = await withViewer(viewerId, (db) => model.addProfileAction(db, viewerId, targetId, action));
  if (!result.eligible) {
    throw createError(404, 'This profile is no longer available.');
  }
}

function removeProfileAction(viewerId, targetId, action) {
  return withViewer(viewerId, (db) => model.removeProfileAction(db, viewerId, targetId, action));
}

function listCoupleStories(viewerId) {
  return withViewer(viewerId, async (db) => {
    const { rows } = await model.listCoupleStories(db, pageSize);
    return rows;
  });
}

module.exports = {
  listProfiles,
  listActionProfiles,
  addProfileAction,
  removeProfileAction,
  listCoupleStories,
};
