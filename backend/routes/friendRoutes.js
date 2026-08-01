const router = require("express").Router();
const islogin = require("../middleware/isLogin.js");
const {
  validateSendFriendRequest,
  validateObjectIdParam,
} = require("../middleware/validate.js");

const {
  sendFriendRequest,
  acceptFriendRequest,
  rejectFriendRequest,
  cancelFriendRequest,
  getFriends,
  getFriendRequests,
  getSentRequests,
  removeFriend,
} = require("../controllers/friendController");

// send request
router.post("/requests", islogin, validateSendFriendRequest, sendFriendRequest);

// incoming / outgoing pending requests
router.get("/requests/incoming", islogin, getFriendRequests);
router.get("/requests/outgoing", islogin, getSentRequests);

// respond to a specific request
router.post(
  "/requests/:requestId/accept",
  islogin,
  validateObjectIdParam("requestId"),
  acceptFriendRequest
);
router.post(
  "/requests/:requestId/reject",
  islogin,
  validateObjectIdParam("requestId"),
  rejectFriendRequest
);
router.delete(
  "/requests/:requestId",
  islogin,
  validateObjectIdParam("requestId"),
  cancelFriendRequest
);

// friend list
router.get("/", islogin, getFriends);

// remove friend
router.delete("/:friendId", islogin, validateObjectIdParam("friendId"), removeFriend);

module.exports = router;
