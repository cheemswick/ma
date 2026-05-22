# 🐺 Ma Sói - Werewolf Multiplayer Game

Game Ma Sói realtime cho nhóm bạn 4–15 người, chạy trên Node.js + Socket.IO.

## Cấu trúc thư mục

```
masoi/
├── package.json
├── server.js          ← Backend: game logic + Socket.IO
└── public/
    ├── index.html     ← Giao diện HTML
    ├── style.css      ← Styles (Gothic dark theme)
    └── app.js         ← Client-side logic
```

## Chạy local

```bash
# 1. Cài dependencies
npm install

# 2. Khởi động server
npm start

# 3. Mở trình duyệt
# http://localhost:3000
```

Dùng `npm run dev` để có hot-reload (nodemon).

## Deploy lên Render (miễn phí)

1. Push code lên GitHub
2. Vào https://render.com → New → Web Service
3. Kết nối repo GitHub
4. Cấu hình:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Environment:** Node
5. Deploy → Lấy URL chia sẻ với bạn bè

## Luật chơi

| Vai trò | Số lượng | Khả năng |
|---------|---------|---------|
| 🐺 Ma Sói | 1–3 (tùy số người) | Chọn cắn 1 dân làng mỗi đêm |
| 🔮 Tiên Tri | 1 | Soi bói 1 người mỗi đêm |
| 👨‍🌾 Dân Làng | Còn lại | Thảo luận & vote ban ngày |

**Điều kiện thắng:**
- 🐺 Sói thắng khi số Sói ≥ số Dân còn lại
- 👨‍🌾 Dân thắng khi tiêu diệt hết Sói

**Vòng chơi:** Đêm (40s) → Ngày (60s) → Vote (30s) → lặp lại

## Ghi chú

- Không cần database, không cần đăng nhập
- Phòng tự xóa khi hết người
- Tối ưu 5–15 người chơi
