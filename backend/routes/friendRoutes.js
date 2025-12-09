const router = require("express").Router();
const islogin = require('../middleware/islogin.js');

const {
  sendFriendRequest,
  acceptFriendRequest,
  declineFriendRequest,
  getFriends,
  getFriendRequests,
  getSentRequests,
  removeFriend
} = require("../controllers/friendController");

// send request
router.post("/request/:id", islogin, sendFriendRequest);

// accept request
router.post("/accept/:id", islogin, acceptFriendRequest);

// decline request
router.post("/decline/:id", islogin, declineFriendRequest);

// remove friend
router.delete("/remove/:id", islogin, removeFriend);

// get friends
router.get("/", islogin, getFriends);

// incoming requests
router.get("/requests", islogin, getFriendRequests);

// sent requests
router.get("/sent", islogin, getSentRequests);

module.exports = router;
