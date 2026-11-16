const createError = require('http-errors');
const withViewer = require('../../db/with-viewer');
const model = require('../../models/discovery/discovery.model');

const pageSize = 30;

function withProfileBrowsing(viewerId, run) {
  return withViewer(viewerId, async (db) => {
    const {
      rows: [{ state }],
    } = await model.browsingState(db);
    if (state === 'paused') throw createError(403, 'Single-profile browsing is paused.');
    if (state !== 'available')
      throw createError(403, 'Profile browsing is unavailable for this account.');
    return run(db);
  });
}

function listProfiles(viewerId) {
  return withProfileBrowsing(viewerId, async (db) => {
    const { rows } = await model.listProfiles(db, viewerId, pageSize);
    return rows;
  });
}

async function listCompatibleProfiles(viewerId, snapshotId, position, options) {
  try {
    return await withProfileBrowsing(viewerId, async (db) => {
      const { rows } = await model.listCompatibleProfiles(db, snapshotId, position, options);
      const page = rows.slice(0, pageSize);
      const last = page.at(-1);
      return {
        profiles: page.map((row) => {
          const profile = { ...row };
          delete profile.snapshot_id;
          delete profile.item_position;
          return profile;
        }),
        next:
          rows.length > pageSize ? { snapshot: last.snapshot_id, after: last.item_position } : null,
      };
    });
  } catch (error) {
    if (error.code === 'LV400') throw createError(400, error.message);
    if (error.code === 'LV410') throw createError(410, error.message);
    if (error.code === 'LV403') throw createError(403, error.message);
    throw error;
  }
}

function listActionProfiles(viewerId, action) {
  return withProfileBrowsing(viewerId, async (db) => {
    const { rows } = await model.listActionProfiles(db, viewerId, action);
    return rows;
  });
}

async function addProfileAction(viewerId, targetId, action) {
  const {
    rows: [result],
  } = await withProfileBrowsing(viewerId, (db) =>
    model.addProfileAction(db, viewerId, targetId, action),
  );
  if (!result.eligible) {
    throw createError(404, 'This profile is no longer available.');
  }
}

function removeProfileAction(viewerId, targetId, action) {
  return withProfileBrowsing(viewerId, (db) =>
    model.removeProfileAction(db, viewerId, targetId, action),
  );
}

async function runConnectionChange(viewerId, action) {
  const statuses = { LV400: 400, LV404: 404, LV409: 409 };
  try {
    return await withViewer(viewerId, action);
  } catch (error) {
    if (statuses[error.code]) throw createError(statuses[error.code], error.message);
    throw error;
  }
}

function listConnections(viewerId) {
  return withViewer(viewerId, async (db) => (await model.listConnections(db, viewerId)).rows[0]);
}

async function sendConnectionRequest(viewerId, targetId) {
  const { rows } = await runConnectionChange(viewerId, (db) =>
    model.sendConnectionRequest(db, viewerId, targetId),
  );
  return rows[0];
}

function respondToConnectionRequest(viewerId, requestId, action) {
  return runConnectionChange(viewerId, (db) =>
    model.respondToConnectionRequest(db, requestId, action),
  );
}

function endConnection(viewerId, connectionId, requestId) {
  return runConnectionChange(viewerId, (db) => model.endConnection(db, connectionId, requestId));
}

function listCoupleStories(viewerId) {
  return withViewer(viewerId, async (db) => {
    const { rows } = await model.listCoupleStories(db, pageSize);
    return rows;
  });
}

module.exports = {
  listProfiles,
  listCompatibleProfiles,
  listActionProfiles,
  addProfileAction,
  removeProfileAction,
  listCoupleStories,
  listConnections,
  sendConnectionRequest,
  respondToConnectionRequest,
  endConnection,
};
