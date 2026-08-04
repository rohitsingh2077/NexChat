const express = require('express')
const dotenv  = require("dotenv");
const dbconnect  = require('./DB/dbconnect')
dotenv.config(); // can access the dotenv from anywhere
const cookieParser = require("cookie-parser");

const {app,server} = require('./realtime/socket.js');
const path = require("path");
const root = path.resolve();

//external modules
const authRouter = require('./routes/authRouter');
const messageRouter = require('./routes/messsageRoute')
const userRouter =require('./routes/userRouter')
const updateRouter = require('./routes/updateRouter.js');
const friendRouter = require('./routes/friendRoutes.js');
const serverRouter = require('./modules/servers/server.routes.js');
const errorHandler = require('./middleware/errorHandler.js');

app.use(cookieParser());

//middleware
app.use(express.json()); // for JSON bodies
app.use(express.urlencoded({ extended: true }));

app.use('/api/auth',authRouter);
app.use('/api/message',messageRouter);
app.use('/api/user',userRouter);
app.use('/api/update',updateRouter);
app.use('/api/friends',friendRouter);
app.use('/api/servers',serverRouter);

app.use(express.static(path.join(root,'/frontend/dist')));

app.get(/.*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'dist', 'index.html'));
});

// Must be registered last: catches errors forwarded via next(error) from any
// route/middleware above and returns one consistent, safe response shape.
app.use(errorHandler);

PORT = process.env.PORT || 3001;

// Connect to DB first, then start server
dbconnect().then(() => {
  server.listen(PORT, ()=>{
    console.log(` server is running live on http://localhost:${PORT}`);
  })
}).catch(error => {
  console.log(`Failed to start server: ${error}`);
  process.exit(1);
})
