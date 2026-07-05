# 夜渡汤馆 · AI 海龟汤

一个面向 1 核 1G 服务器部署的轻量级 AI 海龟汤 Web 游戏。后端使用 Fastify，前端为原生 HTML/CSS/JavaScript，无构建步骤。

## 功能

- OpenAI 兼容 `/chat/completions` API：可配置 `OPENAI_BASE_URL`、`OPENAI_API_KEY`、`OPENAI_MODEL`、`OPENAI_REASONING_EFFORT`、`OPENAI_MAX_TOKENS`。
- 首次访问先注册管理员；之后由管理员创建一次性分享链接邀请玩家注册。
- 安全登录：密码使用 Node.js `scrypt` 强哈希与随机盐保存；会话使用高熵随机 token、HttpOnly、SameSite Cookie；登录/注册有基础限速。
- AI 生成原创题面、谜底和边界规则；生成后可保存为私有汤，或公开上传到社区。
- 用户可自建海龟汤，保存为私有汤，或公开到社区供其他人选择游玩；自己上传到社区的海龟汤可删除。
- 可从社区汤谱选择已有海龟汤，也可使用 AI / 本地题库即时开局。
- 支持单人游玩与多人邀请房间；多人模式按座次轮流向 AI 提问，轮到自己时可以追问或弃权。
- 管理员可在用户管理页查看所有用户，以及每位用户提交到社区的海龟汤记录。
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
  -e OPENAI_REASONING_EFFORT=medium \
  -e OPENAI_MAX_TOKENS=1200 \
  turtle-soup
```

### 直接运行

```bash
npm install --omit=dev
DATA_FILE=./data/store.json OPENAI_API_KEY=你的密钥 OPENAI_MODEL=gpt-4o-mini npm start
```

建议使用 Nginx/Caddy 反向代理到 `127.0.0.1:3000`，并开启 HTTPS。生产环境开启 HTTPS 时请保持 `COOKIE_SECURE=true`，并把 `PUBLIC_BASE_URL` 设置成你的公网 HTTPS 域名，这样生成的请帖链接会直接可用。

### AI 参数

- `OPENAI_BASE_URL`：OpenAI 兼容接口地址，默认 `https://api.openai.com/v1`。
- `OPENAI_API_KEY`：模型密钥；未配置时会使用内置本地题库。
- `OPENAI_MODEL`：模型名称，默认 `gpt-4o-mini`。
- `OPENAI_REASONING_EFFORT`：传给兼容接口的 `reasoning_effort`，可作为支持推理模型的思考预算/推理强度控制参数；留空则不发送。
- `OPENAI_MAX_TOKENS`：传给兼容接口的 `max_completion_tokens`，用于限制单次生成的最大输出 token；小于等于 0 时不发送。

## 账号与请帖

- 数据保存在 `DATA_FILE` 指向的 JSON 文件中，默认是 `./data/store.json`。
- 第一个注册用户自动成为管理员。
- 普通用户必须通过管理员生成的邀请链接注册。
- 每个邀请链接仅能成功注册 1 人，默认 7 天过期。


## 玩法流程

1. 入席后先在“选择或创建一锅汤”区域决定汤的来源：
   - 使用 AI / 本地题库开一锅新汤；
   - 自行填写题名、汤面、汤底和边界规则，并选择私有或公开到社区；
   - 从社区汤谱选择别人公开的海龟汤，或自己保存过的私有汤。
2. 选定汤后，进入模式选择：
   - 单人游玩：自己与 AI 主持人进行追问；
   - 邀请多人游玩：系统生成房间链接，复制给已注册玩家加入。
3. 多人游玩时，系统显示座次，并只允许当前轮到的玩家提问或弃权；一次行动后自动切到下一位玩家。

## Ubuntu 服务器

可以在 Linux Ubuntu 服务器上运行。建议安装 Node.js 20 或更新版本，然后按“本地运行”或 Docker 部署方式启动。生产环境建议使用 Nginx/Caddy 反向代理到 `127.0.0.1:3000`，开启 HTTPS，并设置 `PUBLIC_BASE_URL`、`COOKIE_SECURE=true` 和持久化的 `DATA_FILE` / Docker volume。
