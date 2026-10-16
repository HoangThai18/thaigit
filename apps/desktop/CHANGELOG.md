# Nhật ký thay đổi — Gitlane cho Windows & macOS

Bản đa nền tảng (Tauri) của Gitlane. Phiên bản theo [SemVer](https://semver.org/lang/vi/); bản thử có hậu tố `-beta.N`.

## 2.6.9 — 2026-10-16

- Thaigit đổi tên thành Gitlane. Cài đặt, tài khoản và các repo đã mở vẫn giữ nguyên
- Biểu tượng app mới
- Sửa lỗi tên nhánh đang đứng trên graph bị cắt cụt (“m…” thay vì “main”)

## 2.6.8 — 2026-10-15

- Xem diff không phải cuộn ngang: dòng dài tự xuống dòng, bật / tắt bằng nút “Xuống dòng”
- Ảnh đại diện của tác giả hiện cả ở khung chi tiết commit

## 2.6.7 — 2026-10-15

- Bộ icon theo loại file trong danh sách thay đổi và khung diff
- Bấm đúp thanh tab để phóng to cửa sổ
- Chuyển sang nhánh đang mở ở worktree khác: app chỉ rõ worktree đó và mở giúp

## 2.6.6 — 2026-10-15

- Trang chủ mới: mở, clone, tạo repo và danh sách repo gần đây trên cùng một màn hình
- Tab “Có gì mới” (nút ✨ cuối thanh tab) xem nhật ký thay đổi ngay trong app
- Biểu tượng nhỏ trên từng tab

## 2.6.5 — 2026-10-15

- Thông báo xung đột tự tắt khi đã giải quyết xong
- Thông báo gọn hơn, không còn chồng chất trên màn hình
- Menu chuột phải chỉ hiện những thao tác làm được
- Sửa lỗi thanh công cụ khung diff bị che nút Stage

## 2.6.4 — 2026-10-15

- Tab Trang chủ luôn ở đầu thanh tab: về trang chủ mà các repo đang mở vẫn giữ nguyên; Ctrl/⌘ + 1 để về nhanh

## 2.6.3 — 2026-10-15

- Thanh tab với nút + để mở thêm repo

## 2.6.2 — 2026-10-15

- Báo bản mới ngay cả khi đang mở app
- Thanh công cụ tự thu gọn khi cửa sổ hẹp
- Sửa lỗi huỷ thay đổi với submodule

## 2.6.1 — 2026-10-15

- Git hooks: mục HOOKS ở sidebar liệt kê các hook của repo (pre-commit, pre-push…), cho biết hook nào đang chạy hay bị chặn vì repo chưa được tin cậy, rê chuột để xem hook làm gì. Ô soạn commit có tuỳ chọn “Bỏ qua hook”; khi hook chặn commit hoặc push, thông báo lỗi có sẵn nút “Commit bỏ qua hook” / “Push bỏ qua hook”
- Git-flow: nút Branch ▾ trên thanh công cụ → khởi tạo Git-flow (chọn nhánh chính, nhánh develop, tiền tố), bắt đầu feature / release / hotfix, và hoàn tất nhánh — app tự merge vào develop (release / hotfix vào cả nhánh chính), gắn tag phiên bản và xoá nhánh; chuột phải nhánh feature / release / hotfix cũng có mục Hoàn tất.
- Mục ISSUES ở sidebar: xem các issue đang mở của repo trên GitHub, GitLab hoặc Bitbucket, lọc theo số / tiêu đề / nhãn; bấm để mở trên web, chuột phải để tạo nhánh cho issue (tên nhánh gợi ý sẵn như issue/42-loi-dang-nhap) hoặc sao chép link
- Review thay đổi của nhánh: chuột phải vào nhánh (kể cả nhánh đang đứng) → “Review thay đổi so với nhánh…” mở hộp tìm để chọn nhánh cần so sánh, gợi ý sẵn nhánh đang đứng và main / develop; trong panel review bấm tên nhánh so sánh để đổi sang nhánh khác
- Giao diện nhiều màu hơn: dòng có nhánh hoặc tag trên graph được tô theo màu của làn, icon ở sidebar có màu riêng theo từng mục
- Luôn biết mình đang ở nhánh nào: nút nhánh trên thanh công cụ thành chip xanh lá ghi rõ “Đang ở nhánh”, nhánh hiện tại trong sidebar có nhãn “Đang ở”, dòng của nhánh hiện tại trên graph được viền và tô đậm
- Góp ý & báo lỗi ngay trong app: menu … (hoặc bảng lệnh Ctrl/⌘ + P, hay màn hình chào) → “Góp ý & báo lỗi…”, viết vài dòng rồi bấm “Soạn email” để mở ứng dụng email với thư soạn sẵn gửi tới tác giả; tuỳ chọn kèm phiên bản Gitlane và hệ điều hành, không kèm gì về repo của bạn

## 2.6.0 — 2026-10-14

- Review nhanh thay đổi của một nhánh so với nhánh khác: chuột phải vào nhánh (sidebar hoặc nhãn trên graph) → “Review thay đổi so với …” (nhánh đang đứng hoặc chọn nhánh khác); panel bên phải liệt kê các file nhánh đó đã đổi kể từ điểm tách, bấm file để xem diff như tab “Files changed” của PR

## 2.5.1 — 2026-10-07

- Bản đa nền tảng nay chạy được cả trên macOS: build cùng mã nguồn Rust + Svelte, cài từ file `Gitlane-macOS.dmg`, tự cập nhật qua cùng kênh Ổn định / Beta như Windows
- Chuyển nhánh khi còn code chưa commit: không xung đột thì cứ chuyển và mang file theo; xung đột thì Gitlane trả mọi thứ về như cũ và hỏi bạn commit hoặc cất vào stash (lưu nháp) rồi mới chuyển, không còn tự mang file xung đột sang nhánh khác
- Nhánh đang đứng nổi bật hơn trong sidebar: nền màu, vạch bên trái, chữ đậm màu nhấn
- Fetch nền (auto-fetch): khi mạng lỗi lặp thì Gitlane chờ lâu dần (tối đa 1 tiếng) rồi mới thử lại, thay vì cứ thử mỗi chu kỳ; sidebar nhánh dựng lại nhanh hơn trên repo nhiều nhánh
- Mục “An toàn” trong Cài đặt: hiện tóm tắt những lớp bảo vệ đang bật — chỉ chạy đúng các lệnh git Gitlane biết, luôn tắt `core.fsmonitor` / `--no-textconv` / URL scheme nguy hiểm, và lược bỏ biến môi trường git có thể trỏ sang repo khác
- Trong panel PR / MR: gửi bình luận chung, duyệt (approve) và gộp (merge, chọn cách merge / squash / rebase) ngay trong app — không cần mở web; chỉ gửi tiêu đề/mô tả/nhánh bạn nhìn thấy trong hộp thoại
- Gộp PR/MR: chỉ hiện chiến lược mà dịch vụ hỗ trợ (GitLab không còn tuỳ chọn Rebase, Bitbucket còn đúng Merge), không còn lặng lẽ gộp theo kiểu khác; nút Gộp xác nhận bằng hộp thoại trong app (trên GitLab/Bitbucket/Windows trước đó hay bị chặn)

## 2.4.0 — 2026-10-05

- Chấm trên graph hiện ảnh đại diện thật của người commit (tìm qua GitHub theo email rồi tới Gravatar, chỉ tải ảnh chứ không gửi mã nguồn đi đâu), kể cả chấm của dòng “// WIP” là của chính bạn; chưa có ảnh thì vẽ chữ viết tắt như cũ, và tắt hẳn được ở Cài đặt → “Ảnh đại diện thật trên graph”
- Số file chưa commit nằm ngay cạnh tên nhánh đang ở (rê chuột vào xem chi tiết) thay vì nằm ở dòng “// WIP” — đúng nhánh thì mới thấy số file của nhánh đó
- Giải xung đột nhanh hơn: tick chọn từng dòng của mỗi bên, xem trước cả file kết quả và sửa tay trước khi lưu, nhảy giữa các đoạn xung đột bằng nút hoặc Alt + ↑ / ↓, chọn nhanh cho mọi đoạn còn lại
- Danh sách file xung đột hiện số đoạn của từng file; chọn nhiều file (Ctrl-click) hoặc bấm “Giải quyết tất cả” để dùng bản Current / Incoming cho nhiều file một lần
- Terminal ngay trong cửa sổ repo (nút Terminal hoặc Ctrl+`): mở sẵn ở thư mục repo, nhiều tab, ẩn đi các lệnh vẫn chạy tiếp
- Menu chuột phải của commit đầy đủ hơn: sửa message, xoá commit, đưa commit lên / xuống, sao chép patch, mở commit trên GitHub / GitLab / Bitbucket và sao chép link — đều có Hoàn tác
- Nút PR (GitLab là MR) ngay trên thanh công cụ của mỗi tab repo để tạo Pull Request / Merge Request cho nhánh đang đứng; repo ở GitLab thì nút, hộp thoại và thông báo đều gọi là Merge Request
- Review Pull Request / Merge Request ngay trong app: bấm một PR / MR ở sidebar để xem mô tả, các file thay đổi so với nhánh đích và diff từng file (như tab “Files changed” trên web), kèm nút mở trên web, checkout nhánh và tải lại; PR / MR từ fork cũng xem được. Số hiệu của GitLab hiện đúng kiểu !12 thay vì #12
- Gán người review và người được gán (assignee) ngay trong panel review của PR / MR, trên GitHub và GitLab: bấm nút cạnh “Người review” / “Người được gán”, tìm theo tên, tick rồi “Áp dụng”; danh sách người hiện có luôn lấy lại từ máy chủ sau khi lưu (Bitbucket chỉ xem người review)

## 2.3.0 — 2026-10-05

- Khoá SSH ngay trong Gitlane (Cài đặt → Khoá SSH): tạo khoá mới hoặc nhập khoá có sẵn chỉ với vài cú bấm, khoá được cất an toàn trên máy — clone / fetch / push repo SSH không cần tự cấu hình gì thêm
- Thêm khoá SSH lên GitHub / GitLab chỉ một bước, kèm nút kiểm tra kết nối
- Đăng nhập GitLab.com bằng mã, và giữ đăng nhập GitLab lâu dài — không còn bị đăng xuất sau vài giờ
- Giao diện tiếng Anh không còn lẫn chữ tiếng Việt ở dòng báo thao tác đang làm dở (merge, rebase…)

## 2.2.0 — 2026-10-05

- Nhiều nhánh / tag cùng một commit: nhãn ưu tiên nhánh đang đứng rồi main / master / develop; rê chuột vào "+N" hiện danh sách nhánh bị gom, bấm để chọn nhánh (Checkout, Merge, Push…); nhấp đúp lên nhãn checkout đúng nhánh đó
- Checkout khi còn thay đổi chưa commit: Gitlane tự stash, chuyển nhánh rồi mang thay đổi sang — không còn báo lỗi; xung đột thì bản gốc vẫn giữ trong stash
- Cạnh tên nhánh trên thanh công cụ có số file chưa commit (bấm để về WIP); xem một commit mà còn file chưa commit thì đầu panel chi tiết nhắc kèm nút Stage tất cả / Xem & commit
- Nút Undo trên thanh công cụ: hoàn tác thao tác git gần nhất (commit, checkout, pull, huỷ thay đổi…), tự tắt khi repo đã đổi khác
- Rê chuột vào cột graph để xem tên người commit và thời gian; dải "Nên xem lại trước khi commit" có nút ẩn; danh sách đang trống trong panel thay đổi thu nhỏ để danh sách kia hiện nhiều file hơn; cùng một thông báo không hiện lặp
- Danh sách file thay đổi xem được dạng cây thư mục (nút cạnh "Stage tất cả"): gập / mở thư mục, stage hoặc bỏ stage cả thư mục một lần bấm
- Ẩn nhánh khỏi graph hoặc "Chỉ hiện nhánh này" (solo) từ menu chuột phải của nhánh — graph gọn lại khi repo có nhiều nhánh; dải báo phía trên graph có nút "Hiện tất cả nhánh"; nhớ riêng cho từng repo
- Hàng nút trên thanh công cụ dễ nhìn hơn: nền sáng có viền, mỗi thao tác một màu biểu tượng (Fetch xanh dương, Pull xanh ngọc, Push xanh lá, Branch tím, Stash / Pop cam)
- Nút Cài đặt và Profile ở góc phải thanh công cụ: avatar tên / email Git đang dùng để commit, bấm để đổi tên & email (cho riêng repo hoặc mọi repo), chọn tài khoản GitHub / GitLab cho repo hoặc mở Cài đặt
- Chữ chú giải trên thanh công cụ và thông báo gọi đúng tên lệnh: "Fetch từ mọi remote", "Pull commit mới từ remote về nhánh hiện tại", "Push commit của nhánh hiện tại lên remote", "Stash mọi thay đổi chưa commit", "Pop stash mới nhất", "Fetch đầy đủ từ remote", "Đã pop thay đổi từ stash" thay cho "lấy thông tin mới", "đẩy commit", "cất tạm", "lấy lại stash", "lấy đầy đủ"
- Bản tiếng Anh dùng đúng thuật ngữ git (Fetch / Pull / Push / Stash / Pop) thay cho các cụm diễn giải như "Get the latest information…", "Bring new commits…", "Put all uncommitted changes aside", "Bring back the latest stash"
- Hộp chọn thư mục / chọn chương trình git hiện bằng tiếng Anh khi giao diện là tiếng Anh
- Dòng bản quyền trong thông tin gói cài đặt đổi sang tiếng Anh
- Trang chủ có nút Cài đặt và Tài khoản GitHub / GitLab (mở thẳng tới mục tài khoản trong Cài đặt)
- Đăng nhập GitHub bằng mã dùng được ngay

## 2.1.0 — 2026-10-04

Tab nhiều repo, rebase tương tác, lịch sử file và blame, worktree / submodule, Git LFS, command palette và diff tô màu cú pháp.

- Dòng thời gian: Gitlane tự lưu thư mục làm việc mỗi khi file thay đổi (kể cả file chưa commit) để bạn quay lại được khi code bị hỏng — rất hợp khi code cùng AI (Cursor, Claude Code…). Mở bằng nút "Dòng thời gian" ở panel thay đổi hoặc menu Thêm; chọn một mốc để xem khác gì so với bây giờ, khôi phục một file hoặc tất cả, luôn hỏi trước và có Hoàn tác
- Mốc chỉ lưu trên máy bạn, không ảnh hưởng tới phần đã stage, nhánh hay stash; mỗi worktree một dòng thời gian riêng. Mặc định giữ 7 ngày / 300 mốc, chỉnh ở Cài đặt → Dòng thời gian; tắt riêng cho một repo ngay trong panel
- Cảnh báo trước khi commit: panel thay đổi báo khi bạn (hoặc AI) xoá / bỏ qua test, đổi dependency, sửa CI / Docker, thêm file lớn hơn 1 MB, hoặc có file trông như chứa mật khẩu / khoá bí mật — chỉ hiện tên file, không chặn commit
- Giao diện tiếng Anh: chọn ở Cài đặt → Giao diện → Ngôn ngữ / Language
- Tài khoản GitHub / GitLab / Bitbucket (Cài đặt → Tài khoản): dán token hoặc đăng nhập bằng mã; token nằm trong Credential Manager của Windows, fetch / pull / push không phải nhập lại
- Nhiều tài khoản trên cùng một máy chủ (cá nhân + công ty): app tự chọn tài khoản theo owner của repo, hoặc bạn tự gán ở menu Thêm → "Tài khoản cho repo này" (kèm đề nghị ghi tên / email commit của tài khoản đó vào repo)
- Hộp Clone liệt kê repo của tài khoản đã đăng nhập, bấm là điền địa chỉ
- Mục PULL REQUESTS ở sidebar: xem Pull Request / Merge Request đang mở, mở trên web, checkout nhánh của PR (cả PR từ fork trên GitHub / GitLab)
- Tạo Pull Request từ nhánh hiện tại (menu Thêm, hoặc nút + ở mục PULL REQUESTS): chọn nhánh đích, tạo dạng nháp
- Remote từ chối đăng nhập: thông báo có nút "Tài khoản…" để đăng nhập hoặc chọn đúng tài khoản
- Duyệt thay đổi liên tục: stage, bỏ stage hay huỷ file đang xem thì Gitlane mở luôn file kế tiếp thay vì quay về graph; nút ↑ / ↓ (kèm "2/5") ở đầu diff và Alt + Shift + ↑ / ↓ để chuyển file, Alt + ↑ / ↓ để nhảy giữa các hunk
- Commit & Push một bước: nút mũi tên cạnh nút Commit hoặc Ctrl + Shift + Enter
- Message commit đang gõ dở được giữ riêng cho từng repo — đóng app, đổi repo rồi quay lại vẫn còn
- Push bị từ chối vì remote có commit mới: nút "Pull rồi Push" làm cả hai trong một bước; menu Pull có thêm "Đồng bộ (pull rồi push)"
- Tìm & chuyển nhánh (Ctrl + B, hoặc từ nút nhánh trên thanh công cụ): gõ vài chữ (không cần dấu) để lọc mọi nhánh local và remote, Enter để checkout
- Lịch sử file: chuột phải một file → "Lịch sử file" để xem mọi commit đã sửa file đó (kể cả trước khi đổi tên), bấm một commit để xem thay đổi của riêng file ấy
- Blame: chuột phải một file → "Blame" để xem ai sửa từng dòng, commit nào, khi nào; dòng chưa commit được đánh dấu riêng, bấm vào cột trái để nhảy tới commit trên graph
- Rebase tương tác: chuột phải một commit trên graph → "Rebase tương tác từ đây…" để đổi thứ tự, sửa message (reword), gộp commit (squash / fixup) hay bỏ commit (drop) với các commit phía sau nó. Kéo tay nắm hoặc Alt + ↑ / ↓ để đổi chỗ, phím P / R / S / F / D để chọn nhanh. Thay đổi chưa commit được tự cất rồi trả lại; gặp xung đột thì dừng lại như rebase thường; xong có nút Hoàn tác
- Quản lý remote ở sidebar: nút + để thêm remote (fetch luôn nếu muốn), chuột phải một remote để fetch riêng remote đó, sửa địa chỉ, đổi tên, sao chép địa chỉ hoặc xoá (có Hoàn tác)
- Command palette (Ctrl + P, hoặc menu Thêm): gõ vài chữ (không cần dấu) để chạy nhanh mọi thao tác — fetch, pull, push, stash, tạo / chuyển nhánh, thêm remote, cài đặt… — checkout nhánh / tag, hoặc mở diff của file đang thay đổi
- Worktree (mục WORKTREES ở sidebar): nút + để thêm worktree — một thư mục làm việc thứ hai của cùng repo, checkout nhánh khác để làm song song mà không phải stash; nhấp đúp hoặc chuột phải → "Mở trong cửa sổ mới"; gỡ worktree (hỏi trước, còn thay đổi chưa commit thì hỏi thêm lần nữa) và dọn worktree đã mất thư mục
- Submodule (mục SUBMODULES ở sidebar, chỉ hiện khi repo có submodule): xem trạng thái (chưa khởi tạo / lệch commit), cập nhật một hoặc tất cả submodule (update --init --recursive), đồng bộ URL, mở submodule trong cửa sổ mới
- Diff tô màu cú pháp cho các ngôn ngữ phổ biến (TypeScript / JavaScript, Svelte, Vue, Rust, Go, Python, Java, Kotlin, Swift, C / C++, C#, PHP, Ruby, CSS, HTML, JSON, YAML, Markdown, SQL, shell…), cả giao diện sáng lẫn tối
- Diff có nút "Bỏ qua khoảng trắng" (git diff -w): ẩn các thay đổi chỉ về thụt lề / khoảng trắng để dễ đọc; khi bật thì tạm không stage từng dòng
- Git LFS (mục GIT LFS ở sidebar, hiện khi repo dùng LFS): xem các mẫu file đang track, nút + để track mẫu mới, chuột phải để bỏ track; fetch / pull file LFS và dọn bộ nhớ đệm (prune). Chuột phải một file → Git LFS → "Track mọi file .psd bằng LFS" để bắt đầu dùng LFS
- Push tự đẩy file LFS trước (git lfs push), kể cả khi repo chưa cài hook của git-lfs — remote không còn bị nhận file con trỏ mà thiếu nội dung
- Diff của file LFS có ghi chú "chỉ là con trỏ tới … trên máy chủ LFS" kèm dung lượng thật
- An toàn hơn với repo lạ: khoá cấu hình git-lfs có thể chạy chương trình (lfs.customtransfer.*.path, lfs.extension.*) được tính khi hỏi tin tưởng repo; repo chưa tin tưởng thì chưa chạy lệnh LFS. Hook chuẩn do git-lfs cài không còn làm app hỏi lại tin tưởng
- Tab nhiều repo trong một cửa sổ: Ctrl + T mở tab mới, Ctrl + W đóng tab, Ctrl + Tab / Ctrl + Shift + Tab hoặc Ctrl + 1…9 để chuyển; kéo tab để đổi chỗ, nhấp chuột giữa để đóng, chuột phải để đóng các tab khác. Repo ở tab nền vẫn được theo dõi và tự fetch, chuyển tab là thấy ngay; mở một repo đã có tab thì chuyển sang tab đó. Cửa sổ chính nhớ các tab và mở lại khi khởi động app
- Cửa sổ mới chuyển sang Ctrl + Shift + N (Ctrl + T giờ là tab mới)
- Câu chữ giao diện dùng đúng thuật ngữ git quen thuộc (detached HEAD, hard reset, upstream, shallow clone, annotated tag, message, parent…) thay cho các chữ dịch gượng như "HEAD tách rời", "Reset cứng", "lời nhắn"

## 2.0.0 — 2026-10-03

Bản chính thức đầu tiên cho Windows 10 / 11.

- Màn Cài đặt (Ctrl+,): giao diện, lịch sử, đồng bộ, diff, quyền riêng tư, kênh cập nhật Beta / Ổn định
- Thống kê ẩn danh mặc định tắt — chỉ gửi khi bạn bật
- Clone và Tạo repo mới ngay ở màn hình chính
- Diff tách đôi (cũ | mới), xem ảnh cũ / mới cạnh nhau
- Kéo-thả: nhánh lên nhánh để merge / rebase, lên remote để push; file giữa "Chưa stage" và "Đã stage"
- Tìm commit trên graph (Ctrl+F), gõ không dấu vẫn ra
- Mở Terminal, trình soạn thảo, thư mục repo từ menu
- Chế độ an toàn: app không mở lên được vài lần liên tiếp thì tự kiểm bản sửa lỗi
- Repo clone chỉ một nhánh hoặc thiếu lịch sử (thường gặp khi clone từ GitLab / IDE): app báo và có nút "Lấy đầy đủ từ remote" để main cùng các nhánh khác hiện ra
- Mở thêm cửa sổ (Ctrl+T) để làm việc với nhiều repo cùng lúc

## 2.0.0-beta.1 — 2026-10-03

Bản thử đầu tiên cho Windows.

- Graph commit nhiều màu (hàng chục nghìn commit vẫn mượt), sidebar nhánh / remote / tag / stash, panel chi tiết commit
- Stage / bỏ stage / huỷ theo file, theo hunk hoặc từng dòng; xem diff ở vùng giữa (tô phần khác trong dòng, diff rất lớn hỏi trước)
- Commit, amend, "Stage tất cả & commit", Hoàn tác commit
- Fetch / Pull (merge, rebase, chỉ fast-forward) / Push trên thanh công cụ, tiến độ và nút Huỷ; push nhánh mới hỏi remote; bị từ chối thì gợi ý Pull trước / Force push (--force-with-lease); tự fetch nền
- Đổi nhánh nhanh, tạo nhánh, stash / pop; "Stash rồi checkout" khi thay đổi chặn việc đổi nhánh
- Menu chuột phải cho commit, nhánh, tag, stash, file: merge, rebase, cherry-pick, revert (commit ngay hoặc chưa commit), reset soft / mixed / hard, xoá / đổi tên nhánh, tag, xoá trên remote, .gitignore
- Thanh "Đang merge / rebase…" với Tiếp tục / Bỏ qua / Huỷ; giải xung đột từng đoạn ngay trong app (Current / Incoming / cả hai)
- Hầu hết thao tác có "Hoàn tác"; huỷ thay đổi luôn hỏi trước
- Nhật ký lệnh git (menu Thêm)
- Tự cập nhật: kiểm bản mới lúc mở app và mỗi 6 giờ, bản cài có chữ ký số kiểm trước khi cài

Lưu ý: bản cài chưa ký Authenticode nên lần đầu Windows SmartScreen sẽ cảnh báo — bấm "More info" → "Run anyway".
