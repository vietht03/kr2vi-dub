# KR2VI Dub – bản Android

App Android dùng **dịch vụ Trợ năng** để đọc chữ phụ đề (CC) đang hiện trong app YouTube, dịch sang tiếng Việt (Google Translate miễn phí; phụ đề đã là tiếng Việt thì giữ nguyên) và đọc thành tiếng bằng giọng đọc của máy. Có 2 nút nổi khi mở YouTube: bật/tắt lồng tiếng và tắt tiếng gốc.

Đã chạy thử trên điện thoại Android 16 (realme). Phụ đề được đọc qua view `subtitle_window_identifier` của app YouTube; nếu YouTube đổi tên view này, sửa `CAPTION_ID` trong `CaptionService.kt` (bật "Chế độ chẩn đoán" trong app để xem cây giao diện).

## Build
1. Cần JDK 17 và Android SDK (platform 34, build-tools 34). Mở thư mục `android` bằng Android Studio, hoặc chạy `gradle assembleDebug` (Gradle 8.7); file APK nằm ở `app/build/outputs/apk/debug/`.
2. Cài APK vào điện thoại (cho phép cài từ nguồn không xác định).

## Cài đặt trên điện thoại
1. Mở app **KR2VI Dub** → **Mở cài đặt Trợ năng** → KR2VI Dub → Bật. Android 13+ có thể cần *Cho phép cài đặt bị hạn chế* trong thông tin ứng dụng.
2. Bấm **Đọc thử giọng Việt**. Nếu máy thiếu giọng, cài Google Speech Services và tải giọng Tiếng Việt.
3. Mở YouTube, phát video, **bật CC**.

## Giới hạn
- Đọc phụ đề *đang hiện*, trễ khoảng 1–3 giây, không dịch trước.
- Cửa sổ nổi (PiP) của YouTube không lộ phụ đề nên không đọc được.
- Tắt tiếng gốc bằng cách hạ âm lượng nhạc khi đang đọc; một số máy không cho app hạ hết, khi đó hạ bằng phím cứng. Giọng đọc đi theo âm lượng **báo thức**.
- Dịch miễn phí dùng endpoint không chính thức của Google, có thể bị giới hạn.
