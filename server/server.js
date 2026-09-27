'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { open, DB_PATH, NOW_MS } = require('./db');

const PORT = Number(process.env.PORT) || 3001;
// Localhost by default: in production the only way in is through Caddy.
const HOST = process.env.HOST || '127.0.0.1';
// Served under a path on a host it shares with another app, so everything,
// the API included, lives beneath this prefix.
const BASE_PATH = process.env.BASE_PATH ?? '/jobgrindr';
const CLIENT_DIR = process.env.CLIENT_DIR || path.join(__dirname, '..', 'dist');

// The OAuth client of type "Web application" whose ID tokens are accepted.
// Unset means local development: no sign-in, one built-in local user.
const GOOGLE_CLIENT_ID = (process.env.GOOGLE_CLIENT_ID || '').trim();
if (process.env.NODE_ENV === 'production' && !GOOGLE_CLIENT_ID) {
  // Open mode on a public host would hand everyone the same account.
  throw new Error('GOOGLE_CLIENT_ID must be set in production');
}
// Optional comma-separated allowlist. Unset lets any Google account sign in,
// each seeing only its own data.
const ALLOWED_EMAILS = new Set(
  (process.env.ALLOWED_EMAILS || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
);

// Origins whose pages may call the API with the user's cookie. The client is
// hosted on GitHub Pages at t98.dev, a different origin from this server.
const CORS_ORIGINS = new Set(
  (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
);
// Where the client is hosted, when not by this server. Page requests here
// are redirected to it.
const APP_URL = (process.env.APP_URL || '').trim();

const SESSION_COOKIE = 'jobgrindr_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const db = open();

const MAX_SHORT = 200;
const MAX_URL = 2000;
const MAX_NOTES = 10_000;
const WORK_MODES = new Set(['', 'remote', 'hybrid', 'onsite']);
const KINDS = new Set(['stage', 'outcome']);

// What a new account starts with. Users can rename, recolor, reorder and
// delete these like any status they add themselves.
const DEFAULT_STATUSES = [
  ['Applied', '#6da7ec', 'stage'],
  ['Screening', '#3987e5', 'stage'],
  ['Interviewing', '#256abf', 'stage'],
  ['Offer', '#184f95', 'stage'],
  ['Accepted', '#0ca30c', 'outcome'],
  ['Declined', '#ec835a', 'outcome'],
  ['Rejected', '#d03b3b', 'outcome'],
  ['No response', '#898781', 'outcome'],
  ['Withdrawn', '#eda100', 'outcome'],
];

// --- validation -------------------------------------------------------------

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function text(value, max) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new HttpError(400, 'expected a string');
  const trimmed = value.trim();
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

function requiredText(value, max, field) {
  const result = text(value, max);
  if (!result) throw new HttpError(400, `${field} is required`);
  return result;
}

function isoDate(value, field) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new HttpError(400, `${field} must be a yyyy-mm-dd date`);
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new HttpError(400, `${field} is not a real date`);
  }
  return value;
}

/**
 * The client's own calendar date, which is what a status change is stamped
 * with. The server's clock is UTC, so its idea of "today" is wrong for much of
 * the day in most timezones; it is only the fallback.
 */
function clientToday(body) {
  return body.today ? isoDate(body.today, 'today') : new Date().toISOString().slice(0, 10);
}

function color(value) {
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) {
    throw new HttpError(400, 'color must be a #rrggbb hex value');
  }
  return value.toLowerCase();
}

function kind(value) {
  if (!KINDS.has(value)) throw new HttpError(400, "kind must be 'stage' or 'outcome'");
  return value;
}

function id(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(404, 'not found');
  return n;
}

function transaction(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// --- users and sessions -----------------------------------------------------

const authStmts = {
  getUser: db.prepare('SELECT id, email, name FROM users WHERE id = ?'),
  insertUser: db.prepare('INSERT INTO users (id, email, name) VALUES (?, ?, ?)'),
  updateUser: db.prepare('UPDATE users SET email = ?, name = ? WHERE id = ?'),
  insertStatus: db.prepare(
    'INSERT INTO statuses (user_id, name, color, kind, position) VALUES (?, ?, ?, ?, ?)'
  ),
  insertSession: db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)'),
  sessionUser: db.prepare(`
    SELECT u.id, u.email, u.name
      FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ${NOW_MS}
  `),
  deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
  deleteExpired: db.prepare(`DELETE FROM sessions WHERE expires_at <= ${NOW_MS}`),
};

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

/** Find or create the account, giving a new one the default statuses. */
function ensureUser(userId, email, name) {
  return transaction(() => {
    if (authStmts.getUser.get(userId)) {
      authStmts.updateUser.run(email, name, userId);
    } else {
      authStmts.insertUser.run(userId, email, name);
      DEFAULT_STATUSES.forEach(([statusName, hex, statusKind], position) =>
        authStmts.insertStatus.run(userId, statusName, hex, statusKind, position)
      );
    }
    return { id: userId, email, name };
  });
}

function createSession(userId) {
  authStmts.deleteExpired.run();
  // 32 random bytes: the cookie is the whole credential once signed in.
  const token = crypto.randomBytes(32).toString('base64url');
  authStmts.insertSession.run(hashToken(token), userId, Date.now() + SESSION_TTL_MS);
  return token;
}

function readCookie(req, name) {
  for (const part of (req.get('cookie') || '').split(';')) {
    const eq = part.indexOf('=');
    if (eq !== -1 && part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

function cookieOptions(req) {
  return {
    httpOnly: true,
    // Behind Caddy and Cloudflare, req.secure comes from X-Forwarded-Proto.
    // Plain http only happens in local development.
    secure: req.secure,
    sameSite: 'lax',
    path: BASE_PATH || '/',
  };
}

/**
 * Check a Google ID token and return its claims, or null if it was not
 * issued to this application.
 *
 * The aud check is the point of this function: without it, a token minted
 * for any other Google application would sign its holder in here.
 */
async function verifyGoogleIdToken(credential) {
  const res = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`
  );
  if (!res.ok) return null;

  const claims = await res.json();
  const issuerOk = claims.iss === 'accounts.google.com' || claims.iss === 'https://accounts.google.com';
  const verified = claims.email_verified === true || claims.email_verified === 'true';
  if (claims.aud !== GOOGLE_CLIENT_ID || !issuerOk || !verified || !claims.sub || !claims.email) {
    return null;
  }
  return claims;
}

// --- statuses ---------------------------------------------------------------

const statusStmts = {
  list: db.prepare(`
    SELECT s.id, s.name, s.color, s.kind, s.position,
           (SELECT COUNT(DISTINCT c.application_id) FROM status_changes c WHERE c.status_id = s.id) AS in_use
      FROM statuses s
     WHERE s.user_id = ?
     ORDER BY s.position, s.id
  `),
  get: db.prepare('SELECT id, name, color, kind, position FROM statuses WHERE id = ? AND user_id = ?'),
  insert: db.prepare(`
    INSERT INTO statuses (user_id, name, color, kind, position)
    VALUES (:user_id, :name, :color, :kind,
            (SELECT COALESCE(MAX(position), -1) + 1 FROM statuses WHERE user_id = :user_id))
  `),
  update: db.prepare('UPDATE statuses SET name = ?, color = ?, kind = ? WHERE id = ? AND user_id = ?'),
  setPosition: db.prepare('UPDATE statuses SET position = ? WHERE id = ? AND user_id = ?'),
  remove: db.prepare('DELETE FROM statuses WHERE id = ? AND user_id = ?'),
  stageCount: db.prepare("SELECT COUNT(*) AS n FROM statuses WHERE kind = 'stage' AND user_id = ?"),
  inUse: db.prepare('SELECT COUNT(DISTINCT application_id) AS n FROM status_changes WHERE status_id = ?'),
  firstStage: db.prepare(
    "SELECT id FROM statuses WHERE kind = 'stage' AND user_id = ? ORDER BY position, id LIMIT 1"
  ),
  allIds: db.prepare('SELECT id FROM statuses WHERE user_id = ?'),
};

const toStatus = (row) => ({
  id: row.id,
  name: row.name,
  color: row.color,
  kind: row.kind,
  position: row.position,
  inUse: row.in_use,
});

function listStatuses(userId) {
  return statusStmts.list.all(userId).map(toStatus);
}

/** A status of this user's. Anyone else's is indistinguishable from none. */
function findStatus(statusId, userId) {
  const row = statusStmts.get.get(statusId, userId);
  if (!row) throw new HttpError(404, 'status not found');
  return row;
}

function uniqueName(fn) {
  try {
    return fn();
  } catch (err) {
    if (/UNIQUE constraint failed: statuses\./.test(err.message)) {
      throw new HttpError(409, 'a status with that name already exists');
    }
    throw err;
  }
}

function createStatus(userId, body) {
  const fields = {
    user_id: userId,
    name: requiredText(body.name, 60, 'name'),
    color: color(body.color),
    kind: kind(body.kind),
  };
  uniqueName(() => statusStmts.insert.run(fields));
}

function updateStatus(userId, statusId, body) {
  const current = findStatus(statusId, userId);
  const next = {
    name: body.name === undefined ? current.name : requiredText(body.name, 60, 'name'),
    color: body.color === undefined ? current.color : color(body.color),
    kind: body.kind === undefined ? current.kind : kind(body.kind),
  };
  // Every application starts in the first stage, so there must always be one.
  if (current.kind === 'stage' && next.kind === 'outcome' && statusStmts.stageCount.get(userId).n === 1) {
    throw new HttpError(409, 'at least one stage is required');
  }
  uniqueName(() => statusStmts.update.run(next.name, next.color, next.kind, statusId, userId));
}

function reorderStatuses(userId, ids) {
  const existing = new Set(statusStmts.allIds.all(userId).map((r) => r.id));
  const valid =
    Array.isArray(ids) &&
    ids.length === existing.size &&
    new Set(ids).size === ids.length &&
    ids.every((value) => existing.has(value));
  if (!valid) throw new HttpError(400, 'ids must list every status exactly once');

  transaction(() =>
    ids.forEach((statusId, position) => statusStmts.setPosition.run(position, statusId, userId))
  );
}

function deleteStatus(userId, statusId) {
  const current = findStatus(statusId, userId);
  const used = statusStmts.inUse.get(statusId).n;
  if (used > 0) {
    throw new HttpError(409, `${current.name} is used by ${used} application${used === 1 ? '' : 's'}`);
  }
  if (current.kind === 'stage' && statusStmts.stageCount.get(userId).n === 1) {
    throw new HttpError(409, 'at least one stage is required');
  }
  statusStmts.remove.run(statusId, userId);
}

// --- applications -----------------------------------------------------------

const appStmts = {
  list: db.prepare(
    'SELECT * FROM applications WHERE user_id = ? ORDER BY date_applied DESC, id DESC'
  ),
  get: db.prepare('SELECT * FROM applications WHERE id = ? AND user_id = ?'),
  history: db.prepare(`
    SELECT c.application_id, c.status_id, c.changed_on
      FROM status_changes c JOIN applications a ON a.id = c.application_id
     WHERE a.user_id = ?
     ORDER BY c.application_id, c.id
  `),
  historyFor: db.prepare(
    'SELECT id, status_id, changed_on FROM status_changes WHERE application_id = ? ORDER BY id'
  ),
  insert: db.prepare(`
    INSERT INTO applications (user_id, company, role, url, location, work_mode, salary, source, contact, notes, date_applied)
    VALUES (:user_id, :company, :role, :url, :location, :work_mode, :salary, :source, :contact, :notes, :date_applied)
    RETURNING id
  `),
  update: db.prepare(`
    UPDATE applications
       SET company = :company, role = :role, url = :url, location = :location,
           work_mode = :work_mode, salary = :salary, source = :source, contact = :contact,
           notes = :notes, date_applied = :date_applied, updated_at = ${NOW_MS}
     WHERE id = :id AND user_id = :user_id
  `),
  touch: db.prepare(`UPDATE applications SET updated_at = ${NOW_MS} WHERE id = ?`),
  remove: db.prepare('DELETE FROM applications WHERE id = ? AND user_id = ?'),
  addChange: db.prepare(
    'INSERT INTO status_changes (application_id, status_id, changed_on) VALUES (?, ?, ?)'
  ),
  setChangeDate: db.prepare('UPDATE status_changes SET changed_on = ? WHERE id = ?'),
};

const toApplication = (row, history) => ({
  id: row.id,
  company: row.company,
  role: row.role,
  url: row.url,
  location: row.location,
  workMode: row.work_mode,
  salary: row.salary,
  source: row.source,
  contact: row.contact,
  notes: row.notes,
  dateApplied: row.date_applied,
  history,
});

function listApplications(userId) {
  const histories = new Map();
  for (const change of appStmts.history.all(userId)) {
    const list = histories.get(change.application_id) ?? [];
    list.push({ statusId: change.status_id, date: change.changed_on });
    histories.set(change.application_id, list);
  }
  return appStmts.list.all(userId).map((row) => toApplication(row, histories.get(row.id) ?? []));
}

function getApplication(userId, appId) {
  const row = appStmts.get.get(appId, userId);
  if (!row) throw new HttpError(404, 'application not found');
  const history = appStmts.historyFor
    .all(appId)
    .map((c) => ({ statusId: c.status_id, date: c.changed_on }));
  return toApplication(row, history);
}

function applicationFields(body) {
  const workMode = body.workMode ?? '';
  if (!WORK_MODES.has(workMode)) throw new HttpError(400, 'unknown work mode');
  const url = text(body.url, MAX_URL);
  if (url && !/^https?:\/\//i.test(url)) throw new HttpError(400, 'url must start with http:// or https://');

  return {
    company: requiredText(body.company, MAX_SHORT, 'company'),
    role: requiredText(body.role, MAX_SHORT, 'role'),
    url,
    location: text(body.location, MAX_SHORT),
    work_mode: workMode,
    salary: text(body.salary, MAX_SHORT),
    source: text(body.source, MAX_SHORT),
    contact: text(body.contact, MAX_SHORT),
    notes: text(body.notes, MAX_NOTES),
    date_applied: isoDate(body.dateApplied, 'dateApplied'),
  };
}

function createApplication(userId, body) {
  const fields = applicationFields(body);
  const today = clientToday(body);
  const statusId = body.statusId === undefined ? null : findStatus(id(body.statusId), userId).id;

  return transaction(() => {
    const first = statusStmts.firstStage.get(userId);
    if (!first) throw new HttpError(409, 'define at least one stage first');

    const appId = appStmts.insert.get({ ...fields, user_id: userId }).id;
    // Every application enters at the first stage on the day it was applied
    // for, so the flow diagram has a common starting point.
    appStmts.addChange.run(appId, first.id, fields.date_applied);
    if (statusId !== null && statusId !== first.id) appStmts.addChange.run(appId, statusId, today);
    return appId;
  });
}

function updateApplication(userId, appId, body) {
  const existing = getApplication(userId, appId);
  const fields = applicationFields({ ...existing, ...body });
  const today = clientToday(body);
  const statusId = body.statusId === undefined ? null : findStatus(id(body.statusId), userId).id;

  transaction(() => {
    appStmts.update.run({ ...fields, id: appId, user_id: userId });

    // Keep the entry at the first stage in step with the applied date.
    const history = appStmts.historyFor.all(appId);
    if (history.length && fields.date_applied !== existing.dateApplied) {
      appStmts.setChangeDate.run(fields.date_applied, history[0].id);
    }

    const current = history[history.length - 1]?.status_id;
    if (statusId !== null && statusId !== current) {
      appStmts.addChange.run(appId, statusId, today);
      appStmts.touch.run(appId);
    }
  });
}

function deleteApplication(userId, appId) {
  if (appStmts.remove.run(appId, userId).changes === 0) {
    throw new HttpError(404, 'application not found');
  }
}

// --- http -------------------------------------------------------------------

const app = express();

// Behind Caddy, which is behind Cloudflare.
app.set('trust proxy', true);

app.use((req, res, next) => {
  const start = process.hrtime.bigint();
  res.once('close', () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    const who = req.user ? ` user=${req.user.id.slice(0, 8)}` : '';
    console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${ms.toFixed(1)}ms${who}`);
  });
  next();
});

const api = express.Router();

// Only the listed origins get CORS headers, so a page anywhere else can
// neither read responses nor pass the preflight the X-Jobgrindr header needs.
api.use((req, res, next) => {
  const origin = req.get('origin');
  res.vary('Origin');
  if (!origin || !CORS_ORIGINS.has(origin)) return next();

  res.set({
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
  });
  if (req.method !== 'OPTIONS') return next();

  res.set({
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE',
    'Access-Control-Allow-Headers': 'Content-Type, X-Jobgrindr',
    'Access-Control-Max-Age': '600',
  });
  res.status(204).end();
});

api.use(express.json({ limit: '100kb' }));

// A header a cross-site form or image cannot send, and that a cross-site
// script can only send after a CORS preflight this server never approves.
// Together with the SameSite cookie, that is the CSRF defence.
api.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  if (req.get('x-jobgrindr') !== '1') return res.status(403).json({ error: 'missing request header' });
  next();
});

api.get('/health', (req, res) => res.json({ ok: true }));

api.get('/config', (req, res) => res.json({ googleClientId: GOOGLE_CLIENT_ID || null }));

api.post('/session', async (req, res, next) => {
  try {
    if (!GOOGLE_CLIENT_ID) throw new HttpError(400, 'sign-in is not configured');
    const credential = req.body?.credential;
    if (typeof credential !== 'string' || !credential) throw new HttpError(400, 'credential is required');

    const claims = await verifyGoogleIdToken(credential);
    if (!claims) throw new HttpError(401, 'sign-in failed');
    if (ALLOWED_EMAILS.size && !ALLOWED_EMAILS.has(claims.email.toLowerCase())) {
      throw new HttpError(403, `${claims.email} is not allowed to use this app`);
    }

    const user = ensureUser(claims.sub, claims.email, claims.name || '');
    res.cookie(SESSION_COOKIE, createSession(user.id), { ...cookieOptions(req), maxAge: SESSION_TTL_MS });
    res.json(user);
  } catch (err) {
    next(err);
  }
});

api.delete('/session', (req, res) => {
  const token = readCookie(req, SESSION_COOKIE);
  if (token) authStmts.deleteSession.run(hashToken(token));
  res.clearCookie(SESSION_COOKIE, cookieOptions(req));
  res.status(204).end();
});

let localUser = null;

// Everything below needs a signed-in user.
api.use((req, res, next) => {
  if (!GOOGLE_CLIENT_ID) {
    localUser ??= ensureUser('local', 'local@localhost', 'Local user');
    req.user = localUser;
    return next();
  }
  const token = readCookie(req, SESSION_COOKIE);
  const user = token && authStmts.sessionUser.get(hashToken(token));
  if (!user) return res.status(401).json({ error: 'sign in required' });
  req.user = user;
  next();
});

api.get('/me', (req, res) => res.json(req.user));

api.get('/statuses', (req, res) => res.json(listStatuses(req.user.id)));

api.post('/statuses', (req, res) => {
  createStatus(req.user.id, req.body ?? {});
  res.status(201).json(listStatuses(req.user.id));
});

// Registered before /:id so "order" is not read as an id.
api.put('/statuses/order', (req, res) => {
  reorderStatuses(req.user.id, req.body?.ids);
  res.json(listStatuses(req.user.id));
});

api.patch('/statuses/:id', (req, res) => {
  updateStatus(req.user.id, id(req.params.id), req.body ?? {});
  res.json(listStatuses(req.user.id));
});

api.delete('/statuses/:id', (req, res) => {
  deleteStatus(req.user.id, id(req.params.id));
  res.json(listStatuses(req.user.id));
});

api.get('/applications', (req, res) => res.json(listApplications(req.user.id)));

api.post('/applications', (req, res) => {
  const appId = createApplication(req.user.id, req.body ?? {});
  res.status(201).json(getApplication(req.user.id, appId));
});

api.patch('/applications/:id', (req, res) => {
  const appId = id(req.params.id);
  updateApplication(req.user.id, appId, req.body ?? {});
  res.json(getApplication(req.user.id, appId));
});

api.delete('/applications/:id', (req, res) => {
  deleteApplication(req.user.id, id(req.params.id));
  res.status(204).end();
});

api.use((req, res) => res.status(404).json({ error: 'not found' }));

app.use(`${BASE_PATH}/api`, api);

// The client is served from APP_URL in production (GitHub Pages), from the
// local build when there is one, and by Vite in development.
if (APP_URL) {
  app.get([BASE_PATH || '/', `${BASE_PATH}/{*rest}`], (req, res) => res.redirect(301, APP_URL));
} else if (fs.existsSync(path.join(CLIENT_DIR, 'index.html'))) {
  const sendIndex = (req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.sendFile(path.join(CLIENT_DIR, 'index.html'));
  };
  // The client's asset URLs are relative to the trailing slash. Express routes
  // ignore it, so check the raw URL or /jobgrindr/ would redirect to itself.
  if (BASE_PATH) {
    app.get(BASE_PATH, (req, res, next) =>
      req.originalUrl.split('?')[0] === BASE_PATH ? res.redirect(301, `${BASE_PATH}/`) : next()
    );
  }
  app.use(BASE_PATH || '/', express.static(CLIENT_DIR, { index: false, maxAge: '1h' }));
  // A missing asset is a 404, not the app shell served as JavaScript.
  app.use(`${BASE_PATH}/assets`, (req, res) => res.status(404).end());
  app.get(`${BASE_PATH}/{*rest}`, sendIndex);
}

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'invalid JSON' });
  console.error(err);
  res.status(500).json({ error: 'internal error' });
});

if (require.main === module) {
  app.listen(PORT, HOST, () => {
    const auth = GOOGLE_CLIENT_ID ? 'Google sign-in' : 'no sign-in (local development)';
    console.log(`listening on http://${HOST}:${PORT}${BASE_PATH}/ (db: ${DB_PATH}, auth: ${auth})`);
  });
}

module.exports = { app, db };
