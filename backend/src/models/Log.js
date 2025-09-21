const mongoose = require('mongoose');

const logSchema = new mongoose.Schema({
  session: { type: mongoose.Schema.Types.ObjectId, ref: 'Session', required: true },
  type: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
  payload: { type: Object }
});

logSchema.index({ session: 1, timestamp: 1 });

module.exports = mongoose.model('Log', logSchema);
