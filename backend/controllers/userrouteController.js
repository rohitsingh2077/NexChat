const Conversation = require("../models/conversationModel");
const User = require("../models/user");

const getUserBySearch = async (req, res) => {
  try {
    const search = req.query.search || "";
    const currentUser = req.user._id;

    const users = await User.find({
      _id: { $ne: currentUser }, // exclude logged-in user

      $or: [
        { username: { $regex: search, $options: "i" } },
        { fullname: { $regex: search, $options: "i" } },
      ],
    }).select("-password"); // never return password
    console.log(users);
    return res.status(200).json({
      success: true,
      users,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: "Error searching users",
    });
  }
};

const getcurrentChatters = async(req,res)=>{
  try {
    const currentUser = req.user._id;
    const currentChatters= await Conversation.find({
          participants:currentUser
    }).sort({
      updatedAt:-1
    }).populate('participants','-password');
    if(currentChatters.length ===0){
      return res.status(200).send({
        message:"We are lonely",
      })
    }
    console.log(currentChatters);
    return res.status(200).send({
      success:true,
      conversations:currentChatters
    })
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: "Error searching users",
    });
  }
}

module.exports = { getUserBySearch,getcurrentChatters };
