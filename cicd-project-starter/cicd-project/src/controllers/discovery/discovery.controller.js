const { getViewerId } = require('../viewer');
const discovery = require('../../services/discovery/discovery.service');

async function listProfiles(req, res) {
  res.json(await discovery.listProfiles(getViewerId(req)));
}

async function listCoupleStories(req, res) {
  res.json(await discovery.listCoupleStories(getViewerId(req)));
}

module.exports = { listProfiles, listCoupleStories };
