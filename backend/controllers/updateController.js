const User = require("../models/user");
const bcrypt = require('bcrypt')

const updateUserController = async (req, res) => {
  try {
    const { fullname, gender, profilePicture,password , about:updatedAbout } = req.body;
    const { id : userId } = req.params; // /user/update/:userId
    
    // Make sure user exists
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
    if(password){
      const hashedPassword = await bcrypt.hash(password, 12);
      user.password = hashedPassword;
    }
    if(updatedAbout) user.about = updatedAbout;

    await user.save();

    return res.status(200).json({
      success: true,
      message: "Profile updated successfully",
      user: {
        _id: user._id,
        fullname: user.fullname,
        gender: user.gender,
        profilePicture: user.profilePicture,
        about: user.about
      },
    });
  } catch (error) {
    console.error("Error updating user:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while updating user",
    });
  }
};

module.exports = updateUserController;