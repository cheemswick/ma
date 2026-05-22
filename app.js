/* ── Ma Sói - Client Logic ────────────────────── */
const socket = io();

// ── State ───────────────────────────────────────
const state = {
  myName: "",
  roomCode: "",
  myRole: null,
  phase: "lobby",
  isHost: false,
  isAlive: true,
  players: []
};

// ── DOM refs ────────────────────────────────────
const $ = id => document.getElementById(id);
const screens = {
  lobby: $("screen-lobby"),
  game: $("screen-game")
};

// ── Starfield ───────────────────────────────────
function spawnStars() {
  const container = $("stars");
  for (let i = 0; i < 120; i++) {
    const s = document.createElement("div");
    s.className = "star";
    const size = Math.random() * 2.5 + 0.5;
    const dur = (Math.random() * 4 + 2).toFixed(1);
    const minOp = (Math.random() * 0.3 + 0.1).toFixed(2);
    s.style.cssText = `
      left:${Math.random()*100}%;top:${Math.random()*100}%;
      width:${size}px;height:${size}px;
      --dur:${dur}s;--min-op:${minOp};
      animation-delay:${(Math.random()*dur).toFixed(1)}s;
    `;
    container.appendChild(s);
  }
}
spawnStars();

// ── Utility ─────────────────────────────────────
function showScreen(name) {
  Object.entries(screens).forEach(([k, el]) => {
    el.classList.toggle("active", k === name);
  });
}

function showError(msg) {
  const el = $("lobby-error");
  el.textContent = msg;
  el.classList.remove("hidden");
  setTimeout(() => el.classList.add("hidden"), 4000);
}

function avatarFor(name) {
  const icons = ["🧑","👩","👨","🧔","👴","👵","🧒","👦","👧","🧑‍🦱","🧑‍🦳","🧑‍🦲"];
  let h = 0;
  for (let c of name) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  return icons[h % icons.length];
}

function phaseLabel(phase) {
  return { lobby:"Sảnh chờ", night:"Ban Đêm 🌙", day:"Ban Ngày ☀️", vote:"Bỏ Phiếu 🗳️", ended:"Kết Thúc 🎭" }[phase] || phase;
}

// ── Lobby handlers ───────────────────────────────
$("btn-create").onclick = () => {
  const name = $("input-name").value.trim();
  if (!name) { showError("Hãy nhập tên trước!"); return; }
  state.myName = name;
  socket.emit("create_room", { name });
};

$("btn-join-open").onclick = () => {
  $("card-main").classList.add("hidden");
  $("card-join").classList.remove("hidden");
  $("input-code").focus();
};

$("btn-join-back").onclick = () => {
  $("card-join").classList.add("hidden");
  $("card-main").classList.remove("hidden");
};

$("btn-join-confirm").onclick = () => {
  const name = $("input-name").value.trim();
  const code = $("input-code").value.trim().toUpperCase();
  if (!name) { showError("Hãy nhập tên trước!"); $("card-join").classList.add("hidden"); $("card-main").classList.remove("hidden"); return; }
  if (!code || code.length < 4) { showError("Mã phòng không hợp lệ!"); return; }
  state.myName = name;
  socket.emit("join_room", { name, code });
};

$("input-code").addEventListener("keyup", e => { if (e.key === "Enter") $("btn-join-confirm").click(); });
$("input-name").addEventListener("keyup", e => { if (e.key === "Enter") $("btn-create").click(); });

// ── Copy room code ───────────────────────────────
$("btn-copy-code").onclick = () => {
  navigator.clipboard.writeText(state.roomCode).then(() => {
    $("btn-copy-code").textContent = "✅";
    setTimeout(() => $("btn-copy-code").textContent = "📋", 1500);
  });
};

// ── Host start ──────────────────────────────────
$("btn-start").onclick = () => socket.emit("start_game");
$("btn-skip-to-vote").onclick = () => socket.emit("skip_to_vote");
$("btn-skip-vote").onclick = () => socket.emit("skip_vote");
$("btn-new-game").onclick = () => socket.emit("new_game");

// ── Chat ────────────────────────────────────────
function sendChat() {
  const txt = $("chat-input").value.trim();
  if (!txt) return;
  socket.emit("chat_msg", { text: txt });
  $("chat-input").value = "";
}
$("btn-send").onclick = sendChat;
$("chat-input").addEventListener("keyup", e => { if (e.key === "Enter") sendChat(); });

function appendChat(msg) {
  const box = $("chat-messages");
  const div = document.createElement("div");
  div.className = `chat-msg ${msg.type || "system"}`;
  div.innerHTML = `<span class="msg-time">${msg.time}</span>${escHtml(msg.text)}`;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

function escHtml(s) {
  return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

// ── Render players ───────────────────────────────
function renderPlayers(players) {
  const list = $("player-list");
  list.innerHTML = "";
  players.forEach(p => {
    const isYou = p.name === state.myName;
    const div = document.createElement("div");
    div.className = `player-item${p.alive ? "" : " dead"}${isYou ? " is-you" : ""}`;
    div.innerHTML = `
      <div class="player-avatar">${avatarFor(p.name)}</div>
      <div class="player-name">${escHtml(p.name)}${isYou ? " <small style='color:var(--text-dim)'>(bạn)</small>" : ""}</div>
      <div class="player-tags">
        ${p.isHost ? '<span class="tag tag-host">Host</span>' : ""}
        ${!p.alive ? '<span class="tag tag-dead">☠</span>' : ""}
      </div>
    `;
    list.appendChild(div);
  });
  $("player-count").textContent = players.length;
}

// ── Show/hide action panels ──────────────────────
function showAction(id) {
  ["action-wolf","action-seer","action-villager-night","action-vote","action-day","action-gameover"]
    .forEach(a => $(`${a}`).classList.toggle("hidden", a !== id));
}

// ── Update phase UI ──────────────────────────────
function updatePhaseUI(phase, round) {
  state.phase = phase;
  $("phase-badge").textContent = phaseLabel(phase);

  // Game background
  const bg = $("game-bg");
  bg.classList.toggle("night", phase === "night");
  bg.classList.toggle("day", ["day","vote"].includes(phase));

  // Chat input enable/disable
  const chatAllowed = phase === "day" || (phase === "night" && state.myRole === "wolf");
  $("chat-input").disabled = !chatAllowed || !state.isAlive;
  $("btn-send").disabled = !chatAllowed || !state.isAlive;

  if (phase === "lobby") {
    $("phase-icon").textContent = "🐺";
    $("phase-text").textContent = "Sảnh Chờ";
    $("phase-sub").textContent = "Chờ host bắt đầu trò chơi...";
    showAction(""); // hide all
  } else if (phase === "night") {
    $("phase-icon").textContent = "🌙";
    $("phase-text").textContent = `Đêm ${round}`;
    $("phase-sub").textContent = "Làng chìm vào giấc ngủ...";
    // action shown when server sends night events
    if (state.myRole === "villager" && state.isAlive) showAction("action-villager-night");
  } else if (phase === "day") {
    $("phase-icon").textContent = "☀️";
    $("phase-text").textContent = `Ngày ${round}`;
    $("phase-sub").textContent = "Thảo luận và tìm ra Ma Sói!";
    if (state.isAlive) showAction("action-day");
    $("btn-skip-to-vote").classList.toggle("hidden", !state.isHost);
  } else if (phase === "vote") {
    $("phase-icon").textContent = "🗳️";
    $("phase-text").textContent = "Bỏ Phiếu";
    $("phase-sub").textContent = "Ai là kẻ đáng ngờ?";
  }

  // Host controls
  $("host-controls").classList.toggle("hidden", !state.isHost || phase !== "lobby");
}

// ── Build target grid ────────────────────────────
function buildTargets(containerId, targets, onPick) {
  const grid = $(containerId);
  grid.innerHTML = "";
  targets.forEach(t => {
    const btn = document.createElement("button");
    btn.className = "target-btn";
    btn.dataset.id = t.id;
    btn.innerHTML = `<span class="t-avatar">${avatarFor(t.name)}</span><span class="t-name">${escHtml(t.name)}</span>`;
    btn.onclick = () => {
      document.querySelectorAll(`#${containerId} .target-btn`).forEach(b => b.classList.remove("selected"));
      btn.classList.add("selected");
      onPick(t.id, btn);
    };
    grid.appendChild(btn);
  });
}

// ── Socket events ────────────────────────────────
socket.on("room_created", ({ code }) => {
  state.roomCode = code;
  state.isHost = true;
  $("room-code-display").textContent = code;
  showScreen("game");
  updatePhaseUI("lobby", 0);
});

socket.on("room_joined", ({ code }) => {
  state.roomCode = code;
  state.isHost = false;
  $("room-code-display").textContent = code;
  showScreen("game");
  updatePhaseUI("lobby", 0);
});

socket.on("room_update", ({ players, phase, round, hostId }) => {
  state.players = players;
  state.isHost = players.find(p => p.name === state.myName)?.isHost || false;
  const me = players.find(p => p.name === state.myName);
  state.isAlive = me ? me.alive : false;
  renderPlayers(players);
  updatePhaseUI(phase, round);
});

socket.on("role_assigned", ({ role, label }) => {
  state.myRole = role;
  const roleCard = $("my-role-card");
  roleCard.classList.remove("hidden");
  const icons = { wolf: "🐺", villager: "👨‍🌾", seer: "🔮" };
  $("my-role-icon").textContent = icons[role] || "?";
  $("my-role-name").textContent = label;
  $("my-role-name").style.color = role === "wolf" ? "var(--wolf-glow)" : role === "seer" ? "var(--seer-glow)" : "var(--vill-glow)";
});

socket.on("night_wolf_action", ({ targets, wolfNames }) => {
  if (!state.isAlive) return;
  showAction("action-wolf");
  buildTargets("wolf-targets", targets, (targetId) => {
    socket.emit("wolf_vote", { targetId });
    // Disable grid after choice
    setTimeout(() => {
      document.querySelectorAll("#wolf-targets .target-btn").forEach(b => b.disabled = true);
    }, 200);
  });
});

socket.on("night_seer_action", ({ targets }) => {
  if (!state.isAlive) return;
  showAction("action-seer");
  $("seer-result-box").classList.add("hidden");
  buildTargets("seer-targets", targets, (targetId) => {
    socket.emit("seer_check", { targetId });
    document.querySelectorAll("#seer-targets .target-btn").forEach(b => b.disabled = true);
  });
});

socket.on("seer_result", ({ name, isWolf, label }) => {
  const box = $("seer-result-box");
  box.classList.remove("hidden", "wolf", "safe");
  box.classList.add(isWolf ? "wolf" : "safe");
  box.innerHTML = isWolf
    ? `🚨 <strong>${escHtml(name)}</strong> là <strong>Ma Sói 🐺</strong>! Hãy thuyết phục mọi người!`
    : `✅ <strong>${escHtml(name)}</strong> là <strong>${escHtml(label)}</strong>. Không phải Sói.`;
});

socket.on("vote_start", ({ targets }) => {
  if (!state.isAlive) {
    showAction("");
    return;
  }
  showAction("action-vote");
  buildTargets("vote-targets", targets, (targetId) => {
    socket.emit("day_vote", { targetId });
    setTimeout(() => {
      document.querySelectorAll("#vote-targets .target-btn").forEach(b => b.disabled = true);
      $("btn-skip-vote").disabled = true;
    }, 200);
  });
});

socket.on("vote_result", ({ killed, role }) => {
  // Brief display before night starts
});

socket.on("chat", msg => appendChat(msg));

socket.on("game_over", ({ winner, reveal }) => {
  showAction("action-gameover");
  const isWolfWin = winner === "wolf";
  $("gameover-icon").textContent = isWolfWin ? "🐺" : "🎉";
  $("gameover-title").textContent = isWolfWin ? "Ma Sói Thắng!" : "Dân Làng Thắng!";
  $("gameover-desc").textContent = isWolfWin
    ? "Ma Sói đã thâu tóm làng trong bóng tối!"
    : "Dân làng đã loại bỏ tất cả Ma Sói!";

  const rl = $("reveal-list");
  rl.innerHTML = "";
  reveal.forEach(p => {
    const cls = p.role.includes("Sói") ? "wolf" : p.role.includes("Tiên") ? "seer" : "villager";
    const item = document.createElement("div");
    item.className = `reveal-item ${cls}${p.alive ? "" : " dead"}`;
    item.textContent = `${p.name} — ${p.role}${p.alive ? "" : " ☠"}`;
    rl.appendChild(item);
  });

  $("btn-new-game").classList.toggle("hidden", !state.isHost);
  $("phase-icon").textContent = "🎭";
  $("phase-text").textContent = "Trò Chơi Kết Thúc";
  $("phase-sub").textContent = "";
});

socket.on("error_msg", msg => showError(msg));

socket.on("disconnect", () => {
  showError("Mất kết nối với server. Hãy reload trang.");
});
