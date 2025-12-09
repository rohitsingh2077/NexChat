const User = require("../models/user");
const mongoose = require("mongoose");

/*----------------------*/
/*send  friend request */
/*---------------------*/

const sendFriendRequest = async (req, res) => {
  try {
    const currentUserId = req.user._id;
    const targetId = req.params.id;

    if (!isValidId(targetId))
      return res.status(400).json({
        success: false,
        message: "Invalid user ID",
      });
    const [me, target] = await Promise.all([
      User.findById(currentUserId),
      User.findById(targetId),
    ]);
    if (!target)
      return res
        .status(404)
        .json({ success: false, message: "User not found" });

    // Already friends?
    if (me.friends.includes(targetId)) {
      return res
        .status(400)
        .json({ success: false, message: "Already friends" });
    }

    // Already sent a request?
    if (me.sentRequests.includes(targetId)) {
      return res.status(400).json({ success: false, message: "Request already sent" });
    }

    // If THEY sent you a request  then auto accept
    if (me.friendRequests.includes(targetId)) {
      me.friendRequests = me.friendRequests.filter(
        (id) => String(id) !== targetId
      );
      target.sentRequests = target.sentRequests.filter(
        (id) => String(id) !== String(currentUserId)
      );

      me.friends.push(targetId);
      target.friends.push(currentUserId);

      await Promise.all([me.save(), target.save()]);

      return res.status(200).json({
        success: true,
        autoAccepted: true,
        message: "Friend request auto-accepted",
      });
    }

    // Normal pending request
    me.sentRequests.push(targetId);
    target.friendRequests.push(currentUserId);

    await Promise.all([me.save(), target.save()]);

    return res
      .status(200)
      .json({ success: true, message: "Friend request sent" });
  } catch (error) {}
};


module.exports = {sendFriendRequest};