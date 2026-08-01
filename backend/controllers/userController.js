const User = require("../models/user");
const bcrypt = require("bcrypt");
const jwtToken = require("../utils/jwttoken");
const AppError = require("../utils/AppError");

const userRegister = async (req, res, next) => {
  try {
    const { fullname, username, email, gender, password, profilePicture } =
      req.body || {};

    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return next(new AppError(409, "Username or email already exists"));
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

    await newUser.save();
    jwtToken(newUser._id, res);

    return res.status(201).send({
      success: true,
      _id: newUser._id,
      fullname: newUser.fullname,
      profilePic: profilePic,
      email: newUser.email,
      message: "new user is registered",
      about: newUser.about,
      messagePrivacy: newUser.messagePrivacy,
    });
  } catch (error) {
    next(error);
  }
};

const userLogin = async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    const user = await User.findOne({ username });
    if (!user) {
      return next(new AppError(404, "User not found. Please register first."));
    }
    const comparePassword = bcrypt.compareSync(
      password || "",
      user.password || ""
    );
    if (!comparePassword) {
      return next(new AppError(401, "Password does not match"));
    }
    jwtToken(user._id, res);
    return res.status(200).send({
      success: true,
      _id: user._id,
      fullname: user.fullname,
      profilePic: user.profilePicture || null,
      email: user.email,
      gender: user.gender,
      username: user.username,
      message: "Successfully logged in",
      about: user.about,
      messagePrivacy: user.messagePrivacy,
    });
  } catch (error) {
    next(error);
  }
};

const userLogout = async (req, res, next) => {
  try {
    const isProd = process.env.NODE_ENV === "production";
    res.cookie("jwt", "", {
      httpOnly: true,
      secure: isProd,
      sameSite: "strict",
      maxAge: 0,
    });
    return res.status(200).send({
      success: true,
      message: "user logged out",
    });
  } catch (error) {
    next(error);
  }
};

module.exports = { userRegister, userLogin, userLogout };
