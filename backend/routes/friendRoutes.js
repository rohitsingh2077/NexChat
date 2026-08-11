const router = require("express").Router();
const islogin = require("../middleware/isLogin.js");
const {
  validateSendFriendRequest,
  validateObjectIdParam,
} = require("../middleware/validate.js");
const { rateLimit, byUser } = require("../middleware/rateLimit.js");

// User-keyed - caps how fast one account can fire off friend requests
// (spam-adding strangers).
const sendRequestRateLimit = rateLimit({
  name: "send-friend-request",
  windowMs: 60 * 1000,
  max: 20,
  keyFn: byUser,
});

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

// send request (rate limit must run after islogin - it needs req.user)
router.post("/requests", islogin, sendRequestRateLimit, validateSendFriendRequest, sendFriendRequest);

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
