# KR2VI Dub – Lồng tiếng Việt cho video YouTube

Tiện ích Chrome (Manifest V3): lấy phụ đề của video YouTube (Hàn / Nhật / Trung / Anh) → dịch sang tiếng Việt → đọc bằng giọng Việt đúng thời điểm trên video. Dùng cá nhân, cài thủ công bằng Developer mode, **không cần cài thêm phần mềm**, chạy trên **Windows, macOS và Linux**.

## Cài đặt

### Bước 1 – Tải mã nguồn

Chọn một trong hai cách:

- **Không cần Git (dễ nhất):** vào trang repo trên GitHub → nút xanh **Code** → **Download ZIP** → giải nén ra một thư mục cố định (ví dụ `C:\kr2vi-dub` trên Windows, `~/kr2vi-dub` trên macOS/Linux).
- **Dùng Git:**
  ```bash
  git clone https://github.com/vietht03/kr2vi-dub.git
  ```

> Đừng xoá hoặc di chuyển thư mục sau khi cài, vì Chrome đọc trực tiếp từ thư mục đó.

### Bước 2 – Nạp vào Chrome (Chrome, Edge, Brave… đều được)

1. Mở `chrome://extensions` (Edge: `edge://extensions`).
2. Bật **Developer mode** (góc trên bên phải; Edge: thanh bên trái).
3. Bấm **Load unpacked** (Edge: *Load unpacked*) và chọn thư mục `kr2vi-dub` **chứa file `manifest.json`** (không chọn thư mục cha).
4. Ghim biểu tượng "K" lên thanh công cụ (biểu tượng ghép hình → ghim).

Cần Chrome 111 trở lên.

### Cập nhật phiên bản mới
Tải lại ZIP (hoặc `git pull`), ghi đè thư mục cũ, vào `chrome://extensions` bấm nút ⟳ trên thẻ KR2VI Dub, rồi **Ctrl+Shift+R** (Mac: Cmd+Shift+R) tab YouTube đang mở. Số phiên bản dưới tên tiện ích phải khớp với `manifest.json`.

## Sử dụng

1. Mở video tại `youtube.com/watch?v=...` có phụ đề (kể cả phụ đề tự động tạo).
2. Bấm nút **Lồng tiếng Việt** ở thanh điều khiển player, hoặc di chuột lên video và bấm nút nổi ở góc trên bên trái, hoặc bấm **Bật lồng tiếng Việt** trong popup.
3. Đợi vài giây để tải phụ đề và dịch 30 giây đầu. Khi bật, nút có chấm xanh `●` và video sẽ được đọc bằng tiếng Việt.
4. Bấm lại để tắt. Khi chuyển sang video khác (không tải lại trang), lồng tiếng tự bật cho video mới.

### Popup (bấm biểu tượng "K")
- **Bật/Tắt lồng tiếng** cho tab đang xem.
- **Tốc độ đọc** 0.6x – 1.5x. Câu dài sẽ tự tăng tốc (tối đa 1.5x) để khớp thời gian.
- **Âm lượng video gốc khi đọc** (mặc định 18%).
- **Ngôn ngữ phụ đề nguồn**: Tự động (Hàn → Nhật → Trung → Anh), hoặc chọn riêng Hàn / Nhật / Trung / Anh. Áp dụng khi bật lại.
- **Tắt hẳn âm thanh gốc** (bật mặc định): chỉ nghe lồng tiếng. Bỏ tick để nghe âm gốc nhỏ ở nền.
- **Giọng tiếng Việt** và **hiện phụ đề tiếng Việt** trên màn hình.

### Trang Options (đổi dịch vụ dịch)
Chuột phải biểu tượng tiện ích → *Options*:
- **Miễn phí** (mặc định): Google Translate, không cần key, tự nhận ngôn ngữ nguồn.
- **Gemini** / **OpenAI**: nhập API key và model, bấm **Lưu** (Chrome sẽ hỏi quyền truy cập API đó). Bản dịch tự nhiên hơn.
- **Thử dịch** để kiểm tra, **Xoá cache** để xoá bản dịch đã lưu.

## Giọng đọc tiếng Việt

Tiện ích ưu tiên giọng Việt có sẵn trong máy; **nếu máy không có, tự dùng giọng online của Google** (cần Internet), nên thường không cần cài thêm gì.

Muốn dùng giọng offline/chất lượng tốt hơn:
- **Windows 10/11:** *Settings → Time & language → Language & region → Add a language → Tiếng Việt*, tick **Text-to-speech**; khởi động lại Chrome. Giọng sẽ hiện trong popup.
- **macOS:** *System Settings → Accessibility → Spoken Content → System Voice → Manage Voices… → Vietnamese*.
- **Linux:** `sudo apt install speech-dispatcher espeak-ng`, mở lại Chrome.

## Cấu trúc

| File | Vai trò |
|---|---|
| `manifest.json` | MV3. Quyền: `storage`, host `youtube.com`, `translate.googleapis.com`, `translate.google.com` (Gemini/OpenAI là quyền tuỳ chọn) |
| `page-bridge.js` | Chạy trong trang YouTube để đọc danh sách track phụ đề từ player |
| `content.js`, `content.css` | Nút, tải & phân tích phụ đề, dịch trước 30s, đọc giọng, đồng bộ, hiển thị phụ đề |
| `service-worker.js` | Gọi API dịch (free / Gemini / OpenAI) và tải giọng đọc online |
| `popup.*`, `options.*` | Giao diện cài đặt |
| `shared.js` | Cài đặt mặc định dùng chung |

Bản dịch được cache theo `videoId` (giữ 20 video gần nhất). Tua hoặc tạm dừng thì giọng dừng, phát lại sẽ đọc tiếp đúng vị trí. Quảng cáo YouTube không bị lồng tiếng.

## Xử lý sự cố

| Hiện tượng | Cách xử lý |
|---|---|
| Popup báo "Chưa kết nối trang YouTube" | Tab đang mở còn chạy bản cũ: bấm ⟳ ở `chrome://extensions` rồi Ctrl+Shift+R tab YouTube |
| "Video này không có phụ đề" | Video không có track phụ đề nào. Chọn video khác |
| "YouTube không cho tải phụ đề… (phản hồi rỗng)" | Bật CC thủ công trên player rồi bật lại lồng tiếng, hoặc tải lại trang |
| "Lỗi dịch…" / "Lỗi mạng…" | Kiểm tra mạng; tiện ích tự thử lại. Với Gemini/OpenAI kiểm tra key/model |
| "Lỗi giọng đọc online…" | Kiểm tra mạng, hoặc cài giọng Việt trong máy (xem trên) |
| Không có nút | Tải lại trang. Chỉ hoạt động ở `youtube.com/watch` (không hỗ trợ Shorts) |
| Báo "Extension vừa được cập nhật" | Tải lại tab YouTube |

## Lưu ý
- Dịch miễn phí và giọng online dùng endpoint không chính thức của Google, có thể bị giới hạn hoặc ngừng hoạt động. Khi đó dùng Gemini/OpenAI và giọng trong máy.
- Phụ đề tự động tạo (ASR) có thể sai nên bản dịch cũng sai theo; tiện ích ưu tiên phụ đề gốc do người đăng tải.
- API key chỉ lưu cục bộ (`chrome.storage.local`), không đồng bộ lên đám mây.
- Dự án dùng cho mục đích cá nhân, tôn trọng bản quyền nội dung video.
