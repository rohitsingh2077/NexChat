const Conversation = require("../models/conversationModel");
const Message = require("../models/messageModel");
const User = require("../models/user");
const friendService = require("../services/friendService");
const AppError = require("../utils/AppError");
const { io, getRecieverSocket } = require("../realtime/socket");

const sendMessage = async (req, res, next) => {
  try {
    const { message, clientMessageId } = req.body;
    const { id: recieverId } = req.params;
    const senderId = req.user._id;

    const receiver = await User.findById(recieverId).select("messagePrivacy");
    if (!receiver) {
      return next(new AppError(404, "USER_NOT_FOUND"));
    }
    if (receiver.messagePrivacy === "private") {
      const isFriend = await friendService.areFriends(senderId, recieverId);
      if (!isFriend) {
        return next(new AppError(403, "NOT_FRIENDS_CANNOT_MESSAGE"));
      }
    }

    let chats = await Conversation.findOne({
      participants: { $all: [senderId, recieverId] },
    });
    if (!chats) {
      chats = await Conversation.create({
        participants: [senderId, recieverId],
      });
    }

    // Save the message before touching the conversation, and treat a
    // duplicate-key error as "this is a retry of an attempt that already
    // succeeded" rather than a failure - see messageModel.js LEARNING NOTES
    // for why clientMessageId makes this idempotent.
    let newMessage;
    let isNewMessage = true;
    try {
      newMessage = await new Message({
        senderId,
        recieverId,
        message,
        conversationId: chats._id,
        clientMessageId,
      }).save();
    } catch (error) {
      if (error.code !== 11000) throw error;
      newMessage = await Message.findOne({ clientMessageId });
      if (!newMessage) throw error;
      isNewMessage = false;
    }

    // Idempotent link: only push if this message isn't already referenced,
    // so a retry that follows a save-succeeded-but-link-failed crash still
    // gets linked instead of staying orphaned.
    const alreadyLinked = chats.messages.some(
      (id) => String(id) === String(newMessage._id)
    );
    if (!alreadyLinked) {
      chats.messages.push(newMessage._id);
      await chats.save();
    }

    /*----------------------*/
    /*socket.io functioning*/
    /* ----------------------*/
    // Only push over the socket (and flip status to delivered) on the
    // attempt that actually created the message - re-emitting on a retry
    // would show the receiver the same message twice in their open chat.
    if (isNewMessage) {
      const recieverSocketId = getRecieverSocket(recieverId.toString());
      if (recieverSocketId) {
        io.to(recieverSocketId).emit("newMessage", newMessage);
        newMessage.status = "delivered";
        await newMessage.save();
      }
    }

    return res.status(isNewMessage ? 201 : 200).json({
      success: true,
      message: newMessage,
      senderName: `${req.user.fullname}`,
    });
  } catch (error) {
    next(error);
  }
};

const DEFAULT_PAGE_SIZE = 30;

// Paginated by _id, newest page first (no cursor), older pages on request -
// see messageModel.js LEARNING NOTES for why _id (not createdAt) is the
// cursor. Loads at most `limit` messages per call instead of an entire
// conversation's history, however long that history has grown.
const getMessage = async (req, res, next) => {
  try {
    const senderId = req.user._id;
    const { id: recieverId } = req.params;
    const { cursor, limit } = req.query;
    const pageSize = limit ? Number(limit) : DEFAULT_PAGE_SIZE;

    const chats = await Conversation.findOne({
      participants: { $all: [senderId, recieverId] },
    });

    if (!chats) {
      return res.status(200).json({
        success: true,
        messages: [],
        hasMore: false,
        nextCursor: null,
      });
    }

    const query = { conversationId: chats._id };
    if (cursor) query._id = { $lt: cursor };

    // Fetch one extra to know whether an older page exists without a
    // separate count query.
    const page = await Message.find(query)
      .sort({ _id: -1 })
      .limit(pageSize + 1);

    const hasMore = page.length > pageSize;
    const trimmed = hasMore ? page.slice(0, pageSize) : page;
    const nextCursor = hasMore ? String(trimmed[trimmed.length - 1]._id) : null;

    return res.status(200).json({
      success: true,
      messages: trimmed.reverse(), // oldest -> newest for rendering top to bottom
      hasMore,
      nextCursor,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = { sendMessage, getMessage };
