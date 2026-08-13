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
  const { message, clientMessageId } = req.body || {};
  if (!isNonEmptyString(message)) return next(new AppError(400, "message is required"));
  if (message.length > 5000) return next(new AppError(400, "message is too long"));
  if (!isNonEmptyString(clientMessageId) || clientMessageId.length > 100) {
    return next(new AppError(400, "clientMessageId is required"));
  }
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

const MAX_MESSAGE_PAGE_SIZE = 100;

const validateGetMessages = (req, res, next) => {
  const { cursor, limit } = req.query || {};
  if (cursor !== undefined && !isValidObjectId(cursor)) {
    return next(new AppError(400, "cursor must be a valid id"));
  }
  if (limit !== undefined) {
    const parsed = Number(limit);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_MESSAGE_PAGE_SIZE) {
      return next(new AppError(400, `limit must be an integer between 1 and ${MAX_MESSAGE_PAGE_SIZE}`));
    }
  }
  next();
};

const MAX_SERVER_NAME = 100;
const MAX_SERVER_DESCRIPTION = 500;

const validateCreateServer = (req, res, next) => {
  const { name, description, icon, joinPolicy } = req.body || {};
  if (!isNonEmptyString(name) || name.length > MAX_SERVER_NAME) {
    return next(new AppError(400, `name is required (max ${MAX_SERVER_NAME} chars)`));
  }
  if (
    description !== undefined &&
    (typeof description !== "string" || description.length > MAX_SERVER_DESCRIPTION)
  ) {
    return next(
      new AppError(400, `description must be a string up to ${MAX_SERVER_DESCRIPTION} chars`)
    );
  }
  if (icon !== undefined && typeof icon !== "string") {
    return next(new AppError(400, "icon must be a string"));
  }
  if (joinPolicy !== undefined && !["open", "approval_required"].includes(joinPolicy)) {
    return next(new AppError(400, "joinPolicy must be 'open' or 'approval_required'"));
  }
  next();
};

const MAX_ALLOWED_CHANNELS = 100;

const validateApproveJoinRequest = (req, res, next) => {
  const { allowedChannelIds } = req.body || {};
  if (allowedChannelIds === undefined) return next();
  if (!Array.isArray(allowedChannelIds) || allowedChannelIds.length > MAX_ALLOWED_CHANNELS) {
    return next(new AppError(400, "allowedChannelIds must be an array of channel ids"));
  }
  if (!allowedChannelIds.every(isValidObjectId)) {
    return next(new AppError(400, "allowedChannelIds must all be valid channel ids"));
  }
  next();
};

const validateUpdateMemberRole = (req, res, next) => {
  const { role } = req.body || {};
  if (!["member", "admin"].includes(role)) {
    return next(new AppError(400, "role must be 'member' or 'admin'"));
  }
  next();
};

const validateTransferOwnership = (req, res, next) => {
  const { newOwnerUserId } = req.body || {};
  if (!isNonEmptyString(newOwnerUserId) || !isValidObjectId(newOwnerUserId)) {
    return next(new AppError(400, "newOwnerUserId must be a valid user id"));
  }
  next();
};

// Shape check only (not "does this code exist") - that's a DB lookup, done
// in the service layer. This just rejects obviously-malformed input (wrong
// length, disallowed characters) before it reaches a query. Matches
// generateInviteCodeToken's output shape (crypto.randomBytes(6).toString
// ("base64url")) with headroom either side in case that changes later.
const INVITE_CODE_PATTERN = /^[A-Za-z0-9_-]{6,32}$/;

const validateInviteCodeParam = (req, res, next) => {
  if (!INVITE_CODE_PATTERN.test(req.params.code || "")) {
    return next(new AppError(400, "invalid invite code format"));
  }
  next();
};

const MAX_CHANNEL_NAME = 100;

const validateCreateChannel = (req, res, next) => {
  const { name } = req.body || {};
  if (!isNonEmptyString(name) || name.length > MAX_CHANNEL_NAME) {
    return next(new AppError(400, `name is required (max ${MAX_CHANNEL_NAME} chars)`));
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
  validateGetMessages,
  validateCreateServer,
  validateCreateChannel,
  validateApproveJoinRequest,
  validateUpdateMemberRole,
  validateTransferOwnership,
  validateInviteCodeParam,
};
