// server.js — NeuralBug Backend API Server
'use strict';

require('dotenv').config();
const express     = require('express');
const http        = require('http');
const cors        = require('cors');
const helmet      = require('helmet');
const morgan      = require('morgan');
const compression = require('compression');
const rateLimit   = require('express-rate-limit');
const { initWS, getStats } = require('./services/wsService');

const app    = express();
const server = http.createServer(app);

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' }, contentSecurityPolicy: false }));
app.use(cors({
  origin: (origin, cb) => {
    const allowed = (process.env.FRONTEND_URL || 'http://localhost:3000').split(',').map(s => s.trim());
    if (!origin || allowed.includes(origin) || process.env.NODE_ENV === 'development') return cb(null, true);
    cb(new Error(`CORS: ${origin} not allowed`));
  },
  credentials: true,
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization','X-Request-ID'],
}));
app.use(compression());
if (process.env.NODE_ENV !== 'test') app.use(morgan('dev'));
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));
app.use((req, _, next) => { req.id = require('crypto').randomUUID(); next(); });

const globalLimiter = rateLimit({ windowMs: 15*60*1000, max: 200, standardHeaders: true, legacyHeaders: false });
const authLimiter   = rateLimit({ windowMs: 15*60*1000, max: 10  });
app.use('/api/', globalLimiter);

const { analyticsRouter, teamRouter, notifRouter } = require('./routes/analytics');
app.use('/api/auth',          authLimiter, require('./routes/auth'));
app.use('/api/bugs',                       require('./routes/bugs'));
app.use('/api/ai',                         require('./routes/ai'));
app.use('/api/sprints',                    require('./routes/sprints'));
app.use('/api/integrations',               require('./routes/integrations'));
app.use('/api/settings',                   require('./routes/settings'));
app.use('/api/analytics',    analyticsRouter);
app.use('/api/team',         teamRouter);
app.use('/api/notifications', notifRouter);
app.use('/api/webhooks',                   require('./routes/webhooks'));

app.get('/health', (req, res) => {
  let dbOk = false;
  try { require('./config/database').getDb().prepare('SELECT 1').get(); dbOk = true; } catch {}
  res.json({ status:'ok', service:'NeuralBug API', version:'1.0.0', db: dbOk?'connected':'error', wsClients: getStats().connected, ts: new Date().toISOString() });
});

app.get('/api', (_, res) => res.json({
  service:'NeuralBug REST API', version:'1.0.0',
  auth:'Bearer JWT in Authorization header',
  endpoints: {
    auth:          'POST /api/auth/login|register|forgot-password|reset-password|refresh|logout  GET /api/auth/me',
    bugs:          'GET|POST /api/bugs  GET|PUT|DELETE /api/bugs/:id  PATCH /api/bugs/:id/status  POST /api/bugs/bulk  POST /api/bugs/:id/comments',
    ai:            'GET /api/ai/status  POST /api/ai/triage/:id|fix/:id|scan|query',
    sprints:       'GET /api/sprints|/sprints/active  POST /api/sprints  PATCH /api/sprints/:id/status|move-bug',
    analytics:     'GET /api/analytics/overview|trends|heatmap|by-severity|by-project|activity',
    team:          'GET /api/team|/:id  PUT /api/team/:id  POST /api/team/invite',
    notifications: 'GET /api/notifications  PATCH /api/notifications/:id/read|/read-all',
    settings:      'GET|PUT /api/settings/:category  GET|PUT /api/settings/user/me  GET|POST|DELETE /api/settings/api-keys',
    integrations:  'GET /api/integrations|/:name  POST /api/integrations/:name/configure  DELETE /api/integrations/:name  POST /api/integrations/slack/test|/jira/sync  GET /api/integrations/sentry/issues',
    webhooks:      'POST /api/webhooks/github|jira|sentry|pagerduty',
    websocket:     'ws://host/ws?token=<JWT>',
  },
}));

app.use((req, res) => res.status(404).json({ success:false, error:`Not found: ${req.method} ${req.path}` }));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  console.error('[Error]', req.method, req.path, err.message);
  res.status(err.status||500).json({ success:false, error: process.env.NODE_ENV==='production'&&!err.status ? 'Internal error.' : err.message, requestId:req.id });
});

initWS(server);
const PORT = parseInt(process.env.PORT) || 3001;
server.listen(PORT, () => {
  console.log(`\n🧠  NeuralBug API    → http://localhost:${PORT}`);
  console.log(`📖  API Index       → http://localhost:${PORT}/api`);
  console.log(`❤️   Health          → http://localhost:${PORT}/health`);
  console.log(`🔌  WebSocket       → ws://localhost:${PORT}/ws\n`);
});
module.exports = { app, server };
