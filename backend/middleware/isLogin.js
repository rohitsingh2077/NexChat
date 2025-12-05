const express = require('express')
const jwt =require('jsonwebtoken')
const User = require('../models/user.js');

const isLogin =async(req,res,next)=>{
    try {
      const token = req.cookies.jwt;
      if(!token){
        //user is unauthorised
        return res.status(500).send({
          success:false,
          message: "user unauthorised",
        })
      }
      const decode = jwt.verify(token,process.env.JWT_SECRET);
      if(!decode){
        return res.status(401).send({
          success:false,
          message:"User unauthorised : invalid token",
        })
      }
      const user =await User.findById(decode.userId).select("-password");
      if(!user){
        return res.status(500).send({
          success: false,
          message: "User not found",
        })
      }
      req.user = user;
      next();
    } catch (error) {
      return res.status(500).send({
        success:false,
        message:"error in islogin middleware",
      })
    }
}

module.exports=  isLogin;