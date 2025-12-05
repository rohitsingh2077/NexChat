const express = require('express')
const dotenv  = require("dotenv");
const dbconnect  = require('./DB/dbconnect')
dotenv.config(); // can access the dotenv from anywhere

const app = express();

//external modules
const authRouter = require('./routes/authRouter');
const messageRouter = require('./routes/messsageRoute')
const userRouter =require('./routes/userRouter')
const cookieParser = require("cookie-parser");
app.use(cookieParser());

//middleware
app.use(express.json()); // for JSON bodies
app.use(express.urlencoded({ extended: true }));

app.use('/api/auth',authRouter);
app.use('/api/message',messageRouter);
app.use('/api/user',userRouter);

PORT = process.env.PORT || 3001;

// Connect to DB first, then start server
dbconnect().then(() => {
  app.listen(PORT, ()=>{
    console.log(` server is running live on http://localhost:${PORT}`);
  })
}).catch(error => {
  console.log(`Failed to start server: ${error}`);
  process.exit(1);
})
