'use strict';

const path = require('node:path');
const Fastify = require('fastify');
const staticPlugin = require('@fastify/static');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

const app = Fastify({ logger: true, bodyLimit: 1_000_000 });

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

app.get('/api/health', async () => ({ ok: true, model: OPENAI_MODEL, openaiCompatible: Boolean(OPENAI_API_KEY) }));

app.post('/api/case', async (request) => {
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
