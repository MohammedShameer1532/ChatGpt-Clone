const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  prompt: { type: String },
  response: { type: String },
  name: { type: String },
  email: { type: String},
  password: { type: String},
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'Users' },
});

const UserModel = mongoose.model('Users', userSchema, 'chat')
module.exports = UserModel;