const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Session = require('../models/Session');
const Log = require('../models/Log');

/**
 * Create a new session for a user (by uniqueId)
 * POST /api/sessions
 * body: { uniqueId, metadata?: {} }
 */
router.post('/', async (req, res) => {
  try {
    const { uniqueId, metadata } = req.body;
    if (!uniqueId) return res.status(400).json({ error: 'uniqueId required' });

    const user = await User.findOne({ uniqueId });
    if (!user) return res.status(404).json({ error: 'User not found. Create user first via /api/users' });

    const session = new Session({ user: user._id, metadata: metadata || {} });
    await session.save();

    return res.status(201).json(session);
  } catch (err) {
    console.error('POST /api/sessions error:', err);
    return res.status(500).json({ error: 'server error' });
  }
});

/**
 * End session (set endedAt)
 * PATCH /api/sessions/:sessionId/end
 */
router.patch('/:sessionId/end', async (req, res) => {
  try {
    const session = await Session.findById(req.params.sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    session.endedAt = new Date();
    await session.save();

    return res.json(session);
  } catch (err) {
    console.error(`PATCH /api/sessions/${req.params.sessionId}/end error:`, err);
    return res.status(500).json({ error: 'server error' });
  }
});

/**
 * Add logs to a session
 * POST /api/sessions/:sessionId/logs
 * body: { type: "...", timestamp?: ISOString, payload?: {} }  OR array of such objects
 */
router.post('/:sessionId/logs', async (req, res) => {
  try {
    const session = await Session.findById(req.params.sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const body = req.body;
    const items = Array.isArray(body) ? body : [body];

    const docs = items.map(it => ({
      session: session._id,
      type: it.type || 'unknown',
      timestamp: it.timestamp ? new Date(it.timestamp) : new Date(),
      payload: it.payload || {}
    }));

    const created = await Log.insertMany(docs);

    return res.status(201).json({ inserted: created.length });
  } catch (err) {
    console.error(`POST /api/sessions/${req.params.sessionId}/logs error:`, err);
    return res.status(500).json({ error: 'server error' });
  }
});

/**
 * Get logs for a session (paginated)
 * GET /api/sessions/:sessionId/logs
 */
router.get('/:sessionId/logs', async (req, res) => {
  try {
    const sessionId = req.params.sessionId;
    const page = Math.max(0, parseInt(req.query.page || '0'));
    const limit = Math.min(1000, parseInt(req.query.limit || '100'));

    const logs = await Log.find({ session: sessionId })
      .sort({ timestamp: 1 })
      .skip(page * limit)
      .limit(limit)
      .lean();

    return res.json({ logs, page, limit });
  } catch (err) {
    console.error(`GET /api/sessions/${req.params.sessionId}/logs error:`, err);
    return res.status(500).json({ error: 'server error' });
  }
});

module.exports = router;
