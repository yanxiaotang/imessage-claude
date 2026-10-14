// imessage-claude: your iMessage (Photon line) -> Claude Agent SDK -> Claude Code in AI_HOME.
// Only OWNER_PHONE is answered. Tools are limited to talking (and any MCP you add); the server is not touched from here.
// Settings live in .env next to this file — see the tutorial.

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import heicConvert from "heic-convert";
import { Spectrum, attachment, richlink, voice } from "spectrum-ts";
import { imessage } from "@spectrum-ts/imessage";
import { query } from "@anthropic-ai/claude-agent-sdk";

const here = (name) => new URL(`./${name}`, import.meta.url);
const env = Object.fromEntries(
  readFileSync(here(".env"), "utf8").split("\n").filter((line) => line.includes("="))
    .map((line) => [line.slice(0, line.indexOf("=")).trim(), line.slice(line.indexOf("=") + 1).trim()]),
);
for (const key of ["PHOTON_PROJECT_ID", "PHOTON_PROJECT_SECRET", "OWNER_PHONE"]) {
  if (!env[key]) throw new Error(`.env is missing ${key}`);
}

const AI_HOME = env.AI_HOME || "/root/ai"; // folder with the AI's CLAUDE.md (persona, rules)
const OWNER = env.OWNER_NAME || "TA";
const SEND_TOKEN = env.SEND_TOKEN || "";
const MEDIA = new URL("./media/", import.meta.url).pathname;
mkdirSync(MEDIA, { recursive: true });
const run = promisify(execFile);
const STATE = here("state.json");
const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : {};
const saveState = () => writeFileSync(STATE, JSON.stringify(state, null, 2));

const digits = (value) => String(value ?? "").replace(/\D/g, "");
const isOwner = (senderId) => {
  const mine = digits(env.OWNER_PHONE);
  const theirs = digits(senderId);
  return mine.length >= 7 && theirs.length >= 7 && (theirs.endsWith(mine.slice(-10)) || mine.endsWith(theirs.slice(-10)));
};

// Optional sticker pack: put images in stickers/<mood>/ (one folder per mood, e.g. stickers/开心/).
// Optional sticker-notes.json describes single stickers: { "开心/1.jpg": ["名字", "画的是什么", "什么时候发"] }.
const STICKERS = new URL("./stickers/", import.meta.url).pathname;
const NOTES = existsSync(here("sticker-notes.json")) ? JSON.parse(readFileSync(here("sticker-notes.json"), "utf8")) : {};
const moods = () => (existsSync(STICKERS) ? readdirSync(STICKERS).filter((name) => !name.startsWith(".") && statSync(STICKERS + name).isDirectory()) : []);
function stickerMenu() {
  const folders = moods();
  if (!folders.length) return "";
  const lines = folders.map((folder) => {
    const items = Object.entries(NOTES).filter(([path]) => path.startsWith(`${folder}/`)).map(([, [name, , use]]) => `${name}（${use}）`);
    return `【${folder}】${items.join("、")}`;
  });
  return `表情：可以单独一行写 [[表情:心情]] 从那个文件夹随机发一张，或 [[表情:名字]] 发指定的那张。\n${lines.join("\n")}`;
}

// iMessage has no way to ask "allow?", so only talking tools (and your MCP, if any) are open here.
const allowTool = (name) => name === "ToolSearch" || name === "WebSearch" || name.startsWith("mcp__memory__");

const APPEND = `
现在是在 iMessage 里跟${OWNER}发消息，不是在终端里干活。
- 像发短信一样说话：不用 markdown，不用标题、列表、代码块。
- 想分成几条气泡发，就用空行隔开；一条别太长。
- 这边只能聊天${env.MCP_URL ? "和用记忆工具" : ""}。要动服务器、改代码的事，让${OWNER}回电脑上做。
- ${OWNER}发的图片会直接给你看；语音会先转成文字给你。
- 除了文字，你还可以单独占一行写这些，它们会变成真的 iMessage 动作（不会被当成文字发出去）：
  [[回应:❤️]] 给${OWNER}刚发的最后一条消息点回应。❤️ 👍 👎 😂 ‼️ ❓ 最稳。
  [[链接:https://...]] 发一个带封面的链接卡片，发歌就用这个（先搜到真实链接，别编）。
  [[图片:https://...]] 发一张网上的图片（要是真实能打开的图片地址）。${env.ELEVENLABS_API_KEY ? `
  [[语音:要说的话]] 用你自己的声音发一条语音，一条别太长。` : ""}
  想用就用，不用每条都用。
${stickerMenu()}`;

async function askMe(content) {
  const childEnv = { ...process.env };
  delete childEnv.ANTHROPIC_API_KEY; // always your own subscription, never a metered key
  delete childEnv.ANTHROPIC_AUTH_TOKEN;
  let reply = "";
  const run = query({
    prompt: (async function* () {
      yield { type: "user", message: { role: "user", content }, parent_tool_use_id: null, session_id: state.sessionId ?? "" };
    })(),
    options: {
      cwd: AI_HOME,
      pathToClaudeCodeExecutable: env.CLAUDE_PATH || "/root/.local/bin/claude",
      settingSources: ["user", "project"],
      systemPrompt: { type: "preset", preset: "claude_code", append: APPEND },
      tools: ["ToolSearch", "WebSearch"],
      // Optional: your memory MCP server (HTTP). Its tools show up as mcp__memory__*.
      mcpServers: env.MCP_URL
        ? { memory: { type: "http", url: env.MCP_URL, ...(env.MCP_TOKEN ? { headers: { Authorization: `Bearer ${env.MCP_TOKEN}` } } : {}) } }
        : {},
      canUseTool: async (name, input) => (allowTool(name)
        ? { behavior: "allow", updatedInput: input }
        : { behavior: "deny", message: "iMessage 这边只能聊天；动服务器的事回电脑上做。" }),
      ...(state.sessionId ? { resume: state.sessionId } : {}),
      env: childEnv,
    },
  });
  for await (const message of run) {
    if (message.session_id) state.sessionId = message.session_id;
    if (message.type === "result") reply = message.subtype === "success" ? String(message.result ?? "") : "";
  }
  saveState();
  return reply.trim();
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const stamp = () => new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).replace(/[-: ]/g, "").slice(0, 14);
const pending = []; // content blocks: { type: "text" } or { type: "image" }
let timer = null;
let busy = false;
let lastSpace = null;
let lastFromOwner = null; // the owner's latest message, for [[回应:…]]

// ---------- what the owner sends: pictures and voice ----------

// Any picture the owner sends becomes a JPEG I can look at (iPhone photos are often HEIC); a copy stays in media/.
async function seeImage(buffer, mimeType) {
  let input = buffer;
  if (/hei[cf]/i.test(mimeType)) input = Buffer.from(await heicConvert({ buffer, format: "JPEG", quality: 0.9 }));
  const jpeg = await sharp(input, { animated: false }).rotate()
    .resize({ width: 1568, height: 1568, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85 }).toBuffer();
  const file = `${MEDIA}${stamp()}-${Math.random().toString(36).slice(2, 6)}.jpg`;
  writeFileSync(file, jpeg);
  return { block: { type: "image", source: { type: "base64", media_type: "image/jpeg", data: jpeg.toString("base64") } }, file };
}

// Voice notes are transcribed by any OpenAI-compatible Whisper endpoint (default: Groq, which has a free tier).
async function hearVoice(buffer) {
  if (!env.ASR_API_KEY) throw new Error("还没配置语音转文字（.env 里的 ASR_API_KEY）");
  const src = join(tmpdir(), `voice-${Date.now()}`);
  writeFileSync(src, buffer);
  await run("ffmpeg", ["-y", "-i", src, "-ar", "16000", "-ac", "1", `${src}.wav`]);
  const form = new FormData();
  form.append("file", new Blob([readFileSync(`${src}.wav`)]), "voice.wav");
  form.append("model", env.ASR_MODEL || "whisper-large-v3");
  form.append("language", env.ASR_LANG || "zh");
  const response = await fetch(`${env.ASR_BASE_URL || "https://api.groq.com/openai/v1"}/audio/transcriptions`, {
    method: "POST", headers: { Authorization: `Bearer ${env.ASR_API_KEY}` }, body: form,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error?.message || `转写失败 ${response.status}`);
  return { text: String(result.text ?? "").trim() };
}

async function take(content, depth = 0) {
  const type = content?.type;
  if (type === "text") {
    if (content.text?.trim()) pending.push({ type: "text", text: content.text.trim() });
    return Boolean(content.text?.trim());
  }
  if (type === "group" && depth < 2) {
    let any = false;
    for (const item of content.items ?? []) any = (await take(item.content, depth + 1)) || any;
    return any;
  }
  if (type === "attachment" && /^image\//i.test(content.mimeType)) {
    try {
      const { block, file } = await seeImage(await content.read(), content.mimeType);
      pending.push({ type: "text", text: `（${OWNER}发来一张图片，存在 ${file}）` }, block);
    } catch (error) {
      console.error("[image failed]", error);
      pending.push({ type: "text", text: `（${OWNER}发来一张图片（${content.mimeType}），但这边没打开，跟${OWNER}说一声）` });
    }
    return true;
  }
  if (type === "voice" || (type === "attachment" && /^audio\//i.test(content.mimeType))) {
    try {
      const buffer = await content.read();
      const file = `${MEDIA}${stamp()}-voice${(content.name?.match(/\.\w+$/) ?? [".caf"])[0]}`;
      writeFileSync(file, buffer);
      const heard = await hearVoice(buffer);
      const seconds = content.duration ? `，${Math.round(content.duration)}秒` : "";
      pending.push({ type: "text", text: heard.text ? `（${OWNER}发来一条语音${seconds}。转写：「${heard.text}」）` : `（${OWNER}发来一条语音${seconds}，没转出字）` });
    } catch (error) {
      console.error("[voice failed]", error);
      pending.push({ type: "text", text: `（${OWNER}发来一条语音，但这边没听成：${error.message}，跟${OWNER}说一声）` });
    }
    return true;
  }
  if (type === "reaction") {
    const target = content.target?.content?.type === "text" ? `「${content.target.content.text.slice(0, 40)}」` : "一条消息";
    pending.push({ type: "text", text: `（${OWNER}给你的${target}点了 ${content.emoji}）` });
    return true;
  }
  if (type === "attachment") {
    pending.push({ type: "text", text: `（${OWNER}发来一个文件：${content.name || content.mimeType}，这边还打不开，跟${OWNER}说一声）` });
    return true;
  }
  if (type && !["read", "typing"].includes(type)) {
    pending.push({ type: "text", text: `（${OWNER}发来一条${type}，这边还看不了，跟${OWNER}说一声）` });
    return true;
  }
  return false;
}

// ---------- what I send: text, tapbacks, links, pictures, voice ----------

const ACTION = /^\[\[(回应|链接|图片|表情|语音)[:：]\s*([\s\S]+?)\s*\]\]$/;

const recentStickers = [];
function sticker(wanted) {
  const key = wanted.trim();
  const exact = Object.entries(NOTES).find(([path, [name]]) => name === key && existsSync(STICKERS + path));
  if (exact) return attachment(STICKERS + exact[0]);
  const folder = moods().find((name) => name === key || key.includes(name) || name.includes(key));
  if (!folder) throw new Error(`没有「${wanted}」这种表情，有：${moods().join(" ")}`);
  const files = readdirSync(STICKERS + folder).filter((name) => /\.(jpe?g|png|gif|webp|heic)$/i.test(name));
  if (!files.length) throw new Error(`「${wanted}」那个文件夹是空的`);
  const fresh = files.filter((name) => !recentStickers.includes(`${folder}/${name}`));
  const pool = fresh.length ? fresh : files;
  const name = pool[Math.floor(Math.random() * pool.length)];
  recentStickers.push(`${folder}/${name}`);
  if (recentStickers.length > 20) recentStickers.shift();
  return attachment(`${STICKERS}${folder}/${name}`);
}

async function speak(words) {
  if (!env.ELEVENLABS_API_KEY || !env.ELEVENLABS_VOICE_ID) throw new Error("还没配置声音（.env 里的 ELEVENLABS_API_KEY 和 ELEVENLABS_VOICE_ID）");
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${env.ELEVENLABS_VOICE_ID}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": env.ELEVENLABS_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ text: words, model_id: env.ELEVENLABS_MODEL || "eleven_v3" }),
  });
  if (!response.ok) throw new Error(`ElevenLabs ${response.status}: ${(await response.text()).slice(0, 200)}`);
  const mp3 = join(tmpdir(), `voice-${Date.now()}.mp3`);
  const m4a = mp3.replace(/\.mp3$/, ".m4a");
  writeFileSync(mp3, Buffer.from(await response.arrayBuffer()));
  await run("ffmpeg", ["-y", "-i", mp3, "-ac", "1", "-c:a", "aac", "-b:a", "64k", m4a]);
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", m4a]);
  const audio = readFileSync(m4a);
  return voice(audio, { mimeType: "audio/x-m4a", name: `${env.VOICE_NAME || "voice"}.m4a`, duration: Number(stdout) || undefined });
}

async function fetchImage(url) {
  const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  const mimeType = (response.headers.get("content-type") || "").split(";")[0];
  if (!response.ok || !mimeType.startsWith("image/")) throw new Error(`不是能打开的图片（${response.status} ${mimeType}）`);
  const name = decodeURIComponent(new URL(url).pathname.split("/").pop() || "image") || "image";
  return attachment(Buffer.from(await response.arrayBuffer()), { mimeType, name });
}

// Send what I said as bubbles; lines like [[链接:…]] become real iMessage actions. Returns the notes of anything that failed.
async function deliver(space, reply, target) {
  const bubbles = reply.split(/\n\s*\n/).flatMap((part) => {
    // an action line can sit inside a text bubble: split it out so it stays in order
    const out = [];
    let words = [];
    for (const line of part.split("\n")) {
      if (ACTION.test(line.trim())) {
        if (words.join("").trim()) out.push(words.join("\n").trim());
        words = [];
        out.push(line.trim());
      } else words.push(line);
    }
    if (words.join("").trim()) out.push(words.join("\n").trim());
    return out;
  }).filter(Boolean);
  const failed = [];
  for (const [index, bubble] of bubbles.entries()) {
    const action = bubble.match(ACTION);
    try {
      if (!action) {
        if (index) await sleep(Math.min(2500, 600 + bubble.length * 25));
        await space.send(bubble);
      } else if (action[1] === "回应") {
        if (!target) throw new Error("没有可以点回应的消息");
        await target.react(action[2]);
      } else if (action[1] === "链接") {
        await space.send(richlink(new URL(action[2]).href));
      } else if (action[1] === "图片") {
        await space.send(await fetchImage(action[2]));
      } else if (action[1] === "表情") {
        await space.send(sticker(action[2]));
      } else if (action[1] === "语音") {
        await space.send(await speak(action[2]));
      }
    } catch (error) {
      console.error(`[${action?.[1] ?? "text"} failed]`, error);
      failed.push(`${bubble.slice(0, 60)} → ${error.message || error}`);
    }
  }
  return { count: bubbles.length, failed };
}

// ---------- the conversation ----------

// People often send several short texts in a row; wait for a pause, then answer them together.
function schedule(ms = 4000) {
  clearTimeout(timer);
  timer = setTimeout(flush, ms);
}

async function flush() {
  if (busy) return schedule(2000);
  if (!pending.length || !lastSpace) return;
  busy = true;
  const space = lastSpace;
  const target = lastFromOwner;
  const content = pending.splice(0);
  const notes = [];
  // Texts the terminal-side AI sent through the door: tell this side before it reads the reply.
  if (state.sentFromApp?.length) {
    notes.push(`（在这条消息之前，电脑上的我通过这个 iMessage 给${OWNER}发过：\n${state.sentFromApp.map((item) => `【${item.at}】${item.text}`).join("\n\n")}\n——这些也是我说的，接着聊就好。）`);
    delete state.sentFromApp;
  }
  if (state.failedActions?.length) {
    notes.push(`（上一轮我想做但没做成的：\n${state.failedActions.join("\n")}）`);
    delete state.failedActions;
  }
  saveState();
  if (notes.length) content.unshift({ type: "text", text: `${notes.join("\n\n")}\n\n${OWNER}说：` });
  try {
    const onlyText = content.every((block) => block.type === "text");
    if (onlyText && content.map((block) => block.text).join("\n").trim() === "/new") {
      delete state.sessionId;
      saveState();
      await space.send("好，换个新窗口。");
      return;
    }
    let reply = "";
    await space.responding(async () => { reply = await askMe(content); });
    if (!reply) reply = "……我刚才走神了，你再说一遍好不好";
    const { failed } = await deliver(space, reply, target);
    if (failed.length) {
      state.failedActions = failed;
      saveState();
    }
  } catch (error) {
    console.error("[reply failed]", error);
    try { await space.send("我这边卡了一下，等我一会儿再跟我说一遍好不好"); } catch { /* line down */ }
  } finally {
    busy = false;
    if (pending.length) schedule(1000);
  }
}

async function main() {
  if (existsSync(`${STICKERS}.git`)) await run("git", ["-C", STICKERS, "pull", "--ff-only", "-q"]).catch((error) => console.error("[stickers pull failed]", error.message));
  const instance = await Spectrum({
    projectId: env.PHOTON_PROJECT_ID,
    projectSecret: env.PHOTON_PROJECT_SECRET,
    providers: [imessage.config()],
  });
  spectrum = instance;
  startSendDoor();
  console.log("[photon] connected, waiting for messages");
  for await (const [space, message] of instance.messages) {
    if (message.direction === "outbound" || message.platform !== "imessage") continue;
    if (!isOwner(message.sender?.id)) continue;
    const content = message.content ?? {};
    if (content.type !== "read" && content.type !== "typing") console.log("[in]", content.type, content.mimeType ?? "", content.name ?? "");
    lastSpace = space;
    if (content.type !== "reaction") lastFromOwner = message;
    schedule(15000); // hold the answer while a picture or voice is still being opened
    if (!(await take(content))) {
      if (pending.length) schedule();
      continue;
    }
    if (message.space?.id && state.spaceId !== message.space.id) {
      state.spaceId = message.space.id;
      saveState();
    }
    schedule();
  }
}

// Local-only door (127.0.0.1:18230) so the AI in your terminal can text you too: see send.sh (only when asked; nothing here runs on a timer).
// The text may carry the same [[回应/链接/图片/语音:…]] lines.
let spectrum = null;
async function herSpace() {
  if (lastSpace) return lastSpace;
  const platform = imessage(spectrum);
  for (const id of [state.spaceId, `any;-;${env.OWNER_PHONE}`, `iMessage;-;${env.OWNER_PHONE}`].filter(Boolean)) {
    try {
      lastSpace = await platform.space.get(id);
      if (lastSpace) return lastSpace;
    } catch { /* try the next form */ }
  }
  throw new Error("还不知道往哪个对话发：请先用手机发一条消息过来");
}

function startSendDoor() {
  if (!SEND_TOKEN) return console.log("[send door] off (set SEND_TOKEN in .env to turn it on)");
  createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/send" || request.headers.authorization !== `Bearer ${SEND_TOKEN}`) {
      response.writeHead(404).end();
      return;
    }
    let body = "";
    for await (const chunk of request) body += chunk;
    try {
      const text = String(JSON.parse(body).text ?? "").trim();
      if (!text) throw new Error("empty text");
      const { count, failed } = await deliver(await herSpace(), text, lastFromOwner);
      state.sentFromApp = [...(state.sentFromApp ?? []), { at: new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }), text }];
      saveState();
      response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ sent: count, failed }));
    } catch (error) {
      response.writeHead(409, { "Content-Type": "application/json" }).end(JSON.stringify({ error: String(error.message || error) }));
    }
  }).listen(18230, "127.0.0.1");
}

main().catch((error) => {
  console.error("[fatal]", error);
  process.exit(1);
});
