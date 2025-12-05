const mongoose = require('mongoose');

const dbconnect = async () => {
  try {
    console.log('Attempting to connect to MongoDB...');
    await mongoose.connect(process.env.MONGODB_CONNECT);
    console.log('Mongoose connected successfully');
  } catch (error) {
    console.error('Mongoose connection error:', error);
    // Rethrow so callers can handle the failure (prevent server from starting)
    throw error;
  }
};

module.exports = dbconnect;