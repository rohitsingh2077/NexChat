const mongoose = require("mongoose");
const AppError = require("../utils/AppError");

const isNonEmptyString = (value) =>
  typeof value === "string" && value.trim().length > 0;

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

const validateRegister = (req, res, next) => {
  const { fullname, username, email, gender, password } = req.body || {};
  if (!isNonEmptyString(fullname)) return next(new AppError(400, "fullname is required"));
  if (!isNonEmptyString(username)) return next(new AppError(400, "username is required"));
  if (!isNonEmptyString(email)) return next(new AppError(400, "email is required"));
  if (!["male", "female"].includes(gender)) return next(new AppError(400, "gender must be 'male' or 'female'"));
  if (typeof password !== "string" || password.length < 6) return next(new AppError(400, "password must be at least 6 characters"));
  next();
};

const validateLogin = (req, res, next) => {
  const { username, password } = req.body || {};
  if (!isNonEmptyString(username)) return next(new AppError(400, "username is required"));
  if (!isNonEmptyString(password)) return next(new AppError(400, "password is required"));
  next();
};

const validateSendMessage = (req, res, next) => {
  const { message } = req.body || {};
  if (!isNonEmptyString(message)) return next(new AppError(400, "message is required"));
  if (message.length > 5000) return next(new AppError(400, "message is too long"));
  next();
};

const validateUpdateProfile = (req, res, next) => {
  const { fullname, gender, profilePicture, password, about, messagePrivacy } = req.body || {};
  if (fullname !== undefined && !isNonEmptyString(fullname)) return next(new AppError(400, "fullname cannot be empty"));
  if (gender !== undefined && !["male", "female"].includes(gender)) return next(new AppError(400, "gender must be 'male' or 'female'"));
  if (profilePicture !== undefined && typeof profilePicture !== "string") return next(new AppError(400, "profilePicture must be a string"));
  if (password !== undefined && (typeof password !== "string" || password.length < 6)) return next(new AppError(400, "password must be at least 6 characters"));
  if (about !== undefined && typeof about !== "string") return next(new AppError(400, "about must be a string"));
  if (messagePrivacy !== undefined && !["public", "private"].includes(messagePrivacy)) {
    return next(new AppError(400, "messagePrivacy must be 'public' or 'private'"));
  }
  next();
};

const validateSendFriendRequest = (req, res, next) => {
  const { receiverId } = req.body || {};
  if (!isNonEmptyString(receiverId) || !isValidObjectId(receiverId)) {
    return next(new AppError(400, "receiverId must be a valid user id"));
  }
  next();
};

// Factory so the same check can guard any :param route (requestId, friendId, ...)
const validateObjectIdParam = (paramName) => (req, res, next) => {
  if (!isValidObjectId(req.params[paramName])) {
    return next(new AppError(400, `${paramName} must be a valid id`));
  }
  next();
};

module.exports = {
  validateRegister,
  validateLogin,
  validateSendMessage,
  validateUpdateProfile,
  validateSendFriendRequest,
  validateObjectIdParam,
};
