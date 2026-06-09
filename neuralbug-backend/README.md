# 🧠 NeuralBug — Backend API

Full REST API + WebSocket backend for the NeuralBug AI Bug Tracking platform.

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# → Edit .env with your values (JWT secret, SMTP, integration keys)

# 3. Create database + seed demo data
npm run seed

# 4. Start server
npm run dev        # development (nodemon)
npm start          # production
```

Server starts at **http://localhost:3001**

Login demo: `admin@neuralbug.io` / `admin123`

---

## Project Structure

```
neuralbug-backend/
├── server.js                  # Express app + HTTP server + WebSocket init
├── .env.example               # All environment variables documented
│
├── config/
│   └── database.js            # SQLite singleton (WAL mode, FK enforcement)
│
├── middleware/
│   ├── auth.js                # JWT authentication + role guards
│   ├── audit.js               # Automatic audit log on sensitive operations
│   └── validate.js            # express-validator chains
│
├── routes/
│   ├── auth.js                # Login, register, forgot/reset password, OAuth
│   ├── bugs.js                # Bug CRUD, filter, bulk ops, comments, activity
│   ├── ai.js                  # AI triage, auto-fix, scan, natural language query
│   ├── sprints.js             # Sprint board + Kanban data
│   ├── analytics.js           # Overview stats, trends, heatmap, activity feed
│   │                            (also exports teamRouter + notifRouter)
│   ├── integrations.js        # Configure + manage all 6 integrations
│   ├── settings.js            # Workspace settings + user prefs + API keys
│   └── webhooks.js            # Inbound webhooks: GitHub, Jira, Sentry, PagerDuty
│
├── services/
│   ├── aiService.js           # AI engine: triage, fix, scan, NL query
│   ├── integrationService.js  # GitHub, Jira, Slack, PagerDuty, Datadog, Sentry
│   └── wsService.js           # WebSocket server + broadcastEvent()
│
├── scripts/
│   ├── migrate.js             # Create all DB tables + triggers
│   └── seed.js                # Populate with realistic demo data
│
└── database/
    └── neuralbug.db           # SQLite file (auto-created on first run)
```

---

## API Reference

All endpoints require `Authorization: Bearer <JWT>` except auth routes.

### Auth  `/api/auth`

| Method | Path | Description |
|--------|------|-------------|
| POST | `/login` | Email + password login → `{ accessToken, refreshToken, user }` |
| POST | `/register` | Create account → `{ accessToken, refreshToken, user }` |
| POST | `/forgot-password` | Send reset link to email |
| POST | `/reset-password` | Apply new password via token |
| POST | `/refresh` | Swap refresh token → new access token |
| POST | `/logout` | Revoke refresh token |
| GET  | `/me` | Current user profile + settings |
| POST | `/google` | Google OAuth (`idToken` from Google Sign-In) |
| PUT  | `/change-password` | Change password (requires current password) |

### Bugs  `/api/bugs`

| Method | Path | Description |
|--------|------|-------------|
| GET  | `/` | List bugs. Query: `status`, `severity`, `project`, `assignee`, `search`, `page`, `limit`, `sort`, `order` |
| GET  | `/stats` | Counts by status/severity, resolution rate |
| POST | `/` | Create bug. Auto-assigns bug_id (BUG-NNN), triggers AI triage if enabled |
| GET  | `/:id` | Bug detail + comments + history |
| PUT  | `/:id` | Update any bug field |
| PATCH | `/:id/status` | Change status only |
| DELETE | `/:id` | Delete (Admin/Team Lead only) |
| POST | `/bulk` | Bulk action: `{ ids[], action: "status"|"assign"|"severity"|"delete", value }` |
| POST | `/:id/comments` | Add comment |
| GET  | `/:id/activity` | Bug activity history |

### AI Engine  `/api/ai`

| Method | Path | Description |
|--------|------|-------------|
| GET  | `/status` | AI model info, accuracy, queue depth, auto-fixed count |
| POST | `/triage/:bugId` | Run AI triage → severity + confidence + fix suggestion |
| POST | `/fix/:bugId` | Apply AI auto-fix (sets `ai-fixing`, resolves after delay) |
| POST | `/scan` | Full scan of all open bugs for patterns |
| POST | `/query` | Natural language query: `{ query: "show critical bugs in auth" }` |

### Integrations  `/api/integrations`

| Method | Path | Description |
|--------|------|-------------|
| GET  | `/` | All integrations with status |
| GET  | `/:name` | Single integration (config fields masked) |
| POST | `/:name/configure` | Configure integration (Admin/Team Lead) |
| DELETE | `/:name` | Disconnect integration |
| POST | `/slack/test` | Send test message to Slack |
| POST | `/jira/sync` | Push unsynced open bugs → Jira issues |
| GET  | `/sentry/issues` | Fetch unresolved Sentry issues |

**Integration names:** `github` · `jira` · `slack` · `pagerduty` · `datadog` · `sentry`

#### GitHub configure body
```json
{ "repoOwner": "my-org", "repoName": "my-app", "accessToken": "ghp_...", "webhookSecret": "abc", "syncPRs": true, "createIssues": true }
```

#### Jira configure body
```json
{ "baseUrl": "https://org.atlassian.net", "email": "you@co.com", "apiToken": "ATATT...", "projectKey": "BUG", "syncBidirectional": true }
```

#### Slack configure body
```json
{ "botToken": "xoxb-...", "signingSecret": "...", "channel": "#bugs", "notifyCritical": true, "notifyAIFix": true }
```

#### PagerDuty configure body
```json
{ "apiKey": "...", "serviceId": "P...", "fromEmail": "you@co.com", "escalateOn": ["critical"], "autoAck": false }
```

#### Datadog configure body
```json
{ "apiKey": "...", "appKey": "...", "site": "datadoghq.com", "traceBugs": true }
```

#### Sentry configure body
```json
{ "dsn": "https://...@sentry.io/...", "authToken": "...", "org": "org-slug", "project": "project-slug" }
```

### Inbound Webhooks  `/api/webhooks`

Register these URLs in your external services:

| Path | Service | Events Handled |
|------|---------|----------------|
| `POST /api/webhooks/github` | GitHub App/Repo | `issues.opened/closed`, `push` (auto-closes via commit message) |
| `POST /api/webhooks/jira` | Jira Automation | `jira:issue_created`, `jira:issue_updated` |
| `POST /api/webhooks/sentry` | Sentry Alert Rules | `created`, `resolved` |
| `POST /api/webhooks/pagerduty` | PagerDuty Webhooks | `incident.trigger`, `incident.resolve` |

All webhooks verify HMAC signatures when a secret is configured.

### Settings  `/api/settings`

| Method | Path | Description |
|--------|------|-------------|
| GET  | `/` | All workspace settings grouped by category |
| PUT  | `/:category` | Save settings for a category (`general`, `ai`, `notifications`, `security`, `appearance`) |
| GET  | `/user/me` | Current user preferences |
| PUT  | `/user/me` | Update user preferences (merged) |
| GET  | `/api-keys` | List API keys (hashed, prefix only) |
| POST | `/api-keys` | Generate new API key — shown once |
| DELETE | `/api-keys/:id` | Revoke API key |

### Analytics  `/api/analytics`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/overview` | Totals, rates, sprint progress |
| GET | `/trends?days=30` | Daily created vs resolved counts |
| GET | `/heatmap` | Bug counts per day (28 days) |
| GET | `/by-severity` | Open bugs grouped by severity |
| GET | `/by-project` | Bug counts per project |
| GET | `/activity?limit=20` | Recent activity feed |

### Sprints  `/api/sprints`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | All sprints with bug counts |
| GET | `/active` | Active sprint + full Kanban data |
| GET | `/:id` | Sprint detail |
| POST | `/` | Create sprint (Admin/Team Lead) |
| PATCH | `/:id/status` | `planned` → `active` → `completed` |
| PATCH | `/:id/move-bug` | Move bug between sprints |

### Team  `/api/team`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | All users with bug counts |
| GET | `/:id` | User detail + recent bugs |
| PUT | `/:id` | Update profile (own or Admin) |
| POST | `/invite` | Send invitation email |

### Notifications  `/api/notifications`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | List. Query: `type`, `unread=true`, `limit` |
| PATCH | `/:id/read` | Mark one as read |
| PATCH | `/read-all` | Mark all as read |
| DELETE | `/:id` | Delete notification |

---

## WebSocket

Connect: `ws://localhost:3001/ws?token=<accessToken>`

**Events emitted by server:**

| Event | Payload | When |
|-------|---------|------|
| `connected` | `{ clientId, userId }` | On connect |
| `bug:created` | `{ bugId, severity }` | New bug created |
| `bug:updated` | `{ bugId, changes }` | Bug fields changed |
| `bug:status`  | `{ bugId, oldStatus, newStatus }` | Status changed |
| `bug:resolved`| `{ bugId, source }` | Bug resolved |
| `bugs:bulk`   | `{ action, count }` | Bulk operation done |
| `ai:triage`   | `{ bugId, severity, confidence }` | AI triage complete |
| `ai:fixing`   | `{ bugId, bugNumber }` | AI fix started |
| `ai:fixed`    | `{ bugId, bugNumber }` | AI fix applied |
| `ai:scan_complete` | `{ found, total }` | Scan finished |
| `activity`    | `{ bugId, action, description }` | Activity log event |

**Client → Server:**
```json
{ "type": "ping" }  →  { "type": "pong" }
```

---

## Database Schema

10 tables:

| Table | Purpose |
|-------|---------|
| `users` | Accounts, roles, OAuth IDs |
| `refresh_tokens` | JWT refresh token store |
| `bugs` | Core bug records with AI fields + external refs |
| `bug_comments` | Comments per bug |
| `activity_log` | All actions on bugs |
| `notifications` | Per-user notification inbox |
| `sprints` | Sprint records |
| `settings` | Workspace-level key-value config |
| `user_settings` | Per-user JSON preferences |
| `integrations` | Integration configs + status |
| `api_keys` | Hashed API keys |
| `audit_log` | Security audit trail |

---

## Environment Variables

See `.env.example` for the full list. Critical ones:

```env
JWT_SECRET=<min 32 chars, random>
JWT_REFRESH_SECRET=<different from above>
FRONTEND_URL=http://localhost:3000
DB_PATH=./database/neuralbug.db

# Set any integration keys you want to use:
GITHUB_APP_ID=...
JIRA_BASE_URL=https://org.atlassian.net
SLACK_BOT_TOKEN=xoxb-...
PAGERDUTY_API_KEY=...
DATADOG_API_KEY=...
SENTRY_AUTH_TOKEN=...
```

---

## Roles & Permissions

| Role | Permissions |
|------|------------|
| Developer | Create/edit bugs, add comments, view all |
| QA Engineer | All developer + run AI actions |
| Team Lead | All QA + configure integrations, manage sprints |
| DevOps | All + manage settings |
| Admin | Full access including delete, bulk delete, user management |

---

## Connecting the Frontend

In `neuralbug.html`, replace the mock `doLogin()` function:

```javascript
async function doLogin() {
  const res = await fetch('http://localhost:3001/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: document.getElementById('loginEmail').value,
      password: document.getElementById('loginPwd').value,
    }),
  });
  const data = await res.json();
  if (data.success) {
    localStorage.setItem('nb_token', data.accessToken);
    localStorage.setItem('nb_user', JSON.stringify(data.user));
    showApp(data.user);
  } else {
    document.getElementById('loginError').classList.add('show');
  }
}

// Use token in all API calls:
const API = async (path, opts = {}) => {
  const token = localStorage.getItem('nb_token');
  const res = await fetch(`http://localhost:3001/api${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...opts.headers },
  });
  return res.json();
};

// WebSocket for live updates:
const ws = new WebSocket(`ws://localhost:3001/ws?token=${localStorage.getItem('nb_token')}`);
ws.onmessage = (e) => {
  const { type, payload } = JSON.parse(e.data);
  if (type === 'bug:created') toast('🐛','New Bug', `${payload.severity} bug reported`);
  if (type === 'ai:fixed')   toast('🤖','AI Fixed', `${payload.bugNumber} auto-resolved`);
};
```

---

## Production Checklist

- [ ] Set strong `JWT_SECRET` (32+ random chars)
- [ ] Set `NODE_ENV=production`
- [ ] Enable HTTPS (use nginx reverse proxy + Let's Encrypt)
- [ ] Set `FRONTEND_URL` to your actual domain
- [ ] Configure SMTP for password reset emails
- [ ] Use encrypted secrets store for integration API keys (not plain `.env`)
- [ ] Set up process manager: `pm2 start server.js --name neuralbug`
- [ ] Enable log rotation: `morgan` → write to file, rotate daily
- [ ] Schedule daily DB backup: `cp database/neuralbug.db backups/$(date +%F).db`
- [ ] Register webhook URLs in GitHub / Jira / Sentry / PagerDuty dashboards

---

## Tech Stack

| Layer | Choice |
|-------|--------|
| Runtime | Node.js 18+ |
| Framework | Express 4 |
| Database | SQLite via better-sqlite3 (WAL mode) |
| Auth | JWT (access + refresh tokens) + bcryptjs |
| Real-time | ws (WebSocket) |
| Security | helmet, cors, express-rate-limit |
| Integrations | GitHub API, Jira REST v3, Slack Web API, PagerDuty API, Datadog API, Sentry API |
| Webhooks | HMAC-SHA256 signature verification |
