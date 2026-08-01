const Conversation = require("../models/conversationModel");
const Message = require("../models/messageModel");
const User = require("../models/user");
const friendService = require("../services/friendService");
const AppError = require("../utils/AppError");
const { io, getRecieverSocket } = require("../Socket/socket");

const sendMessage = async (req, res, next) => {
  try {
    const { message } = req.body;
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

    const newMessage = new Message({
      senderId,
      recieverId,
      message,
      conversationId: chats._id,
    });
    if (newMessage) {
      chats.messages.push(newMessage._id);
    }

    await Promise.all([chats.save(), newMessage.save()]);
    /*----------------------*/
    /*socket.io functioning*/
    /* ----------------------*/
    // Convert recieverId to string since userSocketMap keys are stored as strings

    const recieverSocketId = getRecieverSocket(recieverId.toString());
    if (recieverSocketId) {
      io.to(recieverSocketId).emit("newMessage", newMessage);
    }

    return res.status(201).json({
      success: true,
      message: newMessage,
      senderName: `${req.user.fullname}`,
    });
  } catch (error) {
    next(error);
  }
};

const getMessage = async (req, res, next) => {
  try {
    const senderId = req.user._id;
    const { id: recieverId } = req.params;

    const chats = await Conversation.findOne({
      participants: { $all: [senderId, recieverId] },
    }).populate("messages");

    if (!chats) {
      return res.status(200).json({
        success: true,
        messages: [],
      });
    }
    return res.status(200).json({
      success: true,
      messages: chats.messages,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = { sendMessage, getMessage };
