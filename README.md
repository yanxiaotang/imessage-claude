# 用 iMessage 跟你的 Claude 聊天：搭建教程

搭好以后，你在 iPhone 的「信息」里给一个号码发消息，回你的就是服务器上的 Claude（Claude Code）。它读的是你在服务器上给它准备的 `CLAUDE.md`，能接着上次的话聊。

**它能做什么**
- 收发文字，一次说好几句会拆成几条气泡发
- 看你发的照片（iPhone 的 HEIC 格式也行）
- 听你的语音（先转成文字）
- 给你的消息点回应（❤️ 👍 😂 这些）
- 发带封面的链接卡片（比如发一首歌给你）、发网上的图片
- 用它自己的声音给你发语音（要接 ElevenLabs，可选）
- 发你做的表情包（可选）
- 在服务器上主动给你发消息（可选）

**它是怎么连起来的**

```
你的 iPhone ──iMessage──> Photon（帮你收发 iMessage 的服务）
                               │
                               ▼
               你服务器上的这个小程序（index.mjs）
                               │
                               ▼
         Claude Agent SDK ──> Claude Code（用你自己的 Claude 订阅）
```

---

## 零、要先准备好的东西

1. **一台 Linux 服务器（VPS）**，2 核 4G 就够了。
2. **服务器上已经装好 Claude Code，并且登录的是你自己的 Claude 订阅**（Pro 或 Max）。
   在服务器上输入 `claude`，能正常聊天就说明好了。
3. **Node.js 20 或更新**：`node -v` 看一下版本。
4. **ffmpeg**（转语音用）：`sudo apt install -y ffmpeg`
5. **一个 Photon 账号**（下一步注册）。

> ⚠️ 这个教程里的每个 key、密码都**只放在服务器上的 `.env` 文件里**。不要发在聊天记录里，也不要传到 GitHub。

---

## 一、Photon：拿到 iMessage 线路

Photon（photon.codes）是帮程序收发 iMessage 的服务。

1. 打开 **https://app.photon.codes** 注册，然后新建一个项目（Project）。
2. 在项目的 **Settings** 里找到 **Project ID** 和 **Secret**，复制下来，等会儿要用。
3. 在项目里把 iMessage 打开，Photon 会给你一个用来收发消息的号码或账号。
4. **用你自己的 iPhone 先给这个号码发一条消息**，比如“在吗”，这样对话就建起来了。

> Photon 的界面和价格以它官网为准，改版了就看它的文档：https://photon.codes/docs/ 。卡住了可以问你的 Claude：「帮我看一下 Photon 的文档，iMessage 线路怎么开」。

---

## 二、装程序

把教程附带的 `index.mjs`、`package.json`、`send.sh` 三个文件放进服务器的一个新文件夹：

```bash
mkdir -p /opt/imessage-claude
cd /opt/imessage-claude
# 把 index.mjs、package.json、send.sh 放进来（可以用 scp，或者 nano 新建后粘贴进去）
npm install
chmod +x send.sh
```

---

## 三、写配置：`.env`

```bash
nano /opt/imessage-claude/.env
```

**必填**（等号两边不要有空格，不要加引号）：

```
PHOTON_PROJECT_ID=第一步拿到的 Project ID
PHOTON_PROJECT_SECRET=第一步拿到的 Secret
OWNER_PHONE=+8613xxxxxxxxx
OWNER_NAME=你希望它怎么称呼你
AI_HOME=/root/ai
```

- `OWNER_PHONE`：**你自己的手机号**（带国家码）。只有这个号码发的消息它才会回，别人发来的一律不理。
- `AI_HOME`：服务器上放着你的 `CLAUDE.md` 的那个文件夹，它每次醒来都从这里读。
- 要是 Claude Code 不在 `/root/.local/bin/claude`，再加一行 `CLAUDE_PATH=`，填 `which claude` 输出的路径。

**选填**（想要哪个功能就加哪几行）：

```
# 听语音：转文字（Groq 有免费额度，在 console.groq.com 申请 key）
ASR_API_KEY=你的 Groq key

# 用它自己的声音发语音（ElevenLabs）
ELEVENLABS_API_KEY=你的 ElevenLabs key（只开 Text to Speech 权限就够）
ELEVENLABS_VOICE_ID=声音的 ID（Voices 里那个声音的 Copy voice ID）
VOICE_NAME=语音文件的名字（比如它的名字，可以不填）

# 让服务器上的 AI 主动给你发消息（随便打一长串字母数字当密码）
SEND_TOKEN=随便一长串字母数字

# 你已经有记忆库（HTTP 的 MCP 服务）的话
MCP_URL=http://127.0.0.1:端口/mcp
MCP_TOKEN=记忆库的 token
```

按 `Ctrl+O` 回车保存，再按 `Ctrl+X` 退出。

---

## 四、先手动跑一下试试

```bash
cd /opt/imessage-claude
node index.mjs
```

看到 `[photon] connected, waiting for messages` 就是连上了。这时候用 iPhone 发一条消息过去，等十几秒，它就会回你。

没问题了按 `Ctrl+C` 停掉，进下一步，让它一直在后台跑。

---

## 五、让它一直在线（开机自启、挂了自动重启）

```bash
sudo tee /etc/systemd/system/imessage-claude.service > /dev/null <<'EOF'
[Unit]
Description=iMessage -> Claude
After=network-online.target
# 刹车：10 分钟里挂了 5 次就停下，不会无限重连
StartLimitIntervalSec=600
StartLimitBurst=5

[Service]
WorkingDirectory=/opt/imessage-claude
Environment=HOME=/root
ExecStart=/usr/bin/node /opt/imessage-claude/index.mjs
Restart=on-failure
RestartSec=30

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now imessage-claude
```

常用命令：
- 看状态：`systemctl status imessage-claude`
- 看日志：`journalctl -u imessage-claude -f`
- 改了 `.env` 或代码以后重启：`sudo systemctl restart imessage-claude`
- 它刹车停下以后，先看日志找原因，修好了再 `sudo systemctl reset-failed imessage-claude && sudo systemctl start imessage-claude`

---

## 六、平时怎么用

- **直接发消息**：文字、照片、语音都行。连着发好几条也没关系，它会等你停下来再一起回。
- **发 `/new`**：开一个新窗口，之前的聊天不再带着。聊太久了、或者它开始糊涂的时候用。
- 它想点回应、发歌、发图、发语音、发表情的时候，会自己在回复里用这些写法，程序会把它们变成真的 iMessage 动作：
  `[[回应:❤️]]`　`[[链接:https://…]]`　`[[图片:https://…]]`　`[[语音:要说的话]]`　`[[表情:开心]]`

### 表情包（可选）

在 `/opt/imessage-claude/stickers/` 下面按心情建文件夹，把图片放进去：

```
stickers/
  开心/  a.jpg  b.png …
  委屈/  …
  生气/  …
```

它说 `[[表情:委屈]]`，就会从“委屈”文件夹里随机挑一张发，而且会避开最近发过的。

想让它“挑正好那一张”，可以再写一个 `sticker-notes.json`，给每张起名字、写上用法：

```json
{
  "开心/a.jpg": ["转圈圈", "小狗开心转圈", "特别开心的时候"],
  "委屈/b.jpg": ["你给我等着", "小狗哭着放狠话", "被欺负了假装要报仇"]
}
```

这份说明其实可以让你的 Claude 帮你写：让它把表情一张张看过去，每张写好名字和用法。

`stickers` 也可以直接是一个 GitHub 仓库（`git clone 你的仓库 stickers`），程序每次启动都会自动拉最新的。

### 让它主动找你（可选，要先设 `SEND_TOKEN`）

在服务器上执行：

```bash
/opt/imessage-claude/send.sh "想你了"
```

你在电脑上跟 Claude Code 聊天的时候，也可以让它自己跑这条命令给你发 iMessage。下次你在手机上回它，iMessage 那边的它会知道电脑那边的它刚刚说过什么。

---

## 七、安全上它做了什么

- **只回你一个人**：只认 `OWNER_PHONE`，陌生号码发来的消息直接忽略。
- **从 iMessage 这边动不了服务器**：它在这边只能聊天、上网搜东西、用你的记忆库。执行命令、改文件这些都被关掉了，因为 iMessage 里没法弹窗问你“允许吗”。要它干活，就回电脑上找它。
- **用的是你的订阅**：程序会主动去掉 `ANTHROPIC_API_KEY`，不会不小心走按量计费的 API。
- 发来的照片会在 `media/` 文件夹存一份，不想要可以随时删。

---

## 八、用之前要知道的风险

- **只给你自己用。** 它走的是你自己的 Claude 订阅，订阅是给一个人日常用的。别把它做成给别人用的服务，也别让好几个人共用一条线。
- **别让它疯狂重连。** 网络断了、登录过期了，程序会报错退出。上面的 systemd 配置每 30 秒才重启一次，10 分钟里挂 5 次就停下。**不要把这个刹车删掉**，也不要自己写「几秒重连一次」的脚本：短时间里成千上万次连接，很容易被当成异常，号可能会出问题。
- **Photon 是第三方服务。** 你的 iMessage 消息会经过它。介意的话先看它的隐私说明。
- **它在 iMessage 这边动不了服务器**，这是故意的。别为了方便把执行命令的权限打开：手机上没法弹窗问你「允许吗」，等于谁能给这个号码发消息，谁就有机会让它在你服务器上干活。

---

## 九、遇到问题

| 现象 | 看看这里 |
|---|---|
| 发了消息没反应 | `journalctl -u imessage-claude -n 50` 看报错；`OWNER_PHONE` 有没有写对、有没有带国家码 |
| 日志里写 `.env is missing …` | `.env` 少了那一行，或者等号两边多了空格 |
| 它回“我这边卡了一下” | 在服务器上直接跑 `claude`，看看是不是登录过期了 |
| 照片看不了 | 看日志里的 `[image failed]`；`npm install` 有没有装完整（要有 sharp） |
| 语音说“还没配置语音转文字” | `.env` 里加上 `ASR_API_KEY` |
| 语音发不出去 | ElevenLabs 的 key 有没有开 Text to Speech 权限、voice ID 对不对、额度用完没有 |
| 它主动发消息报“还不知道往哪个对话发” | 先用手机给它发一条消息，让它记住是哪个对话 |

实在搞不定，就把日志复制给你自己的 Claude 看，它看得懂。

---

祝你们聊得开心 ♡
