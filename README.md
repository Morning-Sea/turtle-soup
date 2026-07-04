# 夜渡汤馆 · AI 海龟汤

一个面向 1 核 1G 服务器部署的轻量级 AI 海龟汤 Web 游戏。后端使用 Fastify，前端为原生 HTML/CSS/JavaScript，无构建步骤。

## 功能

- OpenAI 兼容 `/chat/completions` API：可配置 `OPENAI_BASE_URL`、`OPENAI_API_KEY`、`OPENAI_MODEL`。
- 首次访问先注册管理员；之后由管理员创建一次性分享链接邀请玩家注册。
- 安全登录：密码使用 Node.js `scrypt` 强哈希与随机盐保存；会话使用高熵随机 token、HttpOnly、SameSite Cookie；登录/注册有基础限速。
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

访问 `http://localhost:3000`。第一次打开页面时先登记管理员，之后在右上角生成请帖链接发给其他玩家。

## 1 核 1G 服务器部署

### Docker

```bash
docker build -t turtle-soup .
docker run -d --name turtle-soup --restart unless-stopped \
  -p 3000:3000 \
  -v turtle-soup-data:/app/data \
  -e NODE_ENV=production \
  -e COOKIE_SECURE=true \
  -e PUBLIC_BASE_URL=https://你的域名 \
  -e OPENAI_BASE_URL=https://api.openai.com/v1 \
  -e OPENAI_API_KEY=你的密钥 \
  -e OPENAI_MODEL=gpt-4o-mini \
  turtle-soup
```

### 直接运行

```bash
npm install --omit=dev
DATA_FILE=./data/store.json OPENAI_API_KEY=你的密钥 OPENAI_MODEL=gpt-4o-mini npm start
```

建议使用 Nginx/Caddy 反向代理到 `127.0.0.1:3000`，并开启 HTTPS。生产环境开启 HTTPS 时请保持 `COOKIE_SECURE=true`，并把 `PUBLIC_BASE_URL` 设置成你的公网 HTTPS 域名，这样生成的请帖链接会直接可用。

## 账号与请帖

- 数据保存在 `DATA_FILE` 指向的 JSON 文件中，默认是 `./data/store.json`。
- 第一个注册用户自动成为管理员。
- 普通用户必须通过管理员生成的邀请链接注册。
- 每个邀请链接仅能成功注册 1 人，默认 7 天过期。
