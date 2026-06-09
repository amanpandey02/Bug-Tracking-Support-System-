// scripts/seed.js — Populate DB with realistic demo data
'use strict';

const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const { v4: uuid } = require('uuid');
require('dotenv').config();

// Run migration first
require('./migrate.js');

const db = new Database(process.env.DB_PATH || './database/neuralbug.db');
db.pragma('foreign_keys = ON');

const now = () => new Date().toISOString();
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();

// ── USERS ──────────────────────────────────────────────────────────────────
const USERS = [
  { id: uuid(), email: 'admin@neuralbug.io', first_name: 'Arjun', last_name: 'Mehta',
    role: 'Admin', avatar_color: '#00f5a0', password: 'admin123' },
  { id: uuid(), email: 'priya@neuralbug.io', first_name: 'Priya', last_name: 'Sharma',
    role: 'QA Engineer', avatar_color: '#a855f7', password: 'priya123' },
  { id: uuid(), email: 'rohan@neuralbug.io', first_name: 'Rohan', last_name: 'Verma',
    role: 'Developer', avatar_color: '#00d4ff', password: 'rohan123' },
  { id: uuid(), email: 'neha@neuralbug.io', first_name: 'Neha', last_name: 'Kapoor',
    role: 'DevOps', avatar_color: '#ffa800', password: 'neha123' },
  { id: uuid(), email: 'vikram@neuralbug.io', first_name: 'Vikram', last_name: 'Singh',
    role: 'Team Lead', avatar_color: '#ff6b6b', password: 'vikram123' },
];

const insertUser = db.prepare(`
  INSERT OR IGNORE INTO users
  (id, email, password, first_name, last_name, role, avatar_initials, avatar_color, is_active, is_verified, last_login, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?)
`);

for (const u of USERS) {
  const hash = bcrypt.hashSync(u.password, 10);
  const initials = u.first_name[0] + u.last_name[0];
  insertUser.run(u.id, u.email, hash, u.first_name, u.last_name, u.role, initials, u.avatar_color, daysAgo(0), daysAgo(Math.floor(Math.random() * 60)), daysAgo(Math.floor(Math.random() * 60)));
}
console.log(`✅ Seeded ${USERS.length} users`);

const [admin, priya, rohan, neha, vikram] = USERS;

// ── SPRINT ─────────────────────────────────────────────────────────────────
const sprintId = uuid();
db.prepare(`INSERT OR IGNORE INTO sprints (id,name,goal,start_date,end_date,status,story_points_total,story_points_done)
  VALUES (?,?,?,?,?,?,?,?)`)
  .run(sprintId, 'Sprint 14', 'Resolve all critical auth/payment bugs & improve AI accuracy to 97%',
    daysAgo(14), daysAgo(-1), 'active', 50, 34);
console.log('✅ Seeded sprint');

// ── BUGS ───────────────────────────────────────────────────────────────────
const BUGS = [
  { n:1, title:'Auth token refresh race condition causes logout on mobile',
    sev:'critical', status:'open', component:'Auth Service', project:'Auth Service',
    ai_conf:96, assignee: admin.id, reporter: priya.id,
    ai_fix: 'Add mutex lock around token refresh endpoint. Implement request deduplication using a shared Map keyed by userId.',
    ai_root: 'Concurrent refresh calls invalidate each other when multiple tabs reload simultaneously.',
    desc:'When a user has multiple browser tabs open, token refresh calls race each other. The second call invalidates the token from the first, logging the user out.',
    env:'production', points:8 },
  { n:2, title:'Payment gateway double-charge on network timeout retry',
    sev:'critical', status:'in-progress', component:'Payment Gateway', project:'Core API',
    ai_conf:91, assignee: rohan.id, reporter: priya.id,
    ai_fix:'Implement idempotency keys on all Stripe API calls. Store key→chargeId in Redis with 24h TTL.',
    ai_root:'Retry logic re-submits the charge without checking if the original succeeded server-side.',
    desc:'When payment API times out (>30s), the retry mechanism creates a duplicate charge. Reproduced on slow connections.',
    env:'production', points:13 },
  { n:3, title:'Dashboard chart freezes on datasets >10,000 entries',
    sev:'high', status:'open', component:'Analytics', project:'Frontend',
    ai_conf:88, assignee: priya.id, reporter: rohan.id,
    ai_fix:'Switch recharts to virtualized rendering. Aggregate data server-side into 200-point samples.',
    ai_root:'D3 re-renders every data point on window resize; no memoization on large arrays.',
    desc:'Bug analytics chart becomes unresponsive when rendering more than 10k bug entries in the 30-day trend.',
    env:'staging', points:5 },
  { n:4, title:'SQL injection vulnerability in bug search filter',
    sev:'high', status:'open', component:'API', project:'Core API',
    ai_conf:99, assignee: neha.id, reporter: vikram.id,
    ai_fix:'Replace string interpolation with parameterized queries across all search endpoints.',
    ai_root:'Search query uses raw string concatenation: `WHERE title LIKE \'%${q}%\'`',
    desc:'The bug search endpoint concatenates user input directly into SQL query. Confirmed with `\' OR 1=1--`.',
    env:'production', points:8 },
  { n:5, title:'Push notifications not delivered on iOS 17.3+',
    sev:'high', status:'ai-fixing', component:'Mobile Push', project:'Mobile App',
    ai_conf:84, assignee: rohan.id, reporter: priya.id,
    ai_fix:'Update APNs library to v5.x. Add entrypoint key to notification payload for iOS 17.3+ compatibility.',
    ai_root:'iOS 17.3 changed the required payload structure for rich notifications.',
    desc:'Push notifications are silently dropped on devices running iOS 17.3 and above. Device tokens are valid.',
    env:'production', points:5 },
  { n:6, title:'Kanban drag-and-drop breaks on Firefox 124',
    sev:'medium', status:'open', component:'Sprint Board', project:'Frontend',
    ai_conf:79, assignee: priya.id, reporter: admin.id,
    ai_fix:'Replace native HTML5 drag API with react-beautiful-dnd which has cross-browser support.',
    ai_root:'Firefox 124 changed DataTransfer.getData() behavior for drag events.',
    desc:'Dragging cards between Kanban columns silently fails on Firefox 124. Works on Chrome and Safari.',
    env:'production', points:3 },
  { n:7, title:'Memory leak in WebSocket connection pool',
    sev:'high', status:'open', component:'Real-time Engine', project:'Core API',
    ai_conf:93, assignee: neha.id, reporter: rohan.id,
    ai_fix:'Implement connection cleanup on disconnect: clear ping intervals, delete from Map, call ws.terminate().',
    ai_root:'Disconnected clients remain in the activeConnections Map; ping intervals keep running.',
    desc:'Server memory grows ~50MB/hour under normal load. Heap profiling shows WebSocket objects not being GC\'d.',
    env:'production', points:8 },
  { n:8, title:'CSV export truncates bug descriptions over 500 chars',
    sev:'low', status:'resolved', component:'Reports', project:'Core API',
    ai_conf:97, assignee: admin.id, reporter: priya.id,
    ai_fix:'Remove VARCHAR(500) limit on description column. Use TEXT type. Update CSV serialization to stream.',
    ai_root:'Database column has hard 500-char limit applied at export query level.',
    desc:'When exporting bug reports, any description over 500 characters is cut off silently.',
    env:'production', points:2 },
  { n:9, title:'2FA SMS codes not sent to +91 (India) numbers',
    sev:'medium', status:'resolved', component:'Auth Service', project:'Auth Service',
    ai_conf:95, assignee: vikram.id, reporter: neha.id,
    ai_fix:'Update Twilio sender ID for India region. Add Indian phone number format to allowlist.',
    ai_root:'Twilio sender ID not approved for India DLT regulations.',
    desc:'Users with Indian phone numbers do not receive SMS OTPs for 2FA. Twilio logs show "sender not approved".',
    env:'production', points:3 },
  { n:10, title:'Dark mode toggle resets on page refresh',
    sev:'low', status:'open', component:'UI Settings', project:'Frontend',
    ai_conf:82, assignee: priya.id, reporter: admin.id,
    ai_fix:'Persist theme preference to localStorage and read on app init before first render.',
    ai_root:'Theme state stored in React context only; not persisted across sessions.',
    desc:'User\'s dark mode preference is lost on browser refresh. Expected: preference persists via localStorage.',
    env:'production', points:1 },
];

const insertBug = db.prepare(`
  INSERT OR IGNORE INTO bugs
  (id, bug_id, title, description, severity, status, component, project, environment,
   ai_confidence, ai_fix, ai_root_cause, assignee_id, reporter_id,
   sprint_id, story_points, created_at, updated_at, resolved_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
`);

const bugIds = {};
for (const b of BUGS) {
  const id = uuid();
  const bugId = `BUG-${String(b.n).padStart(3,'0')}`;
  bugIds[bugId] = id;
  const createdAt = daysAgo(Math.floor(Math.random() * 30));
  const resolvedAt = b.status === 'resolved' ? daysAgo(Math.floor(Math.random() * 5)) : null;
  insertBug.run(id, bugId, b.title, b.desc, b.sev, b.status, b.component,
    b.project, b.env, b.ai_conf, b.ai_fix, b.ai_root, b.assignee, b.reporter,
    sprintId, b.points, createdAt, createdAt, resolvedAt);
}
console.log(`✅ Seeded ${BUGS.length} bugs`);

// ── ACTIVITY LOG ────────────────────────────────────────────────────────────
const activities = [
  { user: admin.id, bug: bugIds['BUG-008'], action: 'resolved',  desc: 'AI auto-fixed BUG-008 CSV truncation. Deployed to production.' },
  { user: priya.id, bug: bugIds['BUG-001'], action: 'comment',   desc: 'Reproduced on iPhone 14 Pro with 3 tabs open. Priority: immediate.' },
  { user: rohan.id, bug: bugIds['BUG-005'], action: 'ai_fixing', desc: 'AI engine analyzing iOS notification payload schema changes.' },
  { user: neha.id,  bug: bugIds['BUG-004'], action: 'assigned',  desc: 'Security vuln assigned. Patch in progress, ETA 2 hours.' },
  { user: admin.id, bug: bugIds['BUG-002'], action: 'escalated', desc: 'BUG-002 escalated to P0. Payment team notified via PagerDuty.' },
];

const insertActivity = db.prepare(`
  INSERT INTO activity_log (id, user_id, bug_id, action, description, created_at)
  VALUES (?,?,?,?,?,?)
`);
for (const a of activities) {
  insertActivity.run(uuid(), a.user, a.bug, a.action, a.desc, daysAgo(Math.random() * 2));
}
console.log(`✅ Seeded ${activities.length} activity entries`);

// ── NOTIFICATIONS ───────────────────────────────────────────────────────────
const notifs = [
  { user: admin.id, type:'critical', title:'Critical Bug Detected', icon:'🔴',
    msg:'BUG-001 Auth token race condition spiking — 47 users affected in last 10 min', bug:'BUG-001', read:0 },
  { user: admin.id, type:'critical', title:'Payment Gateway Alert', icon:'💳',
    msg:'BUG-002 Double-charge confirmed. 3 transactions affected. Rollback initiated.', bug:'BUG-002', read:0 },
  { user: admin.id, type:'ai', title:'AI Auto-Fixed', icon:'🤖',
    msg:'BUG-008 CSV truncation resolved and deployed automatically with 97% confidence.', bug:'BUG-008', read:0 },
  { user: admin.id, type:'ai', title:'AI Scan Complete', icon:'🔍',
    msg:'Full codebase scan complete. 3 new patterns detected. 1 potential zero-day flagged.', bug:null, read:0 },
  { user: admin.id, type:'warning', title:'Memory Leak Growing', icon:'⚠️',
    msg:'BUG-007 WebSocket memory leak now at 2.1GB. Server restart may be required.', bug:'BUG-007', read:0 },
  { user: admin.id, type:'success', title:'Sprint 14 on Track', icon:'📊',
    msg:'68% complete with 10 days remaining. AI resolution rate: 87%. Great progress!', bug:null, read:1 },
];

const insertNotif = db.prepare(`
  INSERT INTO notifications (id, user_id, type, title, message, bug_id, is_read, icon, created_at)
  VALUES (?,?,?,?,?,?,?,?,?)
`);
for (const n of notifs) {
  const bugId = n.bug ? bugIds[n.bug] : null;
  insertNotif.run(uuid(), n.user, n.type, n.title, n.msg, bugId, n.read, n.icon, daysAgo(Math.random() * 0.5));
}
console.log(`✅ Seeded ${notifs.length} notifications`);

// ── INTEGRATIONS ────────────────────────────────────────────────────────────
const integrations = [
  { name:'github',    status:'connected',    config: JSON.stringify({ repo:'org/app', webhookActive:true, syncPRs:true, createIssues:true }) },
  { name:'jira',      status:'connected',    config: JSON.stringify({ baseUrl:'https://org.atlassian.net', projectKey:'BUG', syncBidirectional:true }) },
  { name:'slack',     status:'connected',    config: JSON.stringify({ channel:'#bugs', notifyCritical:true, notifyAIFix:true, dailyDigest:false }) },
  { name:'pagerduty', status:'connected',    config: JSON.stringify({ escalateOn:['critical'], serviceId:'P123XYZ', autoAck:false }) },
  { name:'datadog',   status:'disconnected', config: JSON.stringify({ site:'datadoghq.com', traceBugs:true }) },
  { name:'sentry',    status:'error',        config: JSON.stringify({ org:'neuralbug', project:'backend', syncErrors:true }),
    error:'Authentication failed: token expired' },
];

const insertInteg = db.prepare(`
  INSERT OR IGNORE INTO integrations (id, name, is_enabled, config, status, last_sync, error_message)
  VALUES (?,?,?,?,?,?,?)
`);
for (const i of integrations) {
  const enabled = i.status === 'connected' ? 1 : 0;
  const lastSync = enabled ? daysAgo(Math.random() * 0.1) : null;
  insertInteg.run(uuid(), i.name, enabled, i.config, i.status, lastSync, i.error || null);
}
console.log(`✅ Seeded ${integrations.length} integrations`);

// ── SETTINGS ─────────────────────────────────────────────────────────────────
const defaults = [
  ['workspace_name',       'NeuralBug HQ',      'general'],
  ['workspace_url',        'neuralbug.io',       'general'],
  ['timezone',             'Asia/Kolkata',       'general'],
  ['default_severity',     'medium',             'general'],
  ['dark_mode',            'true',               'appearance'],
  ['compact_mode',         'false',              'appearance'],
  ['animations',           'true',               'appearance'],
  ['ai_auto_triage',       'true',               'ai'],
  ['ai_auto_fix',          'false',              'ai'],
  ['ai_confidence_threshold', '80',              'ai'],
  ['ai_model',             'NB v4.1 (Latest)',   'ai'],
  ['ai_pattern_recognition','true',              'ai'],
  ['notif_critical',       'true',               'notifications'],
  ['notif_ai_fix',         'true',               'notifications'],
  ['notif_daily_digest',   'false',              'notifications'],
  ['notif_sprint_report',  'true',               'notifications'],
  ['notif_slack',          'true',               'notifications'],
  ['2fa_enabled',          'false',              'security'],
  ['session_timeout',      '30',                 'security'],
  ['audit_log',            'true',               'security'],
];

const insertSetting = db.prepare(`INSERT OR IGNORE INTO settings (key, value, category) VALUES (?,?,?)`);
for (const [k, v, c] of defaults) insertSetting.run(k, v, c);
console.log(`✅ Seeded ${defaults.length} settings`);

// ── USER SETTINGS ─────────────────────────────────────────────────────────
const insertUserSettings = db.prepare(`INSERT OR IGNORE INTO user_settings (user_id, settings) VALUES (?,?)`);
for (const u of USERS) {
  insertUserSettings.run(u.id, JSON.stringify({
    theme: 'dark',
    notifications: { email: true, push: true, slack: false },
    dashboard: { defaultView: 'dashboard' }
  }));
}

db.close();
console.log('\n🧠 NeuralBug database seeded successfully!');
console.log('📧 Login with: admin@neuralbug.io / admin123');
