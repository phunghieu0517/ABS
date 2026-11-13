# ☕ Cà phê ABS

Quán cà phê chứng khoán phong cách isometric, tông tím đen. Ai có đường link đều vào được, không cần tài khoản.

- Gõ mã vào ô **Order**: bạn xếp hàng trước quầy. Tới lượt thì nhân viên pha, ly cà phê của mã đó mới xuất hiện để bạn bưng đi.
- Ly càng to thì vốn hóa càng lớn. Màu ly theo bảng giá: xanh là tăng, vàng là tham chiếu, đỏ là giảm, tím là trần, xanh lam là sàn.
- **Ấn liên tiếp 3 lần** vào ly hoặc vào mã để xem TC, Trần, Sàn.
- Có 30 ghế. Mỗi người tự chọn biểu cảm: nhảy múa, buồn, vui, vẫy tay, giận.
- Bảng hiệu trên tường hiện 10 mã sôi động nhất.
- **Tối đa 30 khách cùng lúc.** Người đến sau chờ ngoài cửa, có chỗ trống thì tự được mời vào.
- Giá lấy mỗi phút ở máy chủ rồi đẩy cùng lúc cho mọi khách, nên ai cũng thấy cùng một giá.

## Chạy thử trên máy

Cần Node.js 18 trở lên. Không cần cài thêm thư viện.

```bash
node server.js
# mở http://localhost:3000
```

Mặc định máy chủ dùng **giá mô phỏng** (khoảng 200 mã) để bạn chạy thử ngay.

## Nối giá thật từ ABS

> ⚠️ Trước khi đưa lên trang công khai, hãy chắc chắn bạn được ABS cho phép dùng và hiển thị lại dữ liệu bảng giá. Dữ liệu giá của các sở giao dịch thường chỉ được phân phối lại khi có thỏa thuận.

1. Mở https://invest.abs.vn/priceboard bằng Chrome, nhấn **F12**, chọn tab **Network**, lọc **Fetch/XHR**, rồi tải lại trang.
2. Tìm yêu cầu trả về danh sách mã kèm giá. Bấm vào để xem tab Response: nội dung có các mã như VCB, HPG kèm giá.
3. Chuột phải vào yêu cầu đó → **Copy → Copy URL**. Nếu yêu cầu cần đăng nhập hay header riêng, chọn **Copy as cURL**.
4. Chạy máy chủ:

```bash
PRICE_SOURCE=abs ABS_URL="<địa chỉ vừa copy>" node server.js
```

5. Mở `http://localhost:3000/api/health`. Nếu `stocks` lớn hơn 0 và `lastError` trống là đã lấy được giá. Ô góc trên của trang sẽ đổi thành **● Giá ABS · cập nhật hh:mm**.

`sources/abs.js` tự nhận các tên trường phổ biến (symbol, refPrice, ceiling, floor, matchPrice…) và tự đổi giá từ nghìn đồng ra đồng. Nếu ABS dùng tên trường khác, hoặc chỉ đẩy giá qua WebSocket, cần sửa file này. Bạn có thể gửi mẫu dữ liệu (tab Response) để được sửa giúp.

## Đưa lên mạng

Trang cần một máy chủ Node.js chạy liên tục có hỗ trợ WebSocket, ví dụ Render, Railway, Fly.io hoặc một VPS. Dịch vụ chỉ phục vụ trang tĩnh (GitHub Pages, Netlify) không chạy được.

**Render (có gói miễn phí):**
1. Đưa thư mục này lên một repo GitHub.
2. Trên Render chọn **New → Web Service**, rồi chọn repo.
3. Build command để trống, Start command: `node server.js`.
4. Thêm biến môi trường `PRICE_SOURCE=abs` và `ABS_URL=...` (tham khảo `.env.example`).
5. Gói miễn phí của Render cho máy chủ ngủ khi không có người vào. Khách đầu tiên phải chờ khoảng 30–60 giây để máy chủ thức dậy.

**VPS (Ubuntu):**
```bash
# cài Node 20 trở lên, chép thư mục lên máy rồi chạy:
PRICE_SOURCE=abs ABS_URL="..." PORT=3000 node server.js
# nên dùng pm2 hoặc systemd để máy chủ tự chạy lại, và Nginx + HTTPS phía trước
```
Khi dùng Nginx, nhớ bật chuyển tiếp WebSocket cho đường dẫn `/ws`:
```
location / {
  proxy_pass http://127.0.0.1:3000;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
}
```

## Cấu trúc

| File | Vai trò |
|---|---|
| `server.js` | Máy chủ: phục vụ trang, lấy giá mỗi phút, phòng chơi WebSocket, giới hạn 30 khách, hàng chờ order |
| `public/index.html` | Toàn bộ giao diện quán |
| `sources/abs.js` | Lấy giá từ ABS |
| `sources/sim.js` | Giá mô phỏng, dùng khi chưa có nguồn thật |
| `data/seed.json` | Tên công ty và vốn hóa xấp xỉ của khoảng 200 mã, dùng cho kích thước ly. Mã không có trong file thì ly nhỏ, hoặc tính từ số cổ phiếu niêm yết nếu dữ liệu ABS có |

## Đường dẫn

- `/`: trang quán
- `/api/prices`: bảng giá hiện tại (JSON)
- `/api/health`: tình trạng máy chủ (nguồn giá, số mã, lỗi gần nhất, số khách)
- `/ws`: kết nối phòng chơi
