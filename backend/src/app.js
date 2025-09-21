require('dotenv').config();
const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');

const users = require('./routes/users');
const sessions = require('./routes/sessions');

const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

connectDB(process.env.MONGO_URI);

app.use('/api/users', users);
app.use('/api/sessions', sessions);

app.get('/', (req, res) => res.json({ ok: true, msg: 'Focus Track Backend (minimal)'}));

module.exports = app;
