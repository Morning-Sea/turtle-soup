# 夜渡汤馆 · AI 海龟汤

一个面向 1 核 1G 服务器部署的轻量级 AI 海龟汤 Web 游戏。后端使用 Fastify，前端为原生 HTML/CSS/JavaScript，无构建步骤。

## 功能

- OpenAI 兼容 `/chat/completions` API：可配置 `OPENAI_BASE_URL`、`OPENAI_API_KEY`、`OPENAI_MODEL`。
- AI 生成原创题面、谜底和边界规则。
- 经典海龟汤追问流程：玩家提问，主持人只给“是 / 不是 / 无关 / 接近”等克制回答。
- 未配置密钥时自动使用本地题库，方便先部署验证。

## 本地运行

```bash
npm install
cp .env.example .env
# 填写 OPENAI_API_KEY，也可先不填体验本地题库
npm start
```

访问 `http://localhost:3000`。

## 1 核 1G 服务器部署

### Docker

```bash
docker build -t turtle-soup .
docker run -d --name turtle-soup --restart unless-stopped \
  -p 3000:3000 \
  -e OPENAI_BASE_URL=https://api.openai.com/v1 \
  -e OPENAI_API_KEY=你的密钥 \
  -e OPENAI_MODEL=gpt-4o-mini \
  turtle-soup
```

### 直接运行

```bash
npm install --omit=dev
OPENAI_API_KEY=你的密钥 OPENAI_MODEL=gpt-4o-mini npm start
```

建议使用 Nginx/Caddy 反向代理到 `127.0.0.1:3000`，并开启 HTTPS。
