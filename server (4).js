const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

app.use(express.static(path.join(__dirname, "public")));

// ── In-memory state ──────────────────────────────────────────────
const rooms = {}; // roomCode -> Room

function makeRoom(code, hostId) {
  return {
    code,
    hostId,
    players: {},      // socketId -> Player
    phase: "lobby",   // lobby | night | day | vote | ended
    round: 0,
    votes: {},        // voterId -> targetId
    wolfVotes: {},    // wolfId -> targetId
    seerChecked: false,
    nightKillTarget: null,
    dayKillTarget: null,
    chatHistory: [],
    phaseTimer: null
  };
}

function makePlayer(id, name) {
  return {
    id,
    name,
    role: null,       // villager | wolf | seer
    alive: true,
    ready: false
  };
}

// ── Helpers ──────────────────────────────────────────────────────
function generateCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function getRoomOfSocket(socketId) {
  for (const code in rooms) {
    if (rooms[code].players[socketId]) return rooms[code];
  }
  return null;
}

function alivePlayers(room) {
  return Object.values(room.players).filter(p => p.alive);
}

function aliveWolves(room) {
  return alivePlayers(room).filter(p => p.role === "wolf");
}

function aliveVillagers(room) {
  return alivePlayers(room).filter(p => p.role !== "wolf");
}

function roleLabel(role) {
  return { wolf: "Ma Sói 🐺", villager: "Dân Làng 👨‍🌾", seer: "Tiên Tri 🔮" }[role] || role;
}

function broadcastRoom(room) {
  const playerList = Object.values(room.players).map(p => ({
    id: p.id,
    name: p.name,
    alive: p.alive,
    ready: p.ready,
    isHost: p.id === room.hostId
  }));
  io.to(room.code).emit("room_update", {
    players: playerList,
    phase: room.phase,
    round: room.round,
    hostId: room.hostId
  });
}

function sendChat(room, msg, type = "system") {
  const payload = { text: msg, type, time: new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }) };
  room.chatHistory.push(payload);
  io.to(room.code).emit("chat", payload);
}

function sendWolfChat(room, msg, type = "wolf_system") {
  const payload = { text: msg, type, time: new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }) };
  aliveWolves(room).forEach(w => {
    io.to(w.id).emit("chat", payload);
  });
}

function clearTimer(room) {
  if (room.phaseTimer) {
    clearTimeout(room.phaseTimer);
    room.phaseTimer = null;
  }
}

// ── Win condition ─────────────────────────────────────────────────
function checkWin(room) {
  const wolves = aliveWolves(room);
  const vills = aliveVillagers(room);
  if (wolves.length === 0) return "villager";
  if (wolves.length >= vills.length) return "wolf";
  return null;
}

function endGame(room, winner) {
  clearTimer(room);
  room.phase = "ended";
  const reveal = Object.values(room.players).map(p => ({
    name: p.name,
    role: roleLabel(p.role),
    alive: p.alive
  }));
  io.to(room.code).emit("game_over", { winner, reveal });
  sendChat(room, winner === "wolf" ? "🐺 Ma Sói đã thắng! Làng bị thôn tính!" : "🎉 Dân Làng thắng! Ma Sói đã bị tiêu diệt!", "system");
  broadcastRoom(room);
}

// ── Phase transitions ────────────────────────────────────────────
function startNight(room) {
  clearTimer(room);
  room.phase = "night";
  room.round += 1;
  room.wolfVotes = {};
  room.seerChecked = false;
  room.nightKillTarget = null;
  broadcastRoom(room);
  sendChat(room, `🌙 Đêm ${room.round} bắt đầu. Làng đi ngủ...`, "system");

  // Notify wolves privately
  const wolfNames = aliveWolves(room).map(w => w.name).join(", ");
  aliveWolves(room).forEach(w => {
    const targets = alivePlayers(room).filter(p => p.role !== "wolf").map(p => ({ id: p.id, name: p.name }));
    io.to(w.id).emit("night_wolf_action", { targets, wolfNames });
  });

  // Notify seer
  const seers = alivePlayers(room).filter(p => p.role === "seer");
  seers.forEach(s => {
    const targets = alivePlayers(room).filter(p => p.id !== s.id).map(p => ({ id: p.id, name: p.name }));
    io.to(s.id).emit("night_seer_action", { targets });
  });

  // Auto-advance after 40s if actions incomplete
  room.phaseTimer = setTimeout(() => {
    resolveNight(room);
  }, 40000);
}

function resolveNight(room) {
  clearTimer(room);
  // Tally wolf votes
  const tally = {};
  Object.values(room.wolfVotes).forEach(tid => {
    tally[tid] = (tally[tid] || 0) + 1;
  });
  let killId = null;
  let max = 0;
  for (const [tid, cnt] of Object.entries(tally)) {
    if (cnt > max) { max = cnt; killId = tid; }
  }

  if (killId && room.players[killId]) {
    const victim = room.players[killId];
    victim.alive = false;
    room.nightKillTarget = killId;
    sendChat(room, `☀️ Bình minh ló dạng... ${victim.name} đã bị Ma Sói cắn chết đêm qua!`, "system");
  } else {
    sendChat(room, "☀️ Bình minh ló dạng... Đêm qua không ai bị hại!", "system");
  }

  const win = checkWin(room);
  if (win) { endGame(room, win); return; }
  startDay(room);
}

function startDay(room) {
  clearTimer(room);
  room.phase = "day";
  room.votes = {};
  broadcastRoom(room);
  sendChat(room, "🗣️ Ban ngày - Dân làng hãy thảo luận và bầu chọn người đáng ngờ!", "system");

  room.phaseTimer = setTimeout(() => {
    startVote(room);
  }, 60000);
}

function startVote(room) {
  clearTimer(room);
  room.phase = "vote";
  room.votes = {};
  broadcastRoom(room);
  sendChat(room, "🗳️ Thời gian bỏ phiếu! Hãy chọn người bạn muốn treo cổ (30 giây)!", "system");

  const targets = alivePlayers(room).map(p => ({ id: p.id, name: p.name }));
  io.to(room.code).emit("vote_start", { targets });

  room.phaseTimer = setTimeout(() => {
    resolveVote(room);
  }, 30000);
}

function resolveVote(room) {
  clearTimer(room);
  const tally = {};
  Object.values(room.votes).forEach(tid => {
    tally[tid] = (tally[tid] || 0) + 1;
  });

  let killId = null;
  let max = 0;
  let tie = false;
  for (const [tid, cnt] of Object.entries(tally)) {
    if (cnt > max) { max = cnt; killId = tid; tie = false; }
    else if (cnt === max) { tie = true; }
  }

  if (killId && !tie && room.players[killId]) {
    const victim = room.players[killId];
    victim.alive = false;
    sendChat(room, `⚰️ Dân làng đã quyết định treo cổ ${victim.name} (${roleLabel(victim.role)})!`, "system");
    io.to(room.code).emit("vote_result", { killed: victim.name, role: roleLabel(victim.role) });
  } else {
    sendChat(room, "🤝 Bỏ phiếu hòa! Hôm nay không ai bị treo cổ.", "system");
    io.to(room.code).emit("vote_result", { killed: null });
  }

  const win = checkWin(room);
  if (win) { endGame(room, win); return; }
  startNight(room);
}

// ── Assign roles ─────────────────────────────────────────────────
function assignRoles(room) {
  const players = Object.values(room.players);
  const n = players.length;
  let wolfCount = n <= 6 ? 1 : n <= 9 ? 2 : 3;
  const roles = [];
  for (let i = 0; i < wolfCount; i++) roles.push("wolf");
  roles.push("seer");
  while (roles.length < n) roles.push("villager");
  // Shuffle
  for (let i = roles.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [roles[i], roles[j]] = [roles[j], roles[i]];
  }
  players.forEach((p, i) => {
    p.role = roles[i];
    io.to(p.id).emit("role_assigned", { role: p.role, label: roleLabel(p.role) });
  });
}

// ── Socket.IO events ─────────────────────────────────────────────
io.on("connection", (socket) => {
  console.log("Connected:", socket.id);

  socket.on("create_room", ({ name }) => {
    if (!name || name.trim().length < 1) return;
    const code = generateCode();
    rooms[code] = makeRoom(code, socket.id);
    const player = makePlayer(socket.id, name.trim().substring(0, 20));
    rooms[code].players[socket.id] = player;
    socket.join(code);
    socket.emit("room_created", { code });
    broadcastRoom(rooms[code]);
    sendChat(rooms[code], `${player.name} đã tạo phòng. Chào mừng!`, "system");
  });

  socket.on("join_room", ({ name, code }) => {
    const room = rooms[code?.toUpperCase()];
    if (!room) { socket.emit("error_msg", "Phòng không tồn tại!"); return; }
    if (room.phase !== "lobby") { socket.emit("error_msg", "Trò chơi đã bắt đầu!"); return; }
    if (Object.keys(room.players).length >= 15) { socket.emit("error_msg", "Phòng đã đầy (tối đa 15 người)!"); return; }
    if (!name || name.trim().length < 1) return;

    const player = makePlayer(socket.id, name.trim().substring(0, 20));
    room.players[socket.id] = player;
    socket.join(code.toUpperCase());
    socket.emit("room_joined", { code: code.toUpperCase() });

    // Send chat history
    room.chatHistory.forEach(msg => socket.emit("chat", msg));
    broadcastRoom(room);
    sendChat(room, `${player.name} đã tham gia phòng!`, "system");
  });

  socket.on("start_game", () => {
    const room = getRoomOfSocket(socket.id);
    if (!room || room.hostId !== socket.id) return;
    const n = Object.keys(room.players).length;
    if (n < 4) { socket.emit("error_msg", "Cần ít nhất 4 người để bắt đầu!"); return; }
    assignRoles(room);
    sendChat(room, `🎮 Trò chơi bắt đầu với ${n} người chơi!`, "system");
    setTimeout(() => startNight(room), 3000);
  });

  socket.on("chat_msg", ({ text }) => {
    const room = getRoomOfSocket(socket.id);
    if (!room) return;
    const player = room.players[socket.id];
    if (!player || !player.alive) return;
    // Only allow chat during day phase
    if (room.phase !== "day") {
      // Wolves can chat among themselves at night
      if (room.phase === "night" && player.role === "wolf") {
        const payload = { text: `[Sói] ${player.name}: ${text.substring(0, 200)}`, type: "wolf_chat", time: new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }) };
        aliveWolves(room).forEach(w => io.to(w.id).emit("chat", payload));
        return;
      }
      return;
    }
    sendChat(room, `${player.name}: ${text.substring(0, 200)}`, "player");
  });

  socket.on("wolf_vote", ({ targetId }) => {
    const room = getRoomOfSocket(socket.id);
    if (!room || room.phase !== "night") return;
    const wolf = room.players[socket.id];
    if (!wolf || wolf.role !== "wolf" || !wolf.alive) return;
    if (!room.players[targetId] || !room.players[targetId].alive) return;
    room.wolfVotes[socket.id] = targetId;
    sendWolfChat(room, `🐺 ${wolf.name} chọn cắn ${room.players[targetId].name}`);

    // If all alive wolves have voted, resolve early
    const totalWolves = aliveWolves(room).length;
    if (Object.keys(room.wolfVotes).length >= totalWolves) {
      resolveNight(room);
    }
  });

  socket.on("seer_check", ({ targetId }) => {
    const room = getRoomOfSocket(socket.id);
    if (!room || room.phase !== "night") return;
    const seer = room.players[socket.id];
    if (!seer || seer.role !== "seer" || !seer.alive || room.seerChecked) return;
    const target = room.players[targetId];
    if (!target || !target.alive) return;
    room.seerChecked = true;
    const isWolf = target.role === "wolf";
    socket.emit("seer_result", { name: target.name, isWolf, label: roleLabel(target.role) });
  });

  socket.on("day_vote", ({ targetId }) => {
    const room = getRoomOfSocket(socket.id);
    if (!room || room.phase !== "vote") return;
    const voter = room.players[socket.id];
    if (!voter || !voter.alive) return;
    if (!room.players[targetId] || !room.players[targetId].alive) return;
    if (targetId === socket.id) return; // Can't vote self
    room.votes[socket.id] = targetId;
    sendChat(room, `${voter.name} đã bỏ phiếu`, "vote");

    const aliveCount = alivePlayers(room).length;
    if (Object.keys(room.votes).length >= aliveCount) {
      resolveVote(room);
    }
  });

  socket.on("skip_vote", () => {
    const room = getRoomOfSocket(socket.id);
    if (!room || room.phase !== "vote") return;
    const voter = room.players[socket.id];
    if (!voter || !voter.alive) return;
    // Mark as skipped with null
    room.votes[socket.id] = "__skip__";
    sendChat(room, `${voter.name} đã bỏ qua lượt vote`, "vote");
    const aliveCount = alivePlayers(room).length;
    if (Object.keys(room.votes).length >= aliveCount) {
      resolveVote(room);
    }
  });

  socket.on("skip_to_vote", () => {
    const room = getRoomOfSocket(socket.id);
    if (!room || room.hostId !== socket.id || room.phase !== "day") return;
    clearTimer(room);
    startVote(room);
  });

  socket.on("new_game", () => {
    const room = getRoomOfSocket(socket.id);
    if (!room || room.hostId !== socket.id || room.phase !== "ended") return;
    // Reset players
    Object.values(room.players).forEach(p => {
      p.role = null;
      p.alive = true;
      p.ready = false;
    });
    room.phase = "lobby";
    room.round = 0;
    room.votes = {};
    room.wolfVotes = {};
    room.chatHistory = [];
    room.nightKillTarget = null;
    broadcastRoom(room);
    sendChat(room, "🔄 Phòng đã được reset. Chờ host bắt đầu ván mới!", "system");
  });

  socket.on("disconnect", () => {
    const room = getRoomOfSocket(socket.id);
    if (!room) return;
    const player = room.players[socket.id];
    if (player) {
      sendChat(room, `${player.name} đã rời phòng.`, "system");
      delete room.players[socket.id];
    }

    // If host left, assign new host
    if (room.hostId === socket.id) {
      const remaining = Object.keys(room.players);
      if (remaining.length > 0) {
        room.hostId = remaining[0];
        sendChat(room, `${room.players[room.hostId].name} trở thành host mới.`, "system");
      }
    }

    // Clean empty rooms
    if (Object.keys(room.players).length === 0) {
      clearTimer(room);
      delete rooms[room.code];
      return;
    }

    broadcastRoom(room);

    // Check win condition if game is running
    if (["night", "day", "vote"].includes(room.phase)) {
      const win = checkWin(room);
      if (win) { endGame(room, win); }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🐺 Ma Sói server đang chạy tại http://localhost:${PORT}`));
