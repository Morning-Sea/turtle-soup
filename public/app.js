const API_BASE = '';
let currentUser = null;
let currentRoom = null;
let selectedCase = null;

async function request(url, options = {}) {
  const token = localStorage.getItem('turtle_token');
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const response = await fetch(`${API_BASE}${url}`, { ...options, headers });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '请求失败');
  return data;
}
function post(url, body) { return request(url, { method: 'POST', body: JSON.stringify(body) }); }
function del(url) { return request(url, { method: 'DELETE' }); }

function configureGate(status) {
  const invite = params.get('invite') || '';
  $('loginInvite').value = invite; $('registerInvite').value = invite;
  $('loginForm').classList.toggle('hidden', status === 'register');
  $('registerForm').classList.toggle('hidden', status === 'login');
}

const params = new URLSearchParams(window.location.search);
if (params.get('invite')) configureGate('register');

async function checkAuth() {
  if (!localStorage.getItem('turtle_token')) return false;
  try {
    const data = await request('/api/auth/me');
    currentUser = data.user;
    $('userBadge').textContent = `${currentUser.name}`;
    $('gate').classList.add('hidden');
    return true;
  } catch (error) {
    localStorage.removeItem('turtle_token');
    return false;
  }
}

async function login(event) {
  event.preventDefault();
  try {
    const data = await post('/api/auth/login', {
      name: $('loginName').value, pass: $('loginPass').value, invite: $('loginInvite').value
    });
    localStorage.setItem('turtle_token', data.token);
    window.location.search = '';
  } catch (error) { alert(error.message); }
}

async function register(event) {
  event.preventDefault();
  try {
    const data = await post('/api/auth/register', {
      name: $('registerName').value, pass: $('registerPass').value, invite: $('registerInvite').value
    });
    localStorage.setItem('turtle_token', data.token);
    window.location.search = '';
  } catch (error) { alert(error.message); }
}

function logout() { localStorage.removeItem('turtle_token'); window.location.reload(); }

function escapeHtml(unsafe) {
  if (typeof unsafe !== 'string') return unsafe;
  return unsafe.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function formatDate(isoString) {
  const date = new Date(isoString);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

async function loadAccountSummary() {
  const panel = $('accountPanel');
  if (!panel.classList.contains('hidden')) { panel.classList.add('hidden'); return; }
  panel.classList.remove('hidden');
  const box = $('accountSummary'); box.innerHTML = '<span class="hint">正在获取账号摘要...</span>';
  try {
    const data = await request('/api/account/summary');
    renderAccountSummary(data);
  } catch (error) { box.innerHTML = `<span class="hint">${escapeHtml(error.message)}</span>`; }
}

function renderAccountSummary(data) {
  const box = $('accountSummary'); box.innerHTML = '';
  const userDiv = document.createElement('div'); userDiv.className = 'account-user';
  userDiv.innerHTML = `<b>${escapeHtml(data.user.name)}</b><span>管理员: ${data.user.isAdmin ? '是' : '否'}</span><small>加入于 ${formatDate(data.user.createdAt)}</small>`;
  box.appendChild(userDiv);

  const statsDiv = document.createElement('div'); statsDiv.className = 'account-stats';
  statsDiv.innerHTML = `
    <div class="stat-card"><span>总上传海龟汤</span><b>${data.caseCounts.total}</b><small>公开: ${data.caseCounts.public} | 私有: ${data.caseCounts.private}</small></div>
    <div class="stat-card"><span>主持过的房间</span><b>${data.roomCounts.hosted}</b></div>
    <div class="stat-card"><span>游玩过的房间</span><b>${data.roomCounts.played}</b></div>
  `;
  box.appendChild(statsDiv);

  if (data.recentCases.length > 0) {
    const recentSection = document.createElement('div'); recentSection.className = 'account-recent';
    recentSection.innerHTML = '<h3>最近上传</h3><div class="account-case-list"></div>';
    const list = recentSection.querySelector('.account-case-list');
    data.recentCases.forEach(item => {
      const card = document.createElement('button'); card.type = 'button'; card.className = 'account-case ghost';
      card.innerHTML = `<b>${escapeHtml(item.title)}</b><span>${escapeHtml(item.soup)}</span><small>${item.visibility === 'public' ? '公开' : '私有'} · ${formatDate(item.createdAt)}</small>`;
      card.addEventListener('click', async () => chooseCase((await request(`/api/cases/${item.id}`)).case));
      list.appendChild(card);
    });
    box.appendChild(recentSection);
  }
}

async function createInvite() {
  try {
    const data = await post('/api/auth/invite', {});
    $('inviteResult').innerHTML = `<b>邀请码已生成：</b><br><code>${location.origin}/?invite=${data.invite}</code><br><span class="hint">可供注册一次。</span>`;
  } catch (error) { alert(error.message); }
}

function $(id) { return document.getElementById(id); }

async function saveSelectedCase(visibility) {
  if (!selectedCase || !selectedCase.truth) return alert('当前没有包含汤底的海龟汤可保存。');
  const btn = $('saveSelectedCase'); btn.disabled = true;
  try {
    const data = await post('/api/cases/custom', {
      title: selectedCase.title, soup: selectedCase.soup, truth: selectedCase.truth, rules: selectedCase.rules, visibility: visibility, source: selectedCase.source || 'user'
    });
    chooseCase(data.case); await loadCommunity();
    alert('已成功保存到云端。');
  } catch (error) { alert(error.message); }
  btn.disabled = false;
}

function chooseCase(c) {
  selectedCase = c;
  $('selectedCaseName').textContent = c.title || '未命名汤';
  $('soupLibrary').classList.add('hidden');
  $('modePanel').classList.remove('hidden');
  if (selectedCase.truth) {
    $('saveSelectedCaseControls').classList.remove('hidden');
  } else {
    $('saveSelectedCaseControls').classList.add('hidden');
  }
}

function unchooseCase() {
  selectedCase = null;
  $('selectedCaseName').textContent = '未选择';
  $('soupLibrary').classList.remove('hidden');
  $('modePanel').classList.add('hidden');
}

async function uploadCustom(event) {
  event.preventDefault();
  const data = await post('/api/cases/custom', { title: $('customTitle').value, soup: $('customSoup').value, truth: $('customTruth').value, rules: $('customRules').value, visibility: $('customVisibility').value });
  chooseCase(data.case); await loadCommunity(); event.target.reset();
}
async function loadCommunity() {
  const box = $('communityCases'); box.innerHTML = '<span class="hint">正在翻社区汤谱……</span>';
  try {
    const data = await request('/api/cases/community');
    box.innerHTML = data.cases.length ? '' : '<span class="hint">社区还没有公开汤，先上传一锅吧。</span>';
    data.cases.forEach((item) => {
      const card = document.createElement('article'); card.className = 'case-option ghost';
      const choose = document.createElement('button'); choose.type = 'button'; choose.className = 'case-select';
      choose.innerHTML = `<b>${escapeHtml(item.title)}</b><span>${escapeHtml(item.soup)}</span><small>${item.visibility === 'public' ? '公开' : '私有'} · ${escapeHtml(item.ownerName)}</small>`;
      choose.addEventListener('click', async () => {
        if (item.ownerId === currentUser?.id) {
          chooseCase((await request(`/api/cases/${item.id}`)).case);
        } else {
          chooseCase({ id: item.id, title: item.title, soup: item.soup, source: item.source });
        }
      });
      card.appendChild(choose);
      if (item.ownerId === currentUser?.id) {
        const actions = document.createElement('div'); actions.className = 'case-actions';
        const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'danger small'; remove.textContent = '删除';
        remove.addEventListener('click', async () => {
          if (!confirm(`确定删除《${item.title}》吗？`)) return;
          remove.disabled = true;
          try { await del(`/api/cases/${item.id}`); await loadCommunity(); }
          catch (error) { alert(error.message); remove.disabled = false; }
        });
        actions.appendChild(remove); card.appendChild(actions);
      }
      box.appendChild(card);
    });
  } catch (error) { box.innerHTML = `<span class="hint">${escapeHtml(error.message)}</span>`; }
}

async function createRoom(mode) {
  if (!selectedCase) return alert('请先选择一锅汤');
  try {
    let payload = { mode };
    if (selectedCase.id && !selectedCase.truth) { payload.caseId = selectedCase.id; }
    else { payload.case = selectedCase; }
    const data = await post('/api/rooms', payload);
    currentRoom = data.room;
    renderRoom();
    pollRoom();
  } catch (error) { alert(error.message); }
}

async function joinRoom(event) {
  event.preventDefault();
  const roomId = $('joinRoomId').value.trim();
  if (!roomId) return;
  try {
    const data = await post(`/api/rooms/${roomId}/join`, {});
    currentRoom = data.room;
    renderRoom();
    pollRoom();
  } catch (error) { alert(error.message); }
}

function renderRoom() {
  $('soupLibrary').classList.add('hidden');
  $('modePanel').classList.add('hidden');
  $('saveSelectedCaseControls').classList.add('hidden');
  $('roomPlay').classList.remove('hidden');
  if (currentUser.isAdmin) {
    $('adminPanel').classList.add('hidden');
  }

  $('roomIdDisplay').textContent = currentRoom.id;
  $('roomTitle').textContent = currentRoom.case.title || '未命名汤';
  $('roomSoup').textContent = currentRoom.case.soup || '';
  
  const rulesBox = $('roomRules');
  if (currentRoom.case.rules) {
    rulesBox.classList.remove('hidden');
    rulesBox.innerHTML = `<b>附加规则：</b><span>${escapeHtml(currentRoom.case.rules)}</span>`;
  } else { rulesBox.classList.add('hidden'); }

  const isKeeper = currentRoom.keeperId === currentUser.id;
  $('keeperView').classList.toggle('hidden', !isKeeper);
  $('playerView').classList.toggle('hidden', isKeeper);

  if (isKeeper) {
    $('keeperTruth').textContent = currentRoom.case.truth || '';
    $('keeperMode').textContent = currentRoom.mode === 'ai' ? 'AI 守门' : '人工守门';
  }

  $('gameStatus').textContent = currentRoom.status === 'solved' ? '✅ 汤底已揭开' : '🤔 仍在解谜中';
  if (currentRoom.status === 'solved') {
    $('playerAsk').classList.add('hidden');
    $('solvedView').classList.remove('hidden');
    $('solvedTruth').textContent = currentRoom.case.truth || '';
  } else {
    $('playerAsk').classList.remove('hidden');
    $('solvedView').classList.add('hidden');
  }

  renderLogs();
}

function renderLogs() {
  const box = $('roomLog');
  box.innerHTML = '';
  currentRoom.logs.forEach(log => {
    const div = document.createElement('div');
    if (log.role === 'keeper') {
      div.className = 'msg keeper';
      div.innerHTML = `<b>守门人</b><br><span>${escapeHtml(log.content)}</span>`;
    } else {
      div.className = 'msg player';
      div.innerHTML = `<b>${escapeHtml(log.playerName || '玩家')}</b><br><span>${escapeHtml(log.content)}</span>`;
    }
    box.appendChild(div);
  });
  box.scrollTop = box.scrollHeight;
}

async function askQuestion(event) {
  event.preventDefault();
  const content = $('askInput').value.trim();
  if (!content) return;
  const btn = event.target.querySelector('button');
  btn.disabled = true; $('askInput').disabled = true;
  try {
    const data = await post(`/api/rooms/${currentRoom.id}/ask`, { content });
    currentRoom = data.room;
    $('askInput').value = '';
    renderRoom();
  } catch (error) { alert(error.message); }
  btn.disabled = false; $('askInput').disabled = false; $('askInput').focus();
}

async function keeperReply(content) {
  if (currentRoom.status === 'solved') return;
  try {
    const data = await post(`/api/rooms/${currentRoom.id}/reply`, { content });
    currentRoom = data.room;
    renderRoom();
  } catch (error) { alert(error.message); }
}

async function markSolved() {
  if (!confirm('确定要揭开汤底，结束本局吗？')) return;
  try {
    const data = await post(`/api/rooms/${currentRoom.id}/solve`, {});
    currentRoom = data.room;
    renderRoom();
  } catch (error) { alert(error.message); }
}

async function leaveRoom() {
  currentRoom = null;
  $('roomPlay').classList.add('hidden');
  $('soupLibrary').classList.remove('hidden');
  if (currentUser.isAdmin) {
    $('adminPanel').classList.remove('hidden');
  }
}

let pollTimer = null;
function pollRoom() {
  if (pollTimer) clearTimeout(pollTimer);
  if (!currentRoom) return;
  pollTimer = setTimeout(async () => {
    try {
      const data = await request(`/api/rooms/${currentRoom.id}`);
      currentRoom = data.room;
      renderRoom();
    } catch (e) {
      if (e.message.includes('不存在')) {
        alert('房间已关闭'); leaveRoom(); return;
      }
    }
    pollRoom();
  }, 3000);
}

document.addEventListener('DOMContentLoaded', async () => {
  $('loginForm').addEventListener('submit', login);
  $('registerForm').addEventListener('submit', register);
  $('logoutBtn').addEventListener('click', logout);
  $('customForm').addEventListener('submit', uploadCustom);
  $('createAiBtn').addEventListener('click', () => createRoom('ai'));
  $('createHumanBtn').addEventListener('click', () => createRoom('human'));
  $('joinForm').addEventListener('submit', joinRoom);
  $('playerAsk').addEventListener('submit', askQuestion);
  
  if (await checkAuth()) {
    if (currentUser.isAdmin) $('adminPanel').classList.remove('hidden');
    await loadCommunity();
    const joined = params.get('join');
    if (joined) {
      $('joinRoomId').value = joined;
      joinRoom(new Event('submit'));
      window.history.replaceState({}, '', '/');
    }
  }
});