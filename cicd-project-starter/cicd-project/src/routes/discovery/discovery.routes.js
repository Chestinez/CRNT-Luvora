const express = require('express');
const controller = require('../../controllers/discovery/discovery.controller');

const router = express.Router();
router.get('/profiles', controller.listProfiles);
router.get('/profiles/compatibility', controller.listCompatibleProfiles);
router.post('/profiles/search', controller.searchProfiles);
router.get('/profiles/:profileId/compatibility', controller.profileCompatibility);
router.get('/profiles/saved', controller.listSavedProfiles);
router.get('/profiles/hidden', controller.listHiddenProfiles);
router.put('/profiles/:profileId/:action', controller.changeProfileAction);
router.delete('/profiles/:profileId/:action', controller.changeProfileAction);
router.get('/couple-stories', controller.listCoupleStories);
router.get('/connections', controller.listConnections);
router.post('/connections/requests', controller.sendConnectionRequest);
router.post('/connections/requests/:requestId/:action', controller.respondToConnectionRequest);
router.post('/connections/:connectionId/end', controller.endConnection);

module.exports = router;
