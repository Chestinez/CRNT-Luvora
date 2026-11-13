const express = require('express');
const createError = require('http-errors');
const controller = require('../../controllers/posts/posts.controller');

const router = express.Router();

router.use((req, res, next) => {
  if (['POST', 'PATCH', 'DELETE'].includes(req.method) && !req.is('application/json')) {
    return next(createError(415, 'Send an application/json request.'));
  }
  next();
});

router.get('/relationships', controller.listRelationships);
router.get('/review', controller.listReviewable);
router.get('/', controller.listOwn);
router.post('/:id/approve', controller.approveRevision);
router.post('/', controller.createDraft);
router.patch('/:id', controller.updateDraft);
router.post('/:id/publish', controller.publishDraft);
router.delete('/:id', controller.deleteOwn);

module.exports = router;
