const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
let mode = 'login';
let currentUser = null;
let selectedCase = null;
let activeRoom = null;
let roomPoll = null;

function show(node, visible = true) { node.classList.toggle('hidden', !visible); }
function setText(id, value) { $(id).textContent = value; }
function add(role, content, name = '') {
  const node = document.createElement('div');
  node.className = `msg ${role === 'player' ? 'player' : 'keeper'}`;
  node.textContent = name ? `${name}：${content}` : content;
  $('log').appendChild(node);
  $('log').scrollTop = $('log').scrollHeight;
}
async function request(url, options = {}) {
  const res = await fetch(url, { credentials: 'same-origin', ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) } });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(data.error || text || '请求失败');
  return data;
}
function post(url, body) { return request(url, { method: 'POST', body: JSON.stringify(body) }); }
function del(url) { return request(url, { method: 'DELETE' }); }

function configureGate(status) {
  const invite = params.get('invite') || '';
  $('inviteToken').value = invite;
  show($('gate'), true); show($('app'), false);
  $('authPassword').value = '';
  if (!status.hasAdmin) {
    mode = 'admin'; setText('gateEyebrow', '掌柜登记'); setText('gateTitle', '第一晚，只认一位掌柜');
    setText('gateText', '设置汤馆主人。之后所有来客都必须拿到你生成的一次性请帖。'); setText('authSubmit', '登记掌柜');
    setText('loginSwitch', '已有席位，改为登录'); $('authName').closest('label').classList.remove('hidden'); return;
  }
  if (invite) {
    mode = 'register'; setText('gateEyebrow', '凭帖入席'); setText('gateTitle', '请帖只亮一次');
    setText('gateText', '填好名号、邮箱和暗号。登记完成后，这张请帖就会失效。'); setText('authSubmit', '接受请帖');
    setText('loginSwitch', '已有席位，改为登录'); $('authName').closest('label').classList.remove('hidden'); return;
  }
  mode = 'login'; setText('gateEyebrow', '夜渡入席'); setText('gateTitle', '请先报上暗号');
  setText('gateText', '汤馆不接待陌生脚步。若你还没有席位，请向掌柜索取一次性请帖。'); setText('authSubmit', '入席');
  setText('loginSwitch', '我拿到了请帖'); $('authName').closest('label').classList.add('hidden');
}

async function enterApp(user) {
  currentUser = user; show($('gate'), false); show($('app'), true);
  setText('userBadge', `${user.name} · ${user.role === 'admin' ? '掌柜' : '来客'}`); show($('adminTools'), user.role === 'admin');
  await loadCommunity();
  if (params.get('room')) await joinRoom(params.get('room'));
}
async function loadStatus() {
  const status = await request('/api/auth/status');
  if (status.user) await enterApp(status.user); else configureGate(status);
}
async function submitAuth(event) {
  event.preventDefault();
  const body = { name: $('authName').value.trim(), email: $('authEmail').value.trim(), password: $('authPassword').value, inviteToken: $('inviteToken').value };
  const endpoint = mode === 'admin' ? '/api/auth/admin' : mode === 'register' ? '/api/auth/register' : '/api/auth/login';
  $('authSubmit').disabled = true;
  try { const data = await post(endpoint, body); await enterApp(data.user); if (!params.get('room')) window.history.replaceState({}, '', location.pathname); }
  catch (error) { setText('authHint', error.message); }
  finally { $('authSubmit').disabled = false; }
}


function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}
function formatDate(timestamp) {
  if (!timestamp) return '未知时间';
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(timestamp));
}
function renderAccountSummary(data) {
  const box = $('accountSummary');
  const cases = data.recentCases || [];
  const roomCounts = data.roomCounts || { total: 0, created: 0, participated: 0 };
  box.innerHTML = `
    <div class="account-user">
      <b>${escapeHtml(data.user.name)}</b>
      <span>${escapeHtml(data.user.email)}</span>
      <small>${data.user.role === 'admin' ? '掌柜' : '来客'}</small>
    </div>
    <div class="account-stats">
      <div class="stat-card"><span>上传总数</span><b>${data.caseCounts.total}</b></div>
      <div class="stat-card"><span>公开汤</span><b>${data.caseCounts.public}</b></div>
      <div class="stat-card"><span>私有汤</span><b>${data.caseCounts.private}</b></div>
      <div class="stat-card"><span>相关汤局</span><b>${roomCounts.total}</b><small>创建 ${roomCounts.created} · 参与 ${roomCounts.participated}</small></div>
    </div>
    <div class="account-recent">
      <h3>最近上传</h3>
      <div class="account-case-list">
        ${cases.length ? cases.map((item) => `
          <button class="account-case ghost" type="button" data-case-id="${item.id}">
            <b>${escapeHtml(item.title)}</b>
            <span>${escapeHtml(item.soup)}</span>
            <small>${item.visibility === 'public' ? '公开' : '私有'} · ${formatDate(item.createdAt)}</small>
          </button>
        `).join('') : '<span class="hint">你还没有上传过海龟汤。</span>'}
      </div>
    </div>
  `;
  box.querySelectorAll('[data-case-id]').forEach((button) => {
    button.addEventListener('click', () => {
      const item = cases.find((candidate) => candidate.id === button.dataset.caseId);
      if (item) chooseCase(item);
    });
  });
}
async function loadAccountSummary() {
  const panel = $('accountPanel');
  const box = $('accountSummary');
  show(panel, true);
  box.innerHTML = '<span class="hint">正在翻你的账册……</span>';
  try { renderAccountSummary(await request('/api/account/summary')); }
  catch (error) { box.innerHTML = `<span class="hint">${escapeHtml(error.message)}</span>`; }
}

function chooseCase(item) {
  selectedCase = item; activeRoom = null; clearInterval(roomPoll);
  setText('selectedCaseName', item.title || '无题之汤'); show($('modePanel'), true);
  show($('saveSelectedCaseControls'), Boolean(item?.truth));
  setText('source', item.source === 'ai' ? '本锅现熬' : item.source === 'user' ? (item.visibility === 'public' ? '社区汤' : '私房汤') : '本地秘方');
  setText('title', item.title); setText('soup', item.soup); $('log').innerHTML = ''; show($('roomBar'), false);
  add('keeper', '已选好汤。请选择单人游玩，或开一桌多人汤局。');
}
async function newCase() {
  $('newCase').disabled = true; setText('newCase', '煨汤中…');
  try { const data = await post('/api/case', { mood: $('mood').value, difficulty: $('difficulty').value }); chooseCase({ ...data.case, source: data.source }); }
  catch (error) { add('keeper', `锅底裂了：${error.message}`); }
  finally { $('newCase').disabled = false; setText('newCase', 'AI / 本地开一锅'); }
}
async function saveCustomCase(event) {
  event.preventDefault();
  const data = await post('/api/cases/custom', { title: $('customTitle').value, soup: $('customSoup').value, truth: $('customTruth').value, rules: $('customRules').value, visibility: $('customVisibility').value });
  chooseCase(data.case); await loadCommunity(); event.target.reset();
}
async function saveSelectedCase(visibility) {
  if (!selectedCase?.truth) return add('keeper', '请先选择一锅带汤底的汤。');
  $('saveSelectedCase').disabled = true;
  try {
    const data = await post('/api/cases/custom', {
      title: selectedCase.title,
      soup: selectedCase.soup,
      truth: selectedCase.truth,
      rules: Array.isArray(selectedCase.rules) ? selectedCase.rules.join('\n') : selectedCase.rules,
      visibility,
      source: selectedCase.source,
    });
    chooseCase(data.case);
    await loadCommunity();
    add('keeper', `这锅汤已保存为${data.case.visibility === 'public' ? '公开' : '私有'}。`);
  } catch (error) { add('keeper', `保存失败：${error.message}`); }
  finally { $('saveSelectedCase').disabled = false; }
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
      choose.addEventListener('click', async () => chooseCase((await request(`/api/cases/${item.id}`)).case));
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
async function startRoom(playMode) {
  if (!selectedCase) return add('keeper', '请先选择或创建一锅汤。');
  const data = await post('/api/rooms', { mode: playMode, case: selectedCase });
  renderRoom(data.room); if (playMode === 'multi') history.replaceState({}, '', `?room=${data.room.token}`);
}
async function joinRoom(token) { const data = await post(`/api/rooms/${token}/join`, {}); renderRoom(data.room); startPolling(token); }
function startPolling(token) { clearInterval(roomPoll); roomPoll = setInterval(async () => { try { renderRoom((await request(`/api/rooms/${token}`)).room, true); } catch {} }, 3000); }
function renderRoom(room, silent = false) {
  activeRoom = room; selectedCase = null; show($('modePanel'), false); show($('saveSelectedCaseControls'), false); show($('roomBar'), true);
  setText('source', room.mode === 'multi' ? '多人汤局' : '单人汤局'); setText('title', room.case.title); setText('soup', room.case.soup);
  $('roomBar').innerHTML = `<b>${room.mode === 'multi' ? '多人' : '单人'}模式</b><span>座次：${room.players.map((p) => p.name).join(' → ') || '等待入席'}</span>${room.mode === 'multi' ? `<code>${room.inviteUrl}</code>` : ''}<span>${room.isMyTurn ? '轮到你了' : '等待别人提问'}</span>`;
  $('log').innerHTML = ''; room.history.forEach((item) => add(item.role, item.content, item.role === 'player' ? item.name : ''));
  show($('passTurn'), room.mode === 'multi'); $('askButton').disabled = room.mode === 'multi' && !room.isMyTurn; $('passTurn').disabled = room.mode === 'multi' && !room.isMyTurn;
  if (!silent && room.mode === 'multi') navigator.clipboard?.writeText(room.inviteUrl).catch(() => {});
}
async function createInvite() {
  $('createInvite').disabled = true;
  try { const data = await post('/api/invites', { note: $('inviteNote').value.trim() }); $('inviteBox').innerHTML = `<b>请帖已写好</b><code>${data.invite.url}</code><span>复制给一位来客。用过即焚，七日后自灭。</span>`; show($('inviteBox'), true); await navigator.clipboard?.writeText(data.invite.url).catch(() => {}); }
  catch (error) { $('inviteBox').textContent = error.message; show($('inviteBox'), true); }
  finally { $('createInvite').disabled = false; }
}

$('authForm').addEventListener('submit', submitAuth);
$('loginSwitch').addEventListener('click', () => { if (mode === 'login') { const token = prompt('贴上掌柜给你的请帖链接或尾码'); if (token) { const parsed = token.includes('invite=') ? new URL(token).searchParams.get('invite') : token.trim(); $('inviteToken').value = parsed; params.set('invite', parsed); configureGate({ hasAdmin: true }); } return; } params.delete('invite'); configureGate({ hasAdmin: true }); });
$('accountButton').addEventListener('click', loadAccountSummary);
$('closeAccount').addEventListener('click', () => show($('accountPanel'), false));
$('logout').addEventListener('click', async () => { await post('/api/auth/logout', {}); currentUser = null; activeRoom = null; clearInterval(roomPoll); await loadStatus(); });
$('createInvite').addEventListener('click', createInvite); $('newCase').addEventListener('click', newCase); $('refreshCommunity').addEventListener('click', loadCommunity); $('customCaseForm').addEventListener('submit', saveCustomCase);
$('startSingle').addEventListener('click', () => startRoom('single')); $('startMulti').addEventListener('click', () => startRoom('multi'));
$('saveSelectedCase').addEventListener('click', () => saveSelectedCase($('selectedCaseVisibility').value));
$('reveal').addEventListener('click', () => { if (activeRoom?.revealed) add('keeper', `揭晓：${activeRoom.revealed}`); else if (selectedCase) add('keeper', `揭晓：${selectedCase.truth}`); else add('keeper', '请在追问框输入“揭晓答案”，由老板揭开汤底。'); });
$('passTurn').addEventListener('click', async () => { if (activeRoom) renderRoom((await post(`/api/rooms/${activeRoom.token}/pass`, {})).room); });
$('askForm').addEventListener('submit', async (event) => { event.preventDefault(); const question = $('question').value.trim(); if (!question) return; $('question').value = ''; if (!activeRoom) return add('keeper', '请先选择单人或多人游玩。'); try { renderRoom((await post(`/api/rooms/${activeRoom.token}/ask`, { question })).room); } catch (error) { add('keeper', `木勺停住了：${error.message}`); } });
loadStatus().catch((error) => { show($('gate'), true); setText('authHint', error.message); });
