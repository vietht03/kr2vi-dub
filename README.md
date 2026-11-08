# KR2VI Dub – Lồng tiếng Việt cho video YouTube tiếng Hàn

Tiện ích Chrome (Manifest V3) dùng cá nhân: lấy phụ đề tiếng Hàn của video YouTube → dịch sang tiếng Việt → đọc bằng giọng Việt (Web Speech API) đúng thời điểm trên video.

## Cài đặt (Developer mode)

1. Mở Chrome, vào `chrome://extensions`.
2. Bật **Developer mode** (góc trên bên phải).
3. Bấm **Load unpacked** và chọn thư mục `kr2vi-dub` này.
4. (Tuỳ chọn) Ghim biểu tượng tiện ích lên thanh công cụ để mở popup chỉnh nhanh.

Sau khi sửa code: bấm nút ⟳ của tiện ích trong `chrome://extensions`, rồi **tải lại tab YouTube (F5)**.

## Sử dụng

1. Mở một video YouTube tiếng Hàn có phụ đề tiếng Hàn (`youtube.com/watch?v=...`).
2. Bấm nút **Lồng tiếng Việt** ở thanh điều khiển player (bên phải, cạnh nút cài đặt). Khi bật, nút có chấm xanh `●`.
3. Đợi vài giây để tải phụ đề và dịch 30 giây đầu; sau đó video sẽ được đọc bằng tiếng Việt.
4. Bấm lại nút để tắt. Khi chuyển sang video khác (không tải lại trang), lồng tiếng tự bật lại cho video mới.

### Popup (bấm biểu tượng tiện ích)
- **Tốc độ đọc**: 0.6x – 1.5x. Nếu câu dịch dài hơn thời gian cho phép, tiện ích tự tăng tốc (tối đa 1.5x).
- **Âm lượng video gốc khi đọc**: mặc định 18% của âm lượng hiện tại.
- **Giọng tiếng Việt**: danh sách giọng `vi-*` có trên máy.
- **Hiện phụ đề tiếng Việt** trên màn hình.

### Trang Options (đổi dịch vụ dịch)
Chuột phải biểu tượng tiện ích → *Options* (hoặc link trong popup):
- **Miễn phí** (mặc định): endpoint công khai của Google Translate, không cần key.
- **Gemini** hoặc **OpenAI**: nhập API key và tên model, bấm **Lưu** (Chrome sẽ hỏi cấp quyền truy cập API đó – quyền chỉ được xin khi bạn chọn dịch vụ này).
- **Thử dịch**: kiểm tra nhanh cấu hình. **Xoá cache**: xoá bản dịch đã lưu.

## Cách hoạt động ngắn gọn

| File | Vai trò |
|---|---|
| `manifest.json` | Khai báo MV3, quyền tối thiểu: `storage` + host `youtube.com`, `translate.googleapis.com` (Gemini/OpenAI là quyền tuỳ chọn) |
| `page-bridge.js` | Chạy trong trang YouTube để đọc danh sách track phụ đề từ player |
| `content.js` / `content.css` | Nút, tải & phân tích phụ đề, dịch trước 30s, đọc giọng, đồng bộ, hiển thị phụ đề |
| `service-worker.js` | Gọi API dịch (free / Gemini / OpenAI) |
| `popup.*`, `options.*` | Giao diện cài đặt |
| `shared.js` | Cài đặt mặc định dùng chung |

- Bản dịch được cache trong `chrome.storage.local` theo `videoId` (giữ 20 video gần nhất).
- Khi tua video hoặc tạm dừng: dừng đọc; khi phát lại sẽ đọc tiếp câu đang dở hoặc câu tại vị trí mới.
- Khi YouTube chiếu quảng cáo, lồng tiếng tạm dừng.

## Xử lý sự cố

| Thông báo / hiện tượng | Cách xử lý |
|---|---|
| "Video này không có phụ đề" / "không có phụ đề tiếng Hàn" | Video không có track phụ đề (kể cả tự động tạo) tiếng Hàn. Chọn video khác. |
| "YouTube không cho tải phụ đề… (phản hồi rỗng)" | YouTube đôi khi yêu cầu token cho API phụ đề. Tiện ích đã tự thử cách dự phòng; nếu vẫn lỗi, thử bật CC tiếng Hàn thủ công trên player rồi bật lại lồng tiếng, hoặc tải lại trang. |
| "Lỗi mạng…" / "Lỗi dịch…" | Kiểm tra kết nối; tiện ích tự thử lại với độ trễ tăng dần. Với Gemini/OpenAI, kiểm tra key/model trong Options. |
| "Không tìm thấy giọng tiếng Việt" | Chrome dùng giọng của hệ điều hành/Google. Windows: cài gói ngôn ngữ Tiếng Việt (Settings → Speech). Linux: cài `speech-dispatcher` + `espeak-ng` (có giọng `vi`). macOS: System Settings → Accessibility → Spoken Content → thêm giọng Vietnamese. |
| Nút không xuất hiện | Tải lại trang (F5). Chỉ hoạt động ở `youtube.com/watch` (không hỗ trợ Shorts). |
| Báo "Extension vừa được cập nhật" | Tải lại tab YouTube. |

## Lưu ý
- Dịch miễn phí dùng endpoint không chính thức của Google, có thể bị giới hạn hoặc ngừng hoạt động; khi đó hãy chuyển sang Gemini/OpenAI.
- Phụ đề tự động tạo (ASR) có thể sai nên bản dịch cũng sai theo; tiện ích ưu tiên phụ đề gốc do người đăng tải nếu có.
- Tiện ích giảm âm lượng bằng `video.volume`; nếu bạn đóng tab giữa chừng, âm lượng được khôi phục khi rời trang.
