const Conversation = require("../models/conversationModel");
const Message = require("../models/messageModel");

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
    console.log(`chat is created`);
    const newMessage = new Message({
      senderId,
      recieverId,
      message,
      conversationId: chats._id,
    });
    console.log(`new message created: ${newMessage}`);
    console.log(`the chat is : ${chats}`);
    if (newMessage) {
      chats.messages.push(newMessage._id);
    }
    //socket.io functioning
    await Promise.all([chats.save(), newMessage.save()]);
    return res.status(201).json(newMessage);
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
    const {id: recieverId } = req.params;

    const chats = await Conversation.findOne({
      participants: { $all: [senderId, recieverId] }
    }).populate("messages");

    if (!chats) {
      return res.status(200).json({
        success: true,
        messages: []
      });
    }
    chats.messages.forEach(element => {
      console.log(element.message);
    });
    return res.status(200).json({
      success: true,
      messages: chats.messages,
    });
  } catch (error) {
    console.error("Error getting messages:", error);
    return res.status(500).json({
      success: false,
      message: "Server error retrieving messages."
    });
  }
}

module.exports = {sendMessage,getMessage};
