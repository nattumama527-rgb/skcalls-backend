// ===== SKCALLS v2.0 - ENTERPRISE BACKEND =====
// Roles: SuperAdmin → Admin → Supervisor → Agent

const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const xlsx = require('xlsx');
const upload = multer({ storage: multer.memoryStorage() });

const app = express();
app.use(cors());
app.use(express.json());

// =====================================================
// YOUR STRINGEE KEYS
// =====================================================
const STRINGEE_APP_ID     = 'SK.0.1Dm2hdsgSQvu3YWXZkWyFw8Ju0CX4R15';
const STRINGEE_APP_SECRET = 'elpZbXhnY1I4M1FzbThUdVc1QzV4RzdPdk1tV0g5YQ==';
// =====================================================
// WHATSAPP ALERTS (Twilio WhatsApp or CallMeBot)
// =====================================================
const WHATSAPP_API_KEY  = 'YOUR_CALLMEBOT_API_KEY'; // get free at callmebot.com
const WHATSAPP_NUMBER   = '+971XXXXXXXXX';            // your WhatsApp number
// =====================================================

// ===== IN-MEMORY DATABASE (Replace with MySQL/MongoDB for production) =====
let db = {
  superadmin: {
    id: 'superadmin',
    username: 'superadmin',
    password: bcrypt.hashSync('SuperAdmin@2026', 10),
    role: 'superadmin',
    name: 'Main Admin'
  },
  admins: {},      // adminId → admin object
  supervisors: {}, // supervisorId → supervisor object
  agents: {},      // agentId → agent object
  callLogs: [],    // all call records
  minuteUsage: {}, // userId → minutes used
};

// ===== JWT HELPERS =====
const JWT_SECRET = 'SKCALLS_SECRET_KEY_2026_ENTERPRISE';

function generateToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '12h' });
}

function verifyToken(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ success: false, message: 'No token' });
  try {
    req.user = jwt.verify(auth.split(' ')[1], JWT_SECRET);
    next();
  } catch(e) {
    res.status(401).json({ success: false, message: 'Invalid token' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Insufficient permissions' });
    }
    next();
  };
}

// ===== STRINGEE TOKEN GENERATOR =====
function generateStringeeToken(userId) {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign({
    jti: STRINGEE_APP_ID + '-' + now,
    iss: STRINGEE_APP_ID,
    exp: now + 86400,
    userId
  }, STRINGEE_APP_SECRET, {
    algorithm: 'HS256',
    header: { typ: 'JWT', alg: 'HS256', cty: 'stringee-api;v=1' }
  });
}

// ===== MINUTE TRACKING =====
function getMinutesUsed(userId) {
  return db.minuteUsage[userId] || 0;
}

function addMinutes(userId, minutes) {
  db.minuteUsage[userId] = (db.minuteUsage[userId] || 0) + minutes;
}

function checkMinuteLimit(agentId) {
  const agent = db.agents[agentId];
  if (!agent) return { allowed: false, reason: 'Agent not found' };
  const admin = db.admins[agent.adminId];
  if (!admin) return { allowed: false, reason: 'Admin not found' };

  const agentUsed = getMinutesUsed(agentId);
  const adminUsed = getMinutesUsed(agent.adminId);

  if (agent.minuteLimit > 0 && agentUsed >= agent.minuteLimit)
    return { allowed: false, reason: `Agent minute limit reached (${agent.minuteLimit} mins)` };
  if (admin.minuteLimit > 0 && adminUsed >= admin.minuteLimit)
    return { allowed: false, reason: `Account minute limit reached (${admin.minuteLimit} mins)` };

  return { allowed: true };
}

// ===== WHATSAPP ALERT =====
async function sendWhatsAppAlert(message) {
  if (!WHATSAPP_API_KEY || WHATSAPP_API_KEY === 'YOUR_CALLMEBOT_API_KEY') return;
  try {
    const encoded = encodeURIComponent(message);
    const number = WHATSAPP_NUMBER.replace('+', '');
    await fetch(`https://api.callmebot.com/whatsapp.php?phone=${number}&text=${encoded}&apikey=${WHATSAPP_API_KEY}`);
  } catch(e) { console.log('WhatsApp alert failed:', e.message); }
}

function checkAndAlertMinutes(adminId) {
  const admin = db.admins[adminId];
  if (!admin || admin.minuteLimit <= 0) return;
  const used = getMinutesUsed(adminId);
  const pct = (used / admin.minuteLimit) * 100;
  if (pct >= 80 && pct < 81) {
    sendWhatsAppAlert(`⚠️ SKCalls Alert: Admin "${admin.name}" has used 80% of their minutes (${used}/${admin.minuteLimit})`);
  }
  if (pct >= 95 && pct < 96) {
    sendWhatsAppAlert(`🚨 SKCalls URGENT: Admin "${admin.name}" has used 95% of minutes! Only ${admin.minuteLimit - used} mins left.`);
  }
}

// ===========================
// ===== AUTH ROUTES =====
// ===========================

// Universal Login
app.post('/api/auth/login', async (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password) return res.status(400).json({ success: false, message: 'Username and password required' });

  let user = null;

  if (role === 'superadmin' || username === 'superadmin') {
    if (username === db.superadmin.username && bcrypt.compareSync(password, db.superadmin.password)) {
      user = db.superadmin;
    }
  } else if (role === 'admin') {
    user = Object.values(db.admins).find(a => a.username === username);
    if (user && !bcrypt.compareSync(password, user.password)) user = null;
  } else if (role === 'supervisor') {
    user = Object.values(db.supervisors).find(s => s.username === username);
    if (user && !bcrypt.compareSync(password, user.password)) user = null;
  } else if (role === 'agent') {
    user = Object.values(db.agents).find(a => a.username === username);
    if (user && !bcrypt.compareSync(password, user.password)) user = null;
  }

  if (!user) return res.status(401).json({ success: false, message: 'Invalid credentials' });
  if (user.suspended) return res.status(403).json({ success: false, message: 'Account suspended. Contact your admin.' });

  const token = generateToken({ id: user.id, username: user.username, role: user.role, name: user.name, adminId: user.adminId });
  let stringeeToken = null;
  if (user.role === 'agent') {
    const check = checkMinuteLimit(user.id);
    if (check.allowed) stringeeToken = generateStringeeToken(user.id);
  }

  res.json({ success: true, token, stringeeToken, user: { id: user.id, username: user.username, role: user.role, name: user.name } });
});

// Refresh Stringee Token
app.post('/api/auth/stringee-token', verifyToken, requireRole('agent'), (req, res) => {
  const check = checkMinuteLimit(req.user.id);
  if (!check.allowed) return res.status(403).json({ success: false, message: check.reason });
  res.json({ success: true, token: generateStringeeToken(req.user.id) });
});

// ===========================
// ===== SUPERADMIN ROUTES =====
// ===========================

// Get dashboard stats
app.get('/api/superadmin/dashboard', verifyToken, requireRole('superadmin'), (req, res) => {
  const admins = Object.values(db.admins);
  const agents = Object.values(db.agents);
  const totalMinutes = db.callLogs.reduce((sum, c) => sum + (c.duration || 0), 0) / 60;
  res.json({
    success: true,
    stats: {
      totalAdmins: admins.length,
      totalAgents: agents.length,
      totalCalls: db.callLogs.length,
      totalMinutes: Math.round(totalMinutes),
      activeAdmins: admins.filter(a => !a.suspended).length,
    },
    admins: admins.map(a => ({
      ...a, password: undefined,
      minutesUsed: getMinutesUsed(a.id),
      agentCount: Object.values(db.agents).filter(ag => ag.adminId === a.id).length
    }))
  });
});

// Create Admin
app.post('/api/superadmin/admins', verifyToken, requireRole('superadmin'), async (req, res) => {
  const { username, password, name, minuteLimit, phone } = req.body;
  if (!username || !password || !name) return res.status(400).json({ success: false, message: 'username, password, name required' });
  if (Object.values(db.admins).find(a => a.username === username))
    return res.status(400).json({ success: false, message: 'Username already exists' });

  const id = 'admin_' + Date.now();
  db.admins[id] = { id, username, password: bcrypt.hashSync(password, 10), name, role: 'admin', minuteLimit: minuteLimit || 0, phone: phone || '', suspended: false, createdAt: new Date().toISOString() };
  res.json({ success: true, message: 'Admin created', id });
});

// Update Admin (minute limit, suspend, reset password)
app.put('/api/superadmin/admins/:id', verifyToken, requireRole('superadmin'), async (req, res) => {
  const admin = db.admins[req.params.id];
  if (!admin) return res.status(404).json({ success: false, message: 'Admin not found' });
  const { minuteLimit, suspended, password, name, phone } = req.body;
  if (minuteLimit !== undefined) admin.minuteLimit = minuteLimit;
  if (suspended !== undefined) admin.suspended = suspended;
  if (password) admin.password = bcrypt.hashSync(password, 10);
  if (name) admin.name = name;
  if (phone) admin.phone = phone;
  res.json({ success: true, message: 'Admin updated' });
});

// Delete Admin
app.delete('/api/superadmin/admins/:id', verifyToken, requireRole('superadmin'), (req, res) => {
  if (!db.admins[req.params.id]) return res.status(404).json({ success: false, message: 'Not found' });
  delete db.admins[req.params.id];
  res.json({ success: true, message: 'Admin deleted' });
});

// All call logs (superadmin sees everything)
app.get('/api/superadmin/calls', verifyToken, requireRole('superadmin'), (req, res) => {
  res.json({ success: true, data: db.callLogs.slice(0, 500) });
});

// Reset any password
app.post('/api/superadmin/reset-password', verifyToken, requireRole('superadmin'), async (req, res) => {
  const { userId, role, newPassword } = req.body;
  let user = role === 'admin' ? db.admins[userId] : role === 'supervisor' ? db.supervisors[userId] : db.agents[userId];
  if (!user) return res.status(404).json({ success: false, message: 'User not found' });
  user.password = bcrypt.hashSync(newPassword, 10);
  res.json({ success: true, message: 'Password reset successfully' });
});

// ===========================
// ===== ADMIN ROUTES =====
// ===========================

app.get('/api/admin/dashboard', verifyToken, requireRole('admin'), (req, res) => {
  const adminId = req.user.id;
  const myAgents = Object.values(db.agents).filter(a => a.adminId === adminId);
  const mySupervisors = Object.values(db.supervisors).filter(s => s.adminId === adminId);
  const myCalls = db.callLogs.filter(c => c.adminId === adminId);
  const totalMinutes = myCalls.reduce((sum, c) => sum + (c.duration || 0), 0) / 60;
  const admin = db.admins[adminId];

  res.json({
    success: true,
    stats: {
      totalAgents: myAgents.length,
      totalSupervisors: mySupervisors.length,
      totalCalls: myCalls.length,
      minutesUsed: getMinutesUsed(adminId),
      minuteLimit: admin.minuteLimit,
      totalMinutes: Math.round(totalMinutes),
    },
    agents: myAgents.map(a => ({ ...a, password: undefined, minutesUsed: getMinutesUsed(a.id) })),
    supervisors: mySupervisors.map(s => ({ ...s, password: undefined }))
  });
});

// Create Agent
app.post('/api/admin/agents', verifyToken, requireRole('admin'), async (req, res) => {
  const { username, password, name, minuteLimit } = req.body;
  if (!username || !password || !name) return res.status(400).json({ success: false, message: 'username, password, name required' });
  if (Object.values(db.agents).find(a => a.username === username))
    return res.status(400).json({ success: false, message: 'Username already taken' });

  const id = 'agent_' + Date.now();
  db.agents[id] = { id, username, password: bcrypt.hashSync(password, 10), name, role: 'agent', adminId: req.user.id, minuteLimit: minuteLimit || 0, suspended: false, createdAt: new Date().toISOString() };
  res.json({ success: true, message: 'Agent created', id });
});

// Create Supervisor
app.post('/api/admin/supervisors', verifyToken, requireRole('admin'), async (req, res) => {
  const { username, password, name } = req.body;
  if (!username || !password || !name) return res.status(400).json({ success: false, message: 'Fields required' });
  if (Object.values(db.supervisors).find(s => s.username === username))
    return res.status(400).json({ success: false, message: 'Username already taken' });

  const id = 'sup_' + Date.now();
  db.supervisors[id] = { id, username, password: bcrypt.hashSync(password, 10), name, role: 'supervisor', adminId: req.user.id, suspended: false, createdAt: new Date().toISOString() };
  res.json({ success: true, message: 'Supervisor created', id });
});

// Update agent (limit, suspend, password reset)
app.put('/api/admin/agents/:id', verifyToken, requireRole('admin'), async (req, res) => {
  const agent = db.agents[req.params.id];
  if (!agent || agent.adminId !== req.user.id) return res.status(404).json({ success: false, message: 'Not found' });
  const { minuteLimit, suspended, password, name } = req.body;
  if (minuteLimit !== undefined) agent.minuteLimit = minuteLimit;
  if (suspended !== undefined) agent.suspended = suspended;
  if (password) agent.password = bcrypt.hashSync(password, 10);
  if (name) agent.name = name;
  res.json({ success: true, message: 'Agent updated' });
});

// Delete agent
app.delete('/api/admin/agents/:id', verifyToken, requireRole('admin'), (req, res) => {
  const agent = db.agents[req.params.id];
  if (!agent || agent.adminId !== req.user.id) return res.status(404).json({ success: false, message: 'Not found' });
  delete db.agents[req.params.id];
  res.json({ success: true });
});

// Admin call logs
app.get('/api/admin/calls', verifyToken, requireRole('admin'), (req, res) => {
  const calls = db.callLogs.filter(c => c.adminId === req.user.id);
  res.json({ success: true, data: calls });
});

// Bulk import contacts via Excel
app.post('/api/admin/import-contacts', verifyToken, requireRole('admin', 'supervisor'), upload.single('file'), (req, res) => {
  try {
    const wb = xlsx.read(req.file.buffer, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = xlsx.utils.sheet_to_json(ws);
    const contacts = rows.map(r => ({
      name: r['Name'] || r['name'] || '',
      number: String(r['Number'] || r['Phone'] || r['number'] || r['phone'] || '').trim(),
      adminId: req.user.adminId || req.user.id
    })).filter(c => c.number);
    res.json({ success: true, contacts, count: contacts.length });
  } catch(e) {
    res.status(400).json({ success: false, message: 'Invalid Excel file. Columns needed: Name, Number' });
  }
});

// Export calls as Excel
app.get('/api/admin/calls/export', verifyToken, requireRole('admin', 'supervisor', 'superadmin'), (req, res) => {
  const calls = req.user.role === 'superadmin'
    ? db.callLogs
    : db.callLogs.filter(c => c.adminId === (req.user.adminId || req.user.id));

  const rows = calls.map(c => ({
    Date: c.time, Agent: c.agentName || c.agentId, Direction: c.direction,
    Number: c.number, Duration_Seconds: c.duration || 0,
    Duration_Minutes: ((c.duration || 0) / 60).toFixed(2), Status: c.status
  }));

  const wb = xlsx.utils.book_new();
  const ws = xlsx.utils.json_to_sheet(rows);
  xlsx.utils.book_append_sheet(wb, ws, 'Call Logs');
  const buf = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', 'attachment; filename=call-logs.xlsx');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

// ===========================
// ===== SUPERVISOR ROUTES =====
// ===========================

app.get('/api/supervisor/dashboard', verifyToken, requireRole('supervisor'), (req, res) => {
  const adminId = req.user.adminId;
  const agents = Object.values(db.agents).filter(a => a.adminId === adminId);
  const calls = db.callLogs.filter(c => c.adminId === adminId);
  res.json({
    success: true,
    agents: agents.map(a => ({ ...a, password: undefined, minutesUsed: getMinutesUsed(a.id) })),
    recentCalls: calls.slice(0, 100)
  });
});

// ===========================
// ===== CALL LOG ROUTES =====
// ===========================

app.post('/api/calls/log', verifyToken, (req, res) => {
  const agent = db.agents[req.user.id];
  const entry = {
    id: Date.now(),
    agentId: req.user.id,
    agentName: req.user.name,
    adminId: agent ? agent.adminId : req.user.adminId,
    time: new Date().toLocaleString(),
    ...req.body
  };
  db.callLogs.unshift(entry);
  if (db.callLogs.length > 5000) db.callLogs = db.callLogs.slice(0, 5000);

  // Track minutes
  const mins = (entry.duration || 0) / 60;
  if (agent) {
    addMinutes(req.user.id, mins);
    addMinutes(agent.adminId, mins);
    checkAndAlertMinutes(agent.adminId);
  }

  res.json({ success: true });
});

// Get agent's own calls
app.get('/api/calls/mine', verifyToken, requireRole('agent'), (req, res) => {
  const calls = db.callLogs.filter(c => c.agentId === req.user.id);
  res.json({ success: true, data: calls });
});

// Live active calls (for supervisor monitoring)
let activeCalls = {};
app.post('/api/calls/active', verifyToken, requireRole('agent'), (req, res) => {
  const { callId, number, status } = req.body;
  if (status === 'ended') {
    delete activeCalls[req.user.id];
  } else {
    activeCalls[req.user.id] = { agentId: req.user.id, agentName: req.user.name, callId, number, startedAt: new Date().toISOString(), adminId: db.agents[req.user.id]?.adminId };
  }
  res.json({ success: true });
});

app.get('/api/calls/active', verifyToken, requireRole('supervisor', 'admin', 'superadmin'), (req, res) => {
  const adminId = req.user.role === 'superadmin' ? null : (req.user.adminId || req.user.id);
  const calls = Object.values(activeCalls).filter(c => !adminId || c.adminId === adminId);
  res.json({ success: true, data: calls });
});

// ===========================
// ===== STATS/ANALYTICS =====
// ===========================

app.get('/api/stats/usage', verifyToken, (req, res) => {
  let calls;
  if (req.user.role === 'superadmin') calls = db.callLogs;
  else if (req.user.role === 'agent') calls = db.callLogs.filter(c => c.agentId === req.user.id);
  else calls = db.callLogs.filter(c => c.adminId === (req.user.adminId || req.user.id));

  // Group by day for chart
  const byDay = {};
  calls.forEach(c => {
    const day = c.time ? c.time.split(',')[0] : 'Unknown';
    if (!byDay[day]) byDay[day] = { calls: 0, minutes: 0 };
    byDay[day].calls++;
    byDay[day].minutes += (c.duration || 0) / 60;
  });

  const chartData = Object.entries(byDay).slice(-14).map(([date, data]) => ({
    date, calls: data.calls, minutes: Math.round(data.minutes)
  }));

  res.json({ success: true, chartData, totalCalls: calls.length, totalMinutes: Math.round(calls.reduce((s,c) => s+(c.duration||0),0)/60) });
});

// Health check
app.get('/', (req, res) => res.json({ status: '✅ SKCalls v2.0 Enterprise Backend', version: '2.0' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 SKCalls v2.0 Enterprise Backend on port ${PORT}`);
  console.log(`👑 SuperAdmin: superadmin / SuperAdmin@2026`);
});
