const User = require("../models/user");
const bcrypt = require("bcrypt");

// Always updates the authenticated user's own profile - the target user is
// derived from req.user (set by isLogin), never from a client-supplied id,
// so one account can never edit another account's data.
const updateUserController = async (req, res, next) => {
  try {
    const { fullname, gender, profilePicture, password, about: updatedAbout, messagePrivacy } = req.body;
    const userId = req.user._id;

    let user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }
    // Update only allowed fields
    if (fullname !== undefined) user.fullname = fullname.trim();
    if (gender !== undefined) user.gender = gender;
    if (profilePicture !== undefined) user.profilePicture = profilePicture;
    if (password) {
      const hashedPassword = await bcrypt.hash(password, 12);
      user.password = hashedPassword;
    }
    if (updatedAbout) user.about = updatedAbout;
    if (messagePrivacy !== undefined) user.messagePrivacy = messagePrivacy;

    await user.save();

    return res.status(200).json({
      success: true,
      message: "Profile updated successfully",
      user: {
        _id: user._id,
        fullname: user.fullname,
        gender: user.gender,
        profilePicture: user.profilePicture,
        about: user.about,
        messagePrivacy: user.messagePrivacy,
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = updateUserController;
