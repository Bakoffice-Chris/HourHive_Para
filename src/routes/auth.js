const express = require('express');
const db = require('../db');
const { hashPassword, verifyPassword, issueToken } = require('../auth');

const router = express.Router();

router.post('/register', (req, res) => {
  const { orgName, name, email, password } = req.body;
  if (!orgName || !name || !email || !password) {
    return res.status(400).json({ error: 'orgName, name, email, and password are required' });
  }
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) return res.status(409).json({ error: 'An account with that email already exists' });

  const orgInfo = db.prepare('INSERT INTO organizations (name) VALUES (?)').run(orgName);
  const orgId = orgInfo.lastInsertRowid;
  const userInfo = db
    .prepare('INSERT INTO users (org_id, email, password_hash, name, role) VALUES (?, ?, ?, ?, ?)')
    .run(orgId, email, hashPassword(password), name, 'admin');

  const user = { id: userInfo.lastInsertRowid, org_id: orgId, email, name, role: 'admin' };
  res.json({ token: issueToken(user), user });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  res.json({
    token: issueToken(user),
    user: { id: user.id, org_id: user.org_id, email: user.email, name: user.name, role: user.role },
  });
});

module.exports = router;
