const User = require("../models/user");
const bcrypt = require("bcrypt");
const jwtToken = require("../utils/jwttoken");
const mongoose = require("mongoose");

const userRegister = async (req, res, next) => {
  try {
    console.log(`it is called`);
    console.log("req.body:", req.body);
    const { fullname, username, email, gender, password, profilePicture } =
      req.body || {};

    const user = await User.findOne({ username });
    if (user) {
      return res.status(500).send({
        success: "false",
        message: "Username or email already exists",
      });
    }
    const genderSimplify = () => {
      if (gender === "male") return "boy";
      else return "girl";
    };
    const hashedPassword = await bcrypt.hash(password, 12);
    const profilePic =
      profilePicture ||
      `https://avatar.iran.liara.run/public/${genderSimplify()}?username=${username}`;

    const newUser = new User({
      fullname,
      username,
      email,
      password: hashedPassword,
      gender,
      profilePicture: profilePic,
    });

    if (newUser) {
      await newUser.save();
      jwtToken(newUser._id, res);
    } else {
      res.status(500).send({ success: "false", message: "Invalid user data" });
    }
    res.status(201).send({
      _id: newUser._id,
      fullname: newUser.fullname,
      profilePic: profilePic,
      email: newUser.email,
      message: "new user is registered",
    });
  } catch (error) {
    res.status(500).send({
      success: "false",
      message: error,
    });
    console.log(`error while registering: ${error}`);
  }
};

const userLogin = async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(404).send({
        success: false,
        message: "User not found. Please register first.",
      });
    }
    const comparePassword = bcrypt.compareSync(
      password || "",
      user.password || ""
    );
    if (!comparePassword) {
      return res.status(401).send({
        success: false,
        message: "Password does not match",
      });
    }
    jwtToken(user._id, res);
    return res.status(200).send({
      success: true,
      _id: user._id,
      fullname: user.fullname,
      profilePic: user.profilePicture || null,
      email: user.email,
      message: "Successfully logged in",
    });
  } catch (error) {
    console.log(`error while logging in: ${error}`);
    return res.status(500).send({ success: false, message: error.toString() });
  }
};

const userLogout = async (req, res, next) => {
  try {
    res.cookie("jwt", "", {
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      maxAge: 0,
    });
    return res.status(200).send({
      success: true,
      message: "user logged out",
    });
  } catch (error) {
    console.error("Logout error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error during logout",
    });
  }
};

module.exports = { userRegister, userLogin, userLogout };
