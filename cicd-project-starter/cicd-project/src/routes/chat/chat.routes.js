const router = require("express").Router();
const controller = require("../../controllers/chat/chat.controller");
const { getViewerId } = require("../../controllers/viewer");
router.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  try {
    getViewerId(req);
    next();
  } catch (error) {
    next(error);
  }
});
router.get("/", controller.list);
router.get("/:id/messages", controller.history);
router.get("/:id/photo", controller.photo);
router.post("/:id/messages", controller.send);
module.exports = router;
