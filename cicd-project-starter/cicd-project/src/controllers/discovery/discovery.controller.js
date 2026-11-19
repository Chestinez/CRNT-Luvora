const createError = require('http-errors');
const { getViewerId, uuid } = require('../viewer');
const discovery = require('../../services/discovery/discovery.service');
const { containsBlockedSearchTerm } = require('../../services/discovery/search-terms');

async function listProfiles(req, res) {
  res.json(await discovery.listProfiles(getViewerId(req)));
}

async function listCompatibleProfiles(req, res) {
  const viewerId = getViewerId(req);
  const { snapshot, after, order, minScore, sharedOnly, minAge, maxAge } = req.query;
  if (snapshot === undefined && after === undefined) {
    res.json(
      await discovery.listCompatibleProfiles(viewerId, null, 0, {
        order,
        minScore,
        sharedOnly,
        minAge,
        maxAge,
      }),
    );
    return;
  }
  if (typeof after !== 'string' || !/^[1-9]\d{0,9}$/.test(after) || Number(after) > 2147483647) {
    throw createError(400, 'Choose a valid Compatibility page.');
  }
  res.json(
    await discovery.listCompatibleProfiles(viewerId, requireId(snapshot), Number(after), {}),
  );
}

async function listSavedProfiles(req, res) {
  res.json(await discovery.listActionProfiles(getViewerId(req), 'saved'));
}

async function searchProfiles(req, res) {
  const viewerId = getViewerId(req);
  requireJson(req);
  const query = typeof req.body?.query === 'string' ? req.body.query.trim() : '';
  if (!/[\p{L}\p{N}]/u.test(query) || query.length > 300) {
    throw createError(400, 'Enter an interest or description of up to 300 characters.');
  }
  if (containsBlockedSearchTerm(query)) {
    res.status(400).json({
      code: 'blocked_search_term',
      error: 'Use a different word or describe the interests you’re looking for.',
    });
    return;
  }
  res.json(await discovery.searchProfiles(viewerId, query));
}

async function profileCompatibility(req, res) {
  res.json(await discovery.profileCompatibility(getViewerId(req), requireId(req.params.profileId)));
}

async function listHiddenProfiles(req, res) {
  res.json(await discovery.listActionProfiles(getViewerId(req), 'hidden'));
}

async function listCoupleStories(req, res) {
  res.json(await discovery.listCoupleStories(getViewerId(req)));
}

function requireJson(req) {
  if (!req.is('application/json')) throw createError(415, 'Send an application/json request.');
}

function requireId(id) {
  if (typeof id !== 'string' || !uuid.test(id)) throw createError(400, 'Choose a valid ID.');
  return id.toLowerCase();
}

async function listConnections(req, res) {
  res.json(await discovery.listConnections(getViewerId(req)));
}

async function sendConnectionRequest(req, res) {
  const viewerId = getViewerId(req);
  requireJson(req);
  const targetId = requireId(req.body?.targetId);
  res.json(await discovery.sendConnectionRequest(viewerId, targetId));
}

async function respondToConnectionRequest(req, res) {
  const viewerId = getViewerId(req);
  requireJson(req);
  const requestId = requireId(req.params.requestId);
  const actions = { accept: 'accepted', decline: 'rejected', withdraw: 'cancelled' };
  const { action } = req.params;
  if (!Object.hasOwn(actions, action)) throw createError(400, 'Choose a valid invitation action.');
  await discovery.respondToConnectionRequest(viewerId, requestId, actions[action]);
  res.status(204).end();
}

async function endConnection(req, res) {
  const viewerId = getViewerId(req);
  requireJson(req);
  await discovery.endConnection(
    viewerId,
    requireId(req.params.connectionId),
    requireId(req.body?.requestId),
  );
  res.status(204).end();
}

async function changeProfileAction(req, res) {
  const viewerId = getViewerId(req);
  const { profileId, action } = req.params;
  if (!uuid.test(profileId) || !['saved', 'hidden'].includes(action)) {
    throw createError(400, 'Choose a valid profile and action.');
  }
  if (viewerId.toLowerCase() === profileId.toLowerCase()) {
    throw createError(400, 'You cannot save or hide your own profile.');
  }
  // Requiring JSON keeps these mutations out of cross-origin HTML form submissions.
  requireJson(req);

  if (req.method === 'PUT') {
    await discovery.addProfileAction(viewerId, profileId, action);
  } else {
    await discovery.removeProfileAction(viewerId, profileId, action);
  }
  res.status(204).end();
}

module.exports = {
  listProfiles,
  listCompatibleProfiles,
  searchProfiles,
  profileCompatibility,
  listSavedProfiles,
  listHiddenProfiles,
  listCoupleStories,
  changeProfileAction,
  listConnections,
  sendConnectionRequest,
  respondToConnectionRequest,
  endConnection,
};
