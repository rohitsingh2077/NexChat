const Conversation = require("../models/conversationModel");
const User = require("../models/user");

const getUserBySearch = async (req, res) => {
  try {
    const search = req.query.search || "";
    const currentUser = req.user._id;

    const users = await User.find({
      _id: { $ne: currentUser }, // exclude logged-in user

      $or: [
        { username: { $regex: search, $options: "i" } },
        { fullname: { $regex: search, $options: "i" } },
      ],
    }).select("-password"); // never return password
    return res.status(200).json({
      success: true,
      users,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: "Error searching users",
    });
  }
};

const getcurrentChatters = async (req, res) => {
  try {
    const currentUserId = req.user._id.toString();

    const conversations = await Conversation.find({
      participants: currentUserId,
    })
      .sort({ updatedAt: -1 })
      .populate("participants", "-password");

    if (!conversations.length) {
      return res.status(200).json({
        success: true,
        message: "We are lonely",
        chatters: [],
      });
    }

    const seen = new Set();
    const uniqueChatters = [];

    conversations.forEach((conversation) => {
      conversation.participants.forEach((p) => {
        const id = p._id.toString();
        if (id !== currentUserId && !seen.has(id)) {
          seen.add(id);
          uniqueChatters.push(p);
        }
      });
    });

    return res.status(200).json({
      success: true,
      chatters: uniqueChatters,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: "Error fetching chatters",
    });
  }
};


module.exports = { getUserBySearch,getcurrentChatters };
