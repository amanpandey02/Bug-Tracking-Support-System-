// services/integrationService.js — External integrations
'use strict';

const axios = require('axios');
const { getDb } = require('../config/database');
const { broadcastEvent } = require('./wsService');

// ── Helpers ──────────────────────────────────────────────────────────────────
function getConfig(name) {
  const db = getDb();
  const row = db.prepare('SELECT config FROM integrations WHERE name = ?').get(name);
  if (!row) return {};
  try { return JSON.parse(row.config); } catch { return {}; }
}

function updateStatus(name, status, errorMsg) {
  const db = getDb();
  db.prepare(`
    UPDATE integrations SET status = ?, error_message = ?, last_sync = ?
    WHERE name = ?
  `).run(status, errorMsg || null, new Date().toISOString(), name);
}

// ── GITHUB ───────────────────────────────────────────────────────────────────
const github = {
  async configure({ repoOwner, repoName, accessToken, webhookSecret, syncPRs, createIssues }) {
    const db = getDb();
    // Verify token by hitting GitHub API
    try {
      const { data } = await axios.get(`https://api.github.com/repos/${repoOwner}/${repoName}`, {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/vnd.github+json' },
        timeout: 5000,
      });
      const config = JSON.stringify({ repoOwner, repoName, accessToken, webhookSecret, syncPRs, createIssues, repoId: data.id });
      db.prepare("UPDATE integrations SET config = ?, is_enabled = 1, status = 'connected' WHERE name = 'github'").run(config);
      updateStatus('github', 'connected');
      return { connected: true, repo: data.full_name, private: data.private };
    } catch (err) {
      updateStatus('github', 'error', err.response?.data?.message || err.message);
      throw new Error(`GitHub connection failed: ${err.response?.data?.message || err.message}`);
    }
  },

  async createIssue(bug) {
    const cfg = getConfig('github');
    if (!cfg.accessToken) throw new Error('GitHub not configured.');
    const { data } = await axios.post(
      `https://api.github.com/repos/${cfg.repoOwner}/${cfg.repoName}/issues`,
      {
        title: `[${bug.bug_id}] ${bug.title}`,
        body: `## Bug Report\n\n**Severity:** ${bug.severity}\n**Component:** ${bug.component}\n\n${bug.description || ''}\n\n---\n*Created by NeuralBug AI Tracker*`,
        labels: [`neuralbug`, `severity:${bug.severity}`],
      },
      { headers: { Authorization: `Bearer ${cfg.accessToken}`, Accept: 'application/vnd.github+json' } }
    );
    return { issueNumber: data.number, url: data.html_url };
  },

  async handleWebhook(event, payload) {
    const db = getDb();
    if (event === 'issues') {
      const { action, issue } = payload;
      if (action === 'closed') {
        // Find matching bug by GitHub issue number in external_refs
        const bugs = db.prepare("SELECT * FROM bugs WHERE external_refs LIKE ?").all(`%"github":${issue.number}%`);
        for (const bug of bugs) {
          db.prepare("UPDATE bugs SET status = 'resolved', resolved_at = ? WHERE id = ?")
            .run(new Date().toISOString(), bug.id);
          broadcastEvent('bug:resolved', { bugId: bug.id, source: 'github' });
        }
      }
    }
    return { processed: true };
  },
};

// ── JIRA ─────────────────────────────────────────────────────────────────────
const jira = {
  async configure({ baseUrl, email, apiToken, projectKey, syncBidirectional }) {
    const db = getDb();
    try {
      const { data } = await axios.get(`${baseUrl}/rest/api/3/myself`, {
        auth: { username: email, password: apiToken },
        timeout: 5000,
      });
      const config = JSON.stringify({ baseUrl, email, apiToken, projectKey, syncBidirectional });
      db.prepare("UPDATE integrations SET config = ?, is_enabled = 1, status = 'connected' WHERE name = 'jira'").run(config);
      updateStatus('jira', 'connected');
      return { connected: true, jiraUser: data.displayName, accountId: data.accountId };
    } catch (err) {
      updateStatus('jira', 'error', err.response?.data?.message || err.message);
      throw new Error(`Jira connection failed: ${err.message}`);
    }
  },

  async createIssue(bug) {
    const cfg = getConfig('jira');
    if (!cfg.apiToken) throw new Error('Jira not configured.');
    const priorityMap = { critical:'Highest', high:'High', medium:'Medium', low:'Low' };
    const { data } = await axios.post(
      `${cfg.baseUrl}/rest/api/3/issue`,
      {
        fields: {
          project: { key: cfg.projectKey },
          summary: `[NeuralBug ${bug.bug_id}] ${bug.title}`,
          description: {
            type:'doc', version:1,
            content: [{ type:'paragraph', content:[{ type:'text', text: bug.description || bug.title }] }],
          },
          issuetype: { name:'Bug' },
          priority: { name: priorityMap[bug.severity] || 'Medium' },
          labels: ['neuralbug', bug.component?.toLowerCase().replace(/\s+/g,'-')].filter(Boolean),
        },
      },
      { auth: { username: cfg.email, password: cfg.apiToken } }
    );
    return { jiraKey: data.key, url: `${cfg.baseUrl}/browse/${data.key}` };
  },

  async syncStatus(jiraKey, status) {
    const cfg = getConfig('jira');
    if (!cfg.apiToken) return;
    // Get transitions and apply 'Done' for resolved
    const { data: trans } = await axios.get(
      `${cfg.baseUrl}/rest/api/3/issue/${jiraKey}/transitions`,
      { auth: { username: cfg.email, password: cfg.apiToken } }
    );
    const done = trans.transitions.find(t => t.name === 'Done');
    if (done) {
      await axios.post(`${cfg.baseUrl}/rest/api/3/issue/${jiraKey}/transitions`,
        { transition: { id: done.id } },
        { auth: { username: cfg.email, password: cfg.apiToken } }
      );
    }
  },
};

// ── SLACK ─────────────────────────────────────────────────────────────────────
const slack = {
  async configure({ botToken, signingSecret, channel, notifyCritical, notifyAIFix, dailyDigest }) {
    const db = getDb();
    try {
      const { data } = await axios.post('https://slack.com/api/auth.test', null, {
        headers: { Authorization: `Bearer ${botToken}` },
        timeout: 5000,
      });
      if (!data.ok) throw new Error(data.error);
      const config = JSON.stringify({ botToken, signingSecret, channel, notifyCritical, notifyAIFix, dailyDigest });
      db.prepare("UPDATE integrations SET config = ?, is_enabled = 1, status = 'connected' WHERE name = 'slack'").run(config);
      updateStatus('slack', 'connected');
      return { connected: true, team: data.team, botUser: data.user };
    } catch (err) {
      updateStatus('slack', 'error', err.message);
      throw new Error(`Slack connection failed: ${err.message}`);
    }
  },

  async send(channel, text, blocks) {
    const cfg = getConfig('slack');
    if (!cfg.botToken) throw new Error('Slack not configured.');
    await axios.post('https://slack.com/api/chat.postMessage',
      { channel: channel || cfg.channel, text, blocks },
      { headers: { Authorization: `Bearer ${cfg.botToken}` } }
    );
  },

  async notifyBug(bug) {
    const cfg = getConfig('slack');
    if (!cfg.botToken) return;
    const sevEmoji = { critical:'🔴', high:'🟠', medium:'🔵', low:'🟢' }[bug.severity] || '⚪';
    await slack.send(cfg.channel, `${sevEmoji} *[${bug.bug_id}]* ${bug.title}`, [
      { type:'section', text:{ type:'mrkdwn', text:`${sevEmoji} *[${bug.bug_id}]* ${bug.title}\n*Severity:* ${bug.severity} | *Component:* ${bug.component}` } },
      { type:'actions', elements:[
        { type:'button', text:{ type:'plain_text', text:'View Bug' }, url:`${process.env.FRONTEND_URL}/bugs/${bug.id}` }
      ]}
    ]);
  },

  async test() {
    return slack.send(null, '🧠 NeuralBug Slack integration is working! Critical bugs will be posted here.');
  },
};

// ── PAGERDUTY ────────────────────────────────────────────────────────────────
const pagerduty = {
  async configure({ apiKey, serviceId, fromEmail, escalateOn, autoAck }) {
    const db = getDb();
    try {
      await axios.get('https://api.pagerduty.com/users/me', {
        headers: { Authorization: `Token token=${apiKey}`, Accept:'application/vnd.pagerduty+json;version=2', From: fromEmail },
        timeout: 5000,
      });
      const config = JSON.stringify({ apiKey, serviceId, fromEmail, escalateOn: escalateOn || ['critical'], autoAck });
      db.prepare("UPDATE integrations SET config = ?, is_enabled = 1, status = 'connected' WHERE name = 'pagerduty'").run(config);
      updateStatus('pagerduty', 'connected');
      return { connected: true };
    } catch (err) {
      updateStatus('pagerduty', 'error', err.message);
      throw new Error(`PagerDuty connection failed: ${err.message}`);
    }
  },

  async createIncident(bug) {
    const cfg = getConfig('pagerduty');
    if (!cfg.apiKey) throw new Error('PagerDuty not configured.');
    const { data } = await axios.post('https://api.pagerduty.com/incidents',
      {
        incident: {
          type:'incident',
          title: `[NeuralBug ${bug.bug_id}] ${bug.title}`,
          service: { id: cfg.serviceId, type:'service_reference' },
          urgency: bug.severity === 'critical' ? 'high' : 'low',
          body: { type:'incident_body', details: bug.description || bug.title },
        }
      },
      {
        headers: {
          Authorization: `Token token=${cfg.apiKey}`,
          Accept:'application/vnd.pagerduty+json;version=2',
          From: cfg.fromEmail,
        }
      }
    );
    return { incidentId: data.incident.id, url: data.incident.html_url };
  },
};

// ── DATADOG ───────────────────────────────────────────────────────────────────
const datadog = {
  async configure({ apiKey, appKey, site, traceBugs }) {
    const db = getDb();
    try {
      const ddSite = site || 'datadoghq.com';
      await axios.get(`https://api.${ddSite}/api/v1/validate`, {
        headers: { 'DD-API-KEY': apiKey },
        timeout: 5000,
      });
      const config = JSON.stringify({ apiKey, appKey, site: ddSite, traceBugs });
      db.prepare("UPDATE integrations SET config = ?, is_enabled = 1, status = 'connected' WHERE name = 'datadog'").run(config);
      updateStatus('datadog', 'connected');
      return { connected: true, site: ddSite };
    } catch (err) {
      updateStatus('datadog', 'error', err.response?.data?.errors?.join(', ') || err.message);
      throw new Error(`Datadog connection failed: ${err.message}`);
    }
  },

  async sendEvent(bug, eventType = 'error') {
    const cfg = getConfig('datadog');
    if (!cfg.apiKey) throw new Error('Datadog not configured.');
    await axios.post(`https://api.${cfg.site}/api/v1/events`,
      {
        title: `[NeuralBug] ${bug.bug_id}: ${bug.title}`,
        text: `Severity: ${bug.severity}\nComponent: ${bug.component}\n${bug.description || ''}`,
        alert_type: bug.severity === 'critical' ? 'error' : bug.severity === 'high' ? 'warning' : 'info',
        tags: [`neuralbug:true`, `severity:${bug.severity}`, `component:${bug.component?.toLowerCase()}`],
        source_type_name: 'NeuralBug',
      },
      { headers: { 'DD-API-KEY': cfg.apiKey, 'DD-APPLICATION-KEY': cfg.appKey } }
    );
  },
};

// ── SENTRY ────────────────────────────────────────────────────────────────────
const sentry = {
  async configure({ dsn, authToken, org, project }) {
    const db = getDb();
    try {
      const { data } = await axios.get(
        `https://sentry.io/api/0/projects/${org}/${project}/`,
        { headers: { Authorization: `Bearer ${authToken}` }, timeout: 5000 }
      );
      const config = JSON.stringify({ dsn, authToken, org, project, projectId: data.id });
      db.prepare("UPDATE integrations SET config = ?, is_enabled = 1, status = 'connected' WHERE name = 'sentry'").run(config);
      updateStatus('sentry', 'connected');
      return { connected: true, projectSlug: data.slug, projectName: data.name };
    } catch (err) {
      updateStatus('sentry', 'error', err.response?.data?.detail || err.message);
      throw new Error(`Sentry connection failed: ${err.message}`);
    }
  },

  async getIssues(limit = 10) {
    const cfg = getConfig('sentry');
    if (!cfg.authToken) throw new Error('Sentry not configured.');
    const { data } = await axios.get(
      `https://sentry.io/api/0/projects/${cfg.org}/${cfg.project}/issues/?limit=${limit}&query=is:unresolved`,
      { headers: { Authorization: `Bearer ${cfg.authToken}` } }
    );
    return data.map(issue => ({
      id: issue.id,
      title: issue.title,
      level: issue.level,
      count: issue.count,
      lastSeen: issue.lastSeen,
      permalink: issue.permalink,
    }));
  },

  async resolveIssue(sentryIssueId) {
    const cfg = getConfig('sentry');
    await axios.put(
      `https://sentry.io/api/0/issues/${sentryIssueId}/`,
      { status: 'resolved' },
      { headers: { Authorization: `Bearer ${cfg.authToken}` } }
    );
  },
};

// ── Master configure dispatcher ───────────────────────────────────────────────
async function configureIntegration(name, config) {
  const dispatchers = { github, jira, slack, pagerduty, datadog, sentry };
  const svc = dispatchers[name.toLowerCase()];
  if (!svc) throw new Error(`Unknown integration: ${name}`);
  return svc.configure(config);
}

async function disconnectIntegration(name) {
  const db = getDb();
  db.prepare("UPDATE integrations SET is_enabled = 0, status = 'disconnected', config = '{}' WHERE name = ?").run(name);
  return { disconnected: true };
}

function getAllIntegrations() {
  const db = getDb();
  return db.prepare('SELECT id, name, is_enabled, status, last_sync, error_message, updated_at FROM integrations ORDER BY name').all();
}

module.exports = { github, jira, slack, pagerduty, datadog, sentry, configureIntegration, disconnectIntegration, getAllIntegrations };
