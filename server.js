'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { promisify } = require('node:util');
const Fastify = require('fastify');
const staticPlugin = require('@fastify/static');

const scrypt = promisify(crypto.scrypt);
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data', 'store.json');
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_HOURS || 168) * 60 * 60 * 1000;
const SECURE_COOKIE = process.env.NODE_ENV === 'production' && process.env.COOKIE_SECURE !== 'false';
const DUMMY_PASSWORD = 'not-the-password-but-expensive-enough';
const DUMMY_SALT = crypto.createHash('sha256').update('turtle-soup-dummy-salt').digest('hex');

const app = Fastify({ logger: true, bodyLimit: 1_000_000 });
let storeLock = Promise.resolve();
const attempts = new Map();

app.register(staticPlugin, {
  root: path.join(__dirname, 'public'),
  prefix: '/',
});

const fallbackCases = [
  {
    title: '雨夜空房',
    soup: '一个人走进空房间，关上门后立刻打电话报警。为什么？',
    truth: '他是房东，发现本该空置的房间里有一把湿伞和一双还在滴水的鞋，说明入侵者刚刚躲了起来。',
    rules: ['只能回答是、不是、无关或接近', '真相与房间里新增的物品有关', '没有超自然元素'],
  },
  {
    title: '沉默的掌声',
    soup: '舞台上所有人都在鼓掌，主角却哭了。为什么？',
    truth: '主角是手语剧演员，这场演出献给失聪的母亲。掌声是观众用手语挥手表达，母亲第一次完整“听见”了谢幕。',
    rules: ['哭是因为感动', '掌声不是普通声音', '关键人物在观众席'],
  },
  {
    title: '最后一口汤',
    soup: '他喝完汤后，知道自己再也回不了家了。为什么？',
    truth: '他参加极地探险迷路，同行者骗他说汤是海龟汤；回城后喝到真正海龟汤，发现当年喝的其实是遇难同伴的肉汤。',
    rules: ['经典黑暗海龟汤变体', '真相与汤的真实成分有关', '不是物理上不能回家，而是心理上崩溃'],
  },
];

function emptyStore() {
  return { users: [], invites: [], sessions: [] };
}

async function readStore() {
  try {
    const raw = await fs.readFile(DATA_FILE, 'utf8');
    return { ...emptyStore(), ...JSON.parse(raw) };
  } catch (error) {
    if (error.code === 'ENOENT') return emptyStore();
    throw error;
  }
}

async function writeStore(store) {
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  const tmp = `${DATA_FILE}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(store, null, 2), { mode: 0o600 });
  await fs.rename(tmp, DATA_FILE);
}

async function withStore(update) {
  const next = storeLock.then(async () => {
    const store = await readStore();
    const result = await update(store);
    await writeStore(store);
    return result;
  });
  storeLock = next.catch(() => {});
  return next;
}

function normalizeName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 32);
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function publicUser(user) {
  if (!user) return null;
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

function validatePassword(password) {
  const value = String(password || '');
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((rule) => rule.test(value)).length;
  if (value.length < 12 || classes < 3) {
    return '暗号至少 12 位，并包含大小写字母、数字、符号中的任意 3 类。';
  }
  return '';
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = await scrypt(String(password), salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt}$${hash.toString('hex')}`;
}

async function verifyPassword(password, storedHash) {
  const [, salt = DUMMY_SALT, hashHex] = String(storedHash || '').split('$');
  const expected = Buffer.from(hashHex || '00'.repeat(64), 'hex');
  const actual = await scrypt(String(password || DUMMY_PASSWORD), salt, expected.length, { N: 16384, r: 8, p: 1 });
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual) && Boolean(storedHash);
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function makeToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((part) => {
    const index = part.indexOf('=');
    if (index < 0) return ['', ''];
    return [decodeURIComponent(part.slice(0, index).trim()), decodeURIComponent(part.slice(index + 1).trim())];
  }).filter(([key]) => key));
}

function setSessionCookie(reply, token, maxAge = Math.floor(SESSION_TTL_MS / 1000)) {
  const attrs = [`turtle_session=${encodeURIComponent(token)}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${maxAge}`];
  if (SECURE_COOKIE) attrs.push('Secure');
  reply.header('set-cookie', attrs.join('; '));
}

async function currentUser(request) {
  const token = parseCookies(request.headers.cookie).turtle_session;
  if (!token) return null;
  const tokenHash = hashToken(token);
  const now = Date.now();
  return withStore(async (store) => {
    store.sessions = store.sessions.filter((session) => session.expiresAt > now);
    const session = store.sessions.find((item) => item.tokenHash === tokenHash);
    if (!session) return null;
    const user = store.users.find((item) => item.id === session.userId);
    if (!user) return null;
    session.lastSeenAt = now;
    return publicUser(user);
  });
}

function assertRateLimit(key, limit, windowMs) {
  const now = Date.now();
  const bucket = attempts.get(key) || [];
  const fresh = bucket.filter((time) => now - time < windowMs);
  fresh.push(now);
  attempts.set(key, fresh);
  if (fresh.length > limit) {
    const error = new Error('尝试过于频繁，请稍后再试。');
    error.statusCode = 429;
    throw error;
  }
}

function systemPrompt() {
  return `你是“汤铺老板”，主持中文海龟汤游戏。你必须严格遵守：\n1. 玩家通过是/不是问题接近真相；你只能回答：是、不是、无关、不确定、接近。可补一句极短的氛围提示。\n2. 不要直接泄露真相，除非玩家明确要求“揭晓/公布答案/结束”。\n3. 如果玩家提问不是封闭问题，引导他改成可用“是/不是”回答的问题。\n4. 保持悬疑、克制、文学化，不使用“作为AI”等表述。\n5. 题面、真相、边界规则会由用户消息提供。`;
}

async function askModel(messages, temperature = 0.75) {
  if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not configured');
  const res = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({ model: OPENAI_MODEL, temperature, messages }),
  });
  if (!res.ok) throw new Error(`model request failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  return json.choices?.[0]?.message?.content?.trim() || '';
}

async function requireAuth(request, reply) {
  const user = await currentUser(request);
  if (!user) {
    reply.code(401).send({ error: '请先入席。' });
    return null;
  }
  return user;
}

async function requireAdmin(request, reply) {
  const user = await requireAuth(request, reply);
  if (!user) return null;
  if (user.role !== 'admin') {
    reply.code(403).send({ error: '只有掌柜可以递出请帖。' });
    return null;
  }
  return user;
}

app.get('/api/health', async () => ({ ok: true, model: OPENAI_MODEL, openaiCompatible: Boolean(OPENAI_API_KEY) }));

app.get('/api/auth/status', async (request) => {
  const user = await currentUser(request);
  const store = await readStore();
  return { hasAdmin: store.users.some((item) => item.role === 'admin'), user };
});

app.post('/api/auth/admin', async (request, reply) => {
  const { name, email, password } = request.body || {};
  const cleanName = normalizeName(name);
  const cleanEmail = normalizeEmail(email);
  const passwordError = validatePassword(password);
  if (!cleanName || !/^\S+@\S+\.\S+$/.test(cleanEmail)) return reply.code(400).send({ error: '请填写有效的名号和邮箱。' });
  if (passwordError) return reply.code(400).send({ error: passwordError });
  try { assertRateLimit(`admin:${request.ip}`, 5, 15 * 60 * 1000); }
  catch (error) { return reply.code(error.statusCode).send({ error: error.message }); }
  const result = await withStore(async (store) => {
    if (store.users.length) return { error: '掌柜已经登记，请登录或使用请帖注册。' };
    const user = { id: crypto.randomUUID(), name: cleanName, email: cleanEmail, role: 'admin', passwordHash: await hashPassword(password), createdAt: Date.now() };
    const token = makeToken();
    store.users.push(user);
    store.sessions.push({ tokenHash: hashToken(token), userId: user.id, createdAt: Date.now(), lastSeenAt: Date.now(), expiresAt: Date.now() + SESSION_TTL_MS });
    return { token, user: publicUser(user) };
  });
  if (result.error) return reply.code(409).send({ error: result.error });
  setSessionCookie(reply, result.token);
  return { user: result.user };
});

app.post('/api/auth/login', async (request, reply) => {
  const { email, password } = request.body || {};
  const cleanEmail = normalizeEmail(email);
  try { assertRateLimit(`login:${request.ip}:${cleanEmail}`, 8, 15 * 60 * 1000); }
  catch (error) { return reply.code(error.statusCode).send({ error: error.message }); }
  const store = await readStore();
  const user = store.users.find((item) => item.email === cleanEmail);
  const ok = await verifyPassword(password, user?.passwordHash);
  if (!ok) return reply.code(401).send({ error: '邮箱或暗号不对。' });
  const token = makeToken();
  await withStore(async (fresh) => {
    fresh.sessions.push({ tokenHash: hashToken(token), userId: user.id, createdAt: Date.now(), lastSeenAt: Date.now(), expiresAt: Date.now() + SESSION_TTL_MS });
  });
  setSessionCookie(reply, token);
  return { user: publicUser(user) };
});

app.post('/api/auth/logout', async (request, reply) => {
  const token = parseCookies(request.headers.cookie).turtle_session;
  if (token) {
    const tokenHash = hashToken(token);
    await withStore(async (store) => {
      store.sessions = store.sessions.filter((session) => session.tokenHash !== tokenHash);
    });
  }
  setSessionCookie(reply, '', 0);
  return { ok: true };
});

app.get('/api/invites/:token', async (request) => {
  const tokenHash = hashToken(request.params.token);
  const store = await readStore();
  const invite = store.invites.find((item) => item.tokenHash === tokenHash && !item.usedBy && item.expiresAt > Date.now());
  return { valid: Boolean(invite), note: invite?.note || '' };
});

app.post('/api/invites', async (request, reply) => {
  const admin = await requireAdmin(request, reply);
  if (!admin) return null;
  const note = normalizeName(request.body?.note || '一张请帖');
  const token = makeToken(24);
  const invite = await withStore(async (store) => {
    const item = { id: crypto.randomUUID(), tokenHash: hashToken(token), note, createdBy: admin.id, createdAt: Date.now(), expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000, usedBy: null, usedAt: null };
    store.invites.push(item);
    return item;
  });
  return { invite: { id: invite.id, note: invite.note, url: `${PUBLIC_BASE_URL || `${request.protocol}://${request.headers.host}`}/?invite=${token}`, expiresAt: invite.expiresAt } };
});

app.get('/api/invites', async (request, reply) => {
  const admin = await requireAdmin(request, reply);
  if (!admin) return null;
  const store = await readStore();
  return {
    invites: store.invites.slice(-20).reverse().map((invite) => ({
      id: invite.id,
      note: invite.note,
      createdAt: invite.createdAt,
      expiresAt: invite.expiresAt,
      used: Boolean(invite.usedBy),
    })),
  };
});

app.post('/api/auth/register', async (request, reply) => {
  const { name, email, password, inviteToken } = request.body || {};
  const cleanName = normalizeName(name);
  const cleanEmail = normalizeEmail(email);
  const passwordError = validatePassword(password);
  if (!cleanName || !/^\S+@\S+\.\S+$/.test(cleanEmail)) return reply.code(400).send({ error: '请填写有效的名号和邮箱。' });
  if (passwordError) return reply.code(400).send({ error: passwordError });
  try { assertRateLimit(`register:${request.ip}:${cleanEmail}`, 5, 15 * 60 * 1000); }
  catch (error) { return reply.code(error.statusCode).send({ error: error.message }); }
  const result = await withStore(async (store) => {
    if (!store.users.length) return { error: '第一位入席者必须先登记为掌柜。' };
    if (store.users.some((item) => item.email === cleanEmail)) return { error: '这只邮箱已经入席。' };
    const invite = store.invites.find((item) => item.tokenHash === hashToken(inviteToken) && !item.usedBy && item.expiresAt > Date.now());
    if (!invite) return { error: '请帖无效、过期，或已经被使用。' };
    const user = { id: crypto.randomUUID(), name: cleanName, email: cleanEmail, role: 'player', passwordHash: await hashPassword(password), createdAt: Date.now() };
    const token = makeToken();
    invite.usedBy = user.id;
    invite.usedAt = Date.now();
    store.users.push(user);
    store.sessions.push({ tokenHash: hashToken(token), userId: user.id, createdAt: Date.now(), lastSeenAt: Date.now(), expiresAt: Date.now() + SESSION_TTL_MS });
    return { token, user: publicUser(user) };
  });
  if (result.error) return reply.code(400).send({ error: result.error });
  setSessionCookie(reply, result.token);
  return { user: result.user };
});

app.post('/api/case', async (request, reply) => {
  const user = await requireAuth(request, reply);
  if (!user) return null;
  const { mood = '悬疑', difficulty = '标准' } = request.body || {};
  if (!OPENAI_API_KEY) {
    return { source: 'local', case: fallbackCases[Math.floor(Math.random() * fallbackCases.length)] };
  }
  const content = await askModel([
    { role: 'system', content: '你是中文海龟汤谜题设计师。输出严格 JSON，不要 markdown。字段：title,soup,truth,rules(3条字符串数组)。题面公平、可推理、适合是/不是提问，不要血腥猎奇。' },
    { role: 'user', content: `生成一题${difficulty}难度、${mood}气质的原创海龟汤。` },
  ], 0.95);
  try { return { source: 'ai', case: JSON.parse(content) }; }
  catch { return { source: 'ai', case: { title: '未命名汤', soup: content, truth: '主持人生成了一个需要重新开局的谜底。', rules: ['可重新开局'] } }; }
});

app.post('/api/ask', async (request, reply) => {
  const user = await requireAuth(request, reply);
  if (!user) return null;
  const { currentCase, history = [], question = '' } = request.body || {};
  if (!question.trim()) return reply.code(400).send({ error: 'question is required' });
  if (!currentCase?.truth) return reply.code(400).send({ error: 'currentCase is required' });
  if (!OPENAI_API_KEY) {
    const q = question.trim();
    const reveal = /揭晓|答案|结束|真相/.test(q);
    return { answer: reveal ? `揭晓：${currentCase.truth}` : '木勺停在碗沿：没有接入模型时，老板只能沉默地点头。请配置 OPENAI_API_KEY 后继续追问。' };
  }
  const transcript = history.slice(-16).map((h) => `${h.role === 'player' ? '玩家' : '老板'}：${h.content}`).join('\n');
  const answer = await askModel([
    { role: 'system', content: systemPrompt() },
    { role: 'user', content: `题名：${currentCase.title}\n题面：${currentCase.soup}\n真相：${currentCase.truth}\n边界：${(currentCase.rules || []).join('；')}\n历史：\n${transcript}\n玩家新问题：${question}` },
  ], 0.55);
  return { answer };
});

app.setNotFoundHandler((_request, reply) => reply.sendFile('index.html'));

app.listen({ port: PORT, host: HOST }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
