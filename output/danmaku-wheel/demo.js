const examples = [
  ["蓝莓汽水", "下午好！"],
  ["小夜", "今天的房间好漂亮"],
  ["云朵邮差", "来听卡塔聊天"],
  ["薄荷糖", "这个背景好清爽"],
  ["柚子冰", "窗边的光好舒服"],
  ["月见茶", "这个气泡好可爱"],
  ["蓝风铃", "下次聊聊最近玩的游戏吧"],
  ["星星罐", "带着耳机来听杂谈啦"],
];

const feed = document.querySelector(".feed");
const controls = document.querySelector(".controls");
const playback = document.querySelector("#playback");
const next = document.querySelector("#next");
const query = new URLSearchParams(location.search);
const motionPreference = matchMedia("(prefers-reduced-motion: reduce)");
const segmenter = new Intl.Segmenter("zh-CN", { granularity: "grapheme" });
const visibleLimit = 4;
let exampleIndex = visibleLimit;
let messageIndex = 0;
let playing = !query.has("paused") && !motionPreference.matches;
let advancing = false;

document.body.classList.toggle("stage-only", query.has("stage"));

function truncate(value, limit) {
  const text = value.trim().replace(/\s+/gu, " ");
  const characters = Array.from(segmenter.segment(text), item => item.segment);
  return characters.length > limit ? characters.slice(0, limit - 1).join("") + "…" : text;
}

function createRow(name, message, slot) {
  const row = document.createElement("li");
  row.className = "message";
  row.dataset.accent = messageIndex++ % 2;
  row.dataset.slot = slot;
  const sender = document.createElement("span");
  sender.className = "nickname";
  sender.textContent = (truncate(name, 10) || "观众") + "：";
  row.append(sender, document.createTextNode(" " + truncate(message, 16)));
  return row;
}

function paintPlaybackLabel() {
  playback.textContent = playing ? "暂停自动播放" : "继续自动播放";
}

async function advance(name, message) {
  if (advancing || !message.trim()) return false;
  advancing = true;
  const oldest = feed.firstElementChild;
  if (feed.children.length === visibleLimit) {
    oldest.dataset.slot = "exit";
    if (!motionPreference.matches) await new Promise(resolve => setTimeout(resolve, 160));
    oldest.remove();
  }

  [...feed.children].forEach((row, index) => { row.dataset.slot = index; });
  const row = createRow(name, message, "enter");
  feed.append(row);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    row.dataset.slot = visibleLimit - 1;
    advancing = false;
  }));
  return true;
}

function advanceExample() {
  if (advancing) return;
  const [name, message] = examples[exampleIndex++ % examples.length];
  void advance(name, message);
}

examples.slice(0, visibleLimit).forEach(([name, message], slot) => {
  feed.append(createRow(name, message, slot));
});
paintPlaybackLabel();

playback.addEventListener("click", () => { playing = !playing; paintPlaybackLabel(); });
next.addEventListener("click", advanceExample);
controls.addEventListener("submit", async event => {
  event.preventDefault();
  const fields = new FormData(controls);
  const accepted = await advance(String(fields.get("sender")), String(fields.get("message")));
  if (accepted) document.querySelector("#message").value = "";
});

setInterval(() => { if (playing && !document.hidden) advanceExample(); }, 2900);
