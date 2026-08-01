const mongoose = require("mongoose");
const validator = require("validator");
const userSchema = new mongoose.Schema(
  {
    fullname: {
      type: String,
      required: true,
    },
    username: {
      type: String,
      required: true,
      unique: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      validate: [validator.isEmail, "Please enter a valid email"],
    },
    gender: {
      type: String,
      required: true,
      enum: ["male", "female"],
    },
    password: {
      type: String,
      required: true,
      minlength: 6,
    },
    profilePicture: {
      type: String,
      default: "",
    },
    about: {
      type: String,
      default: "Hey I am using NexChat",
    },
    // 'public' = anyone can message this user; 'private' = only accepted
    // friends can (enforced server-side in messageController.sendMessage,
    // never trusted from the client). Defaults to 'public' so existing
    // behavior is unchanged for everyone who hasn't opted in.
    messagePrivacy: {
      type: String,
      enum: ["public", "private"],
      default: "public",
    },
    // Friendship/friend-request state lives in the FriendRequest collection
    // (see friendRequestModel.js) - not embedded here, so requests can be
    // addressed by their own id and accepted via a single atomic update.
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);
