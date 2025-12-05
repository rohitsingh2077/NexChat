const jwt = require("jsonwebtoken");

const jwtToken = (userId, res) => {
  const token = jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: "30d",
  });
  console.log(token);
  res.cookie('jwt', token, {
    httpOnly: true,
    secure: true,
    maxAge: 24 * 60 * 60 * 1000,
    sameSite:'Strict',
  });
  res.cookie('theme','dark',{
    maxAge: 24*60*60*1000,
    sameSite: 'Strict',
    secure:true
  })
};
module.exports = jwtToken;