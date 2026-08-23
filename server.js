// ===== SKCALLS BACKEND SERVER =====
// Generates Stringee Access Tokens for agents

const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');

const app = express();
app.use(cors());
app.use(express.json());

// ====================================================
// YOUR STRINGEE KEYS — ALREADY FILLED IN
// ====================================================
const STRINGEE_APP_ID     = 'SK.0.1Dm2hdsgSQvu3YWXZkWyFw8Ju0CX4R15';
const STRINGEE_APP_SECRET = 'elpZbXhnY1I4M1FzbThUdVc1QzV4RzdPdk1tV0g5YQ==';
// ====================================================

// ====================================================
// ADD YOUR AGENTS HERE
// Format: 'agentUsername': 'their_password'
// ====================================================
const AGENTS = {
  'admin':    'admin123',
  'agent001': 'pass123',
  'agent002': 'pass456',
  'agent003': 'pass789',
};
// ====================================================

// Generate Stringee JWT token (exact format Stringee requires)
function generateStringeeToken(userId) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    jti: STRINGEE_APP_ID + '-' + now,
    iss: STRINGEE_APP_ID,
    exp: now + (24 * 3600), // expires in 24 hours
    userId: userId,
  };
  return jwt.sign(payload, STRINGEE_APP_SECRET, {
    algorithm: 'HS256',
    header: {
      typ: 'JWT',
      alg: 'HS256',
      cty: 'stringee-api;v=1'
    }
  });
}

// ===== ROUTES =====

// Health check
app.get('/', (req, res) => {
  res.json({ status: '✅ SKCalls backend is running!', time: new Date().toISOString() });
});

// Agent login → returns Stringee access token
app.post('/api/login', (req, res) => {
  const { agentId, password } = req.body;
  if (!agentId || !password) {
    return res.status(400).json({ success: false, message: 'agentId and password required' });
  }
  if (!AGENTS[agentId] || AGENTS[agentId] !== password) {
    return res.status(401).json({ success: false, message: 'Wrong username or password' });
  }
  const token = generateStringeeToken(agentId);
  console.log(`✅ Token generated for agent: ${agentId}`);
  res.json({ success: true, token, agentId });
});

// Refresh token
app.post('/api/refresh-token', (req, res) => {
  const { agentId } = req.body;
  if (!agentId || !AGENTS[agentId]) {
    return res.status(401).json({ success: false, message: 'Invalid agent' });
  }
  const token = generateStringeeToken(agentId);
  res.json({ success: true, token });
});

// Save call log entry
let serverCallLog = [];
app.post('/api/calllog', (req, res) => {
  serverCallLog.unshift({ ...req.body, savedAt: new Date().toISOString() });
  if (serverCallLog.length > 1000) serverCallLog = serverCallLog.slice(0, 1000);
  res.json({ success: true });
});

// Get call logs (admin)
app.get('/api/calllog', (req, res) => {
  res.json({ success: true, total: serverCallLog.length, data: serverCallLog });
});

// Add new agent (admin API)
app.post('/api/agents', (req, res) => {
  const { adminKey, agentId, password } = req.body;
  if (adminKey !== 'SKCALLS_ADMIN_KEY_2026') {
    return res.status(403).json({ success: false, message: 'Unauthorized' });
  }
  AGENTS[agentId] = password;
  res.json({ success: true, message: `Agent ${agentId} created` });
});

// ===== START =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🚀 SKCalls Backend Running!`);
  console.log(`📡 Port: ${PORT}`);
  console.log(`🔑 App ID: ${STRINGEE_APP_ID}`);
  console.log(`👥 Agents loaded: ${Object.keys(AGENTS).join(', ')}\n`);
});
