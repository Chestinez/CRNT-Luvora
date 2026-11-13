const withViewer = require('../../db/with-viewer');
const model = require('../../models/discovery/discovery.model');

const pageSize = 30;

function listProfiles(viewerId) {
  return withViewer(viewerId, async (db) => {
    const { rows } = await model.listProfiles(db, viewerId, pageSize);
    return rows;
  });
}

function listCoupleStories(viewerId) {
  return withViewer(viewerId, async (db) => {
    const { rows } = await model.listCoupleStories(db, pageSize);
    return rows;
  });
}

module.exports = { listProfiles, listCoupleStories };
