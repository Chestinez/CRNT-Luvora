const express = require('express');
const controller = require('../../controllers/discovery/discovery.controller');

const router = express.Router();
router.get('/profiles', controller.listProfiles);
router.get('/couple-stories', controller.listCoupleStories);

module.exports = router;
