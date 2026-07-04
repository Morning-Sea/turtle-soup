const $ = (id) => document.getElementById(id);
let currentCase = null;
let history = [];

function add(role, content) {
  const node = document.createElement('div');
  node.className = `msg ${role === 'player' ? 'player' : 'keeper'}`;
  node.textContent = content;
  $('log').appendChild(node);
  $('log').scrollTop = $('log').scrollHeight;
  history.push({ role, content });
}

async function post(url, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function newCase() {
  $('newCase').disabled = true;
  $('newCase').textContent = '煨汤中…';
  try {
    const data = await post('/api/case', { mood: $('mood').value, difficulty: $('difficulty').value });
    currentCase = data.case;
    history = [];
    $('log').innerHTML = '';
    $('source').textContent = data.source === 'ai' ? '本锅现熬' : '本地秘方';
    $('title').textContent = currentCase.title;
    $('soup').textContent = currentCase.soup;
    add('keeper', '汤已经上桌。请只用能回答“是/不是”的问题追问。');
  } catch (error) {
    add('keeper', `锅底裂了：${error.message}`);
  } finally {
    $('newCase').disabled = false;
    $('newCase').textContent = '开一锅新汤';
  }
}

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

newCase();
