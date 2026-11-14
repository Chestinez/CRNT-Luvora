const createError = require('http-errors');
const { getViewerId, uuid } = require('../viewer');
const discovery = require('../../services/discovery/discovery.service');

async function listProfiles(req, res) {
  res.json(await discovery.listProfiles(getViewerId(req)));
}

async function listSavedProfiles(req, res) {
  res.json(await discovery.listActionProfiles(getViewerId(req), 'saved'));
}

async function listHiddenProfiles(req, res) {
  res.json(await discovery.listActionProfiles(getViewerId(req), 'hidden'));
}

async function listCoupleStories(req, res) {
  res.json(await discovery.listCoupleStories(getViewerId(req)));
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
  if (!req.is('application/json')) {
    throw createError(415, 'Send an application/json request.');
  }

  if (req.method === 'PUT') {
    await discovery.addProfileAction(viewerId, profileId, action);
  } else {
    await discovery.removeProfileAction(viewerId, profileId, action);
  }
  res.status(204).end();
}

module.exports = {
  listProfiles,
  listSavedProfiles,
  listHiddenProfiles,
  listCoupleStories,
  changeProfileAction,
};
