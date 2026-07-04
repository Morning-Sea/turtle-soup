const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
let mode = 'login';
let currentUser = null;
let currentCase = null;
let history = [];

function show(node, visible = true) {
  node.classList.toggle('hidden', !visible);
}

function setText(id, value) {
  $(id).textContent = value;
}

function add(role, content) {
  const node = document.createElement('div');
  node.className = `msg ${role === 'player' ? 'player' : 'keeper'}`;
  node.textContent = content;
  $('log').appendChild(node);
  $('log').scrollTop = $('log').scrollHeight;
  history.push({ role, content });
}

async function request(url, options = {}) {
  const res = await fetch(url, {
    credentials: 'same-origin',
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(data.error || text || '请求失败');
  return data;
}

function post(url, body) {
  return request(url, { method: 'POST', body: JSON.stringify(body) });
}

function configureGate(status) {
  const invite = params.get('invite') || '';
  $('inviteToken').value = invite;
  show($('gate'), true);
  show($('app'), false);
  $('authPassword').value = '';

  if (!status.hasAdmin) {
    mode = 'admin';
    setText('gateEyebrow', '掌柜登记');
    setText('gateTitle', '第一晚，只认一位掌柜');
    setText('gateText', '设置汤馆主人。之后所有来客都必须拿到你生成的一次性请帖。');
    setText('authSubmit', '登记掌柜');
    setText('loginSwitch', '已有席位，改为登录');
    show($('authName'), true);
    $('authName').closest('label').classList.remove('hidden');
    return;
  }

  if (invite) {
    mode = 'register';
    setText('gateEyebrow', '凭帖入席');
    setText('gateTitle', '请帖只亮一次');
    setText('gateText', '填好名号、邮箱和暗号。登记完成后，这张请帖就会失效。');
    setText('authSubmit', '接受请帖');
    setText('loginSwitch', '已有席位，改为登录');
    $('authName').closest('label').classList.remove('hidden');
    return;
  }

  mode = 'login';
  setText('gateEyebrow', '夜渡入席');
  setText('gateTitle', '请先报上暗号');
  setText('gateText', '汤馆不接待陌生脚步。若你还没有席位，请向掌柜索取一次性请帖。');
  setText('authSubmit', '入席');
  setText('loginSwitch', '我拿到了请帖');
  $('authName').closest('label').classList.add('hidden');
}

function enterApp(user) {
  currentUser = user;
  show($('gate'), false);
  show($('app'), true);
  setText('userBadge', `${user.name} · ${user.role === 'admin' ? '掌柜' : '来客'}`);
  show($('adminTools'), user.role === 'admin');
  newCase();
}

async function loadStatus() {
  const status = await request('/api/auth/status');
  if (status.user) enterApp(status.user);
  else configureGate(status);
}

async function submitAuth(event) {
  event.preventDefault();
  const body = {
    name: $('authName').value.trim(),
    email: $('authEmail').value.trim(),
    password: $('authPassword').value,
    inviteToken: $('inviteToken').value,
  };
  const endpoint = mode === 'admin' ? '/api/auth/admin' : mode === 'register' ? '/api/auth/register' : '/api/auth/login';
  $('authSubmit').disabled = true;
  try {
    const data = await post(endpoint, body);
    enterApp(data.user);
    window.history.replaceState({}, '', location.pathname);
  } catch (error) {
    setText('authHint', error.message);
  } finally {
    $('authSubmit').disabled = false;
  }
}

async function newCase() {
  $('newCase').disabled = true;
  setText('newCase', '煨汤中…');
  try {
    const data = await post('/api/case', { mood: $('mood').value, difficulty: $('difficulty').value });
    currentCase = data.case;
    history = [];
    $('log').innerHTML = '';
    setText('source', data.source === 'ai' ? '本锅现熬' : '本地秘方');
    setText('title', currentCase.title);
    setText('soup', currentCase.soup);
    add('keeper', '汤已经上桌。请只用能回答“是/不是”的问题追问。');
  } catch (error) {
    add('keeper', `锅底裂了：${error.message}`);
  } finally {
    $('newCase').disabled = false;
    setText('newCase', '开一锅新汤');
  }
}

async function createInvite() {
  $('createInvite').disabled = true;
  try {
    const data = await post('/api/invites', { note: $('inviteNote').value.trim() });
    $('inviteBox').innerHTML = `<b>请帖已写好</b><code>${data.invite.url}</code><span>复制给一位来客。用过即焚，七日后自灭。</span>`;
    show($('inviteBox'), true);
    await navigator.clipboard?.writeText(data.invite.url).catch(() => {});
  } catch (error) {
    $('inviteBox').textContent = error.message;
    show($('inviteBox'), true);
  } finally {
    $('createInvite').disabled = false;
  }
}

$('authForm').addEventListener('submit', submitAuth);
$('loginSwitch').addEventListener('click', () => {
  if (mode === 'login') {
    const token = prompt('贴上掌柜给你的请帖链接或尾码');
    if (token) {
      const parsed = token.includes('invite=') ? new URL(token).searchParams.get('invite') : token.trim();
      $('inviteToken').value = parsed;
      params.set('invite', parsed);
      configureGate({ hasAdmin: true });
    }
    return;
  }
  params.delete('invite');
  configureGate({ hasAdmin: true });
});
$('logout').addEventListener('click', async () => {
  await post('/api/auth/logout', {});
  currentUser = null;
  currentCase = null;
  await loadStatus();
});
$('createInvite').addEventListener('click', createInvite);
$('newCase').addEventListener('click', newCase);
$('reveal').addEventListener('click', () => currentCase && add('keeper', `揭晓：${currentCase.truth}`));
$('askForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!currentCase) return add('keeper', '先开一锅新汤。');
  const question = $('question').value.trim();
  if (!question) return;
  $('question').value = '';
  add('player', question);
  try {
    const data = await post('/api/ask', { currentCase, history, question });
    add('keeper', data.answer);
  } catch (error) {
    add('keeper', `木勺停住了：${error.message}`);
  }
});

loadStatus().catch((error) => {
  show($('gate'), true);
  setText('authHint', error.message);
});
