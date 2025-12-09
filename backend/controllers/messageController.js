const Conversation = require("../models/conversationModel");
const Message = require("../models/messageModel");
const { io, getRecieverSocket } = require("../Socket/socket");

const sendMessage = async (req, res, next) => {
  try {
    const { message } = req.body;
    const { id: recieverId } = req.params;
    const senderId = req.user._id;

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
      // console.log(`✅ Message emitted to receiver socket: ${recieverSocketId}`);
    } else {
      console.log(
        // `❌ Receiver ${recieverId.toString()} not connected. Message saved but not emitted.`
      );
    }

    return res.status(201).json({
      success: true,
      message: newMessage,
      senderName: `${req.user.fullname}`,
    });
  } catch (error) {
    return res.status(500).send({
      success: false,
      message: `there is some error sending message -- ${error}`,
    });
  }
};

const getMessage = async (req, res) => {
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
    console.error("Error getting messages:", error);
    return res.status(500).json({
      success: false,
      message: "Server error retrieving messages.",
    });
  }
};

module.exports = { sendMessage, getMessage };
