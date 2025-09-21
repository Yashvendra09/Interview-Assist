const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  uniqueId: { type: String, required: true, index: true },
  name: { type: String, required: true },
  email: { type: String },
  createdAt: { type: Date, default: Date.now }
});

userSchema.index({ uniqueId: 1 }, { unique: true });

module.exports = mongoose.model('User', userSchema);
