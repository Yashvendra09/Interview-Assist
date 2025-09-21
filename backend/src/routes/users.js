const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Session = require('../models/Session');

/**
 * Create or return user by uniqueId.
 * POST /api/users
 * body: { uniqueId: "ABC123", name: "Yash", email?: "..." }
 */
router.post('/', async (req, res) => {
  try {
    const { uniqueId, name, email } = req.body;
    if (!uniqueId || !name) return res.status(400).json({ error: 'uniqueId and name required' });

    let user = await User.findOne({ uniqueId });
    if (!user) {
      user = new User({ uniqueId, name, email });
      await user.save();
    }
    return res.json(user);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'server error' });
  }
});

/**
 * Get user by uniqueId
 * GET /api/users/:uniqueId
 */
router.get('/:uniqueId', async (req, res) => {
  try {
    const user = await User.findOne({ uniqueId: req.params.uniqueId });
    if (!user) return res.status(404).json({ error: 'User not found' });
    return res.json(user);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'server error' });
  }
});

/**
 * List sessions for a user (paginated)
 * GET /api/users/:uniqueId/sessions
 */
router.get('/:uniqueId/sessions', async (req, res) => {
  try {
    const user = await User.findOne({ uniqueId: req.params.uniqueId });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const page = Math.max(0, parseInt(req.query.page || '0'));
    const limit = Math.min(100, parseInt(req.query.limit || '20'));

    const sessions = await Session.find({ user: user._id })
      .sort({ startedAt: -1 })
      .skip(page * limit)
      .limit(limit)
      .lean();

    return res.json({ sessions, page, limit });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'server error' });
  }
});

module.exports = router;
