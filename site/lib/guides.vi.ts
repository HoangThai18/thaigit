import type { GuideText } from './guide-types';

export const GUIDES_VI: Record<string, GuideText> = {
  conflict: {
    title: 'Cách giải quyết conflict (xung đột) trong Git — dễ hiểu cho người mới',
    short: 'Giải conflict Git',
    description:
      'Conflict Git là gì, vì sao xảy ra khi merge / rebase / pull, đọc các dấu <<<<<<< ======= >>>>>>> thế nào và cách giải quyết bằng lệnh hoặc bằng vài cú bấm trong Thaigit.',
    intro: [
      'Conflict (xung đột) xảy ra khi hai nhánh cùng sửa một chỗ trong một file và Git không tự quyết được giữ bản nào. Chuyện này rất bình thường khi làm việc nhóm — không có gì hỏng cả, Git chỉ đang chờ bạn chọn.',
    ],
    sections: [
      {
        heading: 'Khi nào conflict xảy ra?',
        paragraphs: [
          'Conflict có thể xuất hiện khi bạn merge, rebase, cherry-pick, revert, pull hoặc áp lại stash. Git dừng giữa chừng, đánh dấu các file bị xung đột và chờ bạn giải quyết rồi mới đi tiếp.',
        ],
      },
      {
        heading: 'Đọc dấu conflict trong file',
        paragraphs: [
          'Trong file bị xung đột, Git chèn ba loại dấu. Phần giữa <<<<<<< và ======= là bản hiện tại (Current — nhánh bạn đang đứng), phần giữa ======= và >>>>>>> là bản đi vào (Incoming — nhánh đang được merge vào).',
          'Lưu ý: khi rebase thì ngược lại — Current là nhánh bạn đang rebase lên trên, Incoming là commit của bạn.',
        ],
        sample: [
          '<<<<<<< HEAD',
          'const giaBan = 120000;',
          '=======',
          'const giaBan = 99000;',
          '>>>>>>> feature/khuyen-mai',
        ],
      },
      {
        heading: 'Giải conflict bằng dòng lệnh',
        steps: [
          'Chạy git status để xem file nào đang bị xung đột (mục “Unmerged paths”).',
          'Mở từng file, giữ phần đúng, xoá hết các dấu <<<<<<<, =======, >>>>>>>.',
          'Đánh dấu đã giải quyết bằng git add <file>.',
          'Đi tiếp: git commit (khi merge), git rebase --continue (khi rebase) hoặc git cherry-pick --continue.',
          'Muốn bỏ hẳn và quay về như trước: git merge --abort hoặc git rebase --abort.',
        ],
        code: [
          'git status',
          'git add src/gia.ts',
          'git commit            # hoặc: git rebase --continue',
          'git merge --abort     # bỏ merge, quay lại như cũ',
        ],
        note: {
          kind: 'tip',
          text: 'Chạy git status bất cứ lúc nào — Git luôn nhắc bạn đang ở bước nào và nên làm gì tiếp.',
        },
      },
      {
        heading: 'Giải conflict bằng Thaigit',
        paragraphs: [
          'Thaigit hiện banner cho biết đang merge, rebase hay cherry-pick, kèm danh sách file xung đột. Bấm vào file để mở trình giải xung đột: mỗi khối được tách riêng, không cần tự xoá dấu.',
        ],
        steps: [
          'Với mỗi khối, chọn Giữ Current, Giữ Incoming hoặc giữ cả hai.',
          'Nhiều khối giống nhau? Chọn nhanh “Dùng toàn bộ Current” hoặc “Dùng toàn bộ Incoming”.',
          'Xem trước kết quả rồi bấm “Lưu & đánh dấu đã giải quyết”.',
          'Khi hết file xung đột, bấm Tiếp tục trên banner. Muốn dừng thì bấm Huỷ — mọi thứ trở lại như trước khi merge.',
        ],
        shot: 'conflict',
      },
      {
        heading: 'Mẹo để ít conflict hơn',
        steps: [
          'Pull thường xuyên để nhánh của bạn không lệch quá xa nhánh chính.',
          'Chia commit nhỏ, mỗi commit một việc.',
          'Tránh đổi định dạng cả file (format, đổi xuống dòng CRLF/LF) chung với thay đổi thật.',
        ],
      },
    ],
    faq: [
      {
        q: 'Giải conflict sai thì sửa lại được không?',
        a: [
          'Được. Nếu chưa commit, chạy git merge --abort (hoặc bấm Huỷ trong Thaigit) để làm lại từ đầu. Nếu đã commit, bấm Hoàn tác trong Thaigit hoặc dùng git reset để quay lại.',
        ],
      },
      {
        q: 'Current và Incoming là gì?',
        a: [
          'Current là bản trên nhánh bạn đang đứng (HEAD), Incoming là bản từ nhánh đang được đưa vào. Khi rebase, hai vai này đổi chỗ cho nhau.',
        ],
      },
    ],
  },
  'stage-lines': {
    title: 'Stage từng dòng trong Git (thay cho git add -p) — commit gọn, đúng ý',
    short: 'Stage từng dòng',
    description:
      'Cách chỉ đưa một phần thay đổi của file vào commit: git add -p trên dòng lệnh và cách chọn từng dòng để Stage / Huỷ trong Thaigit.',
    intro: [
      'Bạn sửa một file cho hai việc khác nhau — sửa lỗi và thêm tính năng — nhưng muốn tách thành hai commit riêng. Lúc đó cần stage từng phần (từng hunk hoặc từng dòng) thay vì cả file.',
    ],
    sections: [
      {
        heading: 'Staging area là gì?',
        paragraphs: [
          'Git có một “vùng chờ” (index / staging area) nằm giữa thư mục làm việc và commit. Chỉ những gì đã stage mới vào commit kế tiếp. Nhờ vậy bạn chọn chính xác thay đổi nào được commit.',
        ],
        note: {
          kind: 'tip',
          text: 'Xem lại những gì sắp commit bằng git diff --staged trước khi bấm commit.',
        },
      },
      {
        heading: 'Dùng git add -p',
        paragraphs: [
          'git add -p đi qua từng hunk và hỏi bạn: y (stage hunk này), n (bỏ qua), s (chia nhỏ hunk), e (sửa tay), q (thoát). Muốn bỏ stage một phần thì dùng git restore --staged -p.',
        ],
        code: [
          'git add -p src/gio-hang.ts',
          'git restore --staged -p src/gio-hang.ts   # bỏ stage từng phần',
          'git diff --staged                          # xem lại những gì sắp commit',
        ],
      },
      {
        heading: 'Stage từng dòng trong Thaigit',
        steps: [
          'Chọn file trong mục “Chưa stage” để xem diff.',
          'Bấm vào một dòng để chọn, Shift + bấm để chọn cả đoạn liên tiếp.',
          'Bấm “Stage dòng” để đưa những dòng đó vào commit, hoặc “Huỷ dòng” để bỏ hẳn thay đổi đó khỏi file.',
          'Lặp lại cho phần khác, viết message rồi commit.',
        ],
        shot: 'diff-lines',
        paragraphs: [
          'Lỡ huỷ nhầm? Bấm Hoàn tác ngay sau đó. Thaigit giữ nguyên từng byte của file (kể cả xuống dòng CRLF hay file không phải UTF-8) khi stage một phần.',
        ],
      },
    ],
    faq: [
      {
        q: 'Stage theo hunk và theo dòng khác nhau thế nào?',
        a: [
          'Hunk là một cụm dòng thay đổi gần nhau. Stage theo dòng chi tiết hơn: chọn được vài dòng trong một hunk mà không cần chế độ sửa tay (e) của git add -p.',
        ],
      },
    ],
  },
  undo: {
    title: 'Cách hoàn tác (undo) commit trong Git: reset, revert, amend',
    short: 'Hoàn tác commit',
    description:
      'Lỡ commit sai, commit nhầm file hay sai message? So sánh git reset, git revert, git commit --amend — khi nào dùng cái nào — và cách hoàn tác bằng một nút trong Thaigit.',
    intro: [
      'Commit nhầm là chuyện thường gặp. Cách sửa đúng phụ thuộc vào một câu hỏi: commit đó đã push lên remote chưa?',
    ],
    sections: [
      {
        heading: 'Chưa push: sửa thoải mái',
        paragraphs: [
          'Sai message hoặc quên một file: dùng git commit --amend để sửa commit cuối. Muốn bỏ hẳn commit cuối nhưng giữ code: git reset --soft HEAD~1 (thay đổi vẫn ở trạng thái đã stage). Dùng --mixed để giữ code nhưng bỏ stage, còn --hard sẽ xoá luôn thay đổi — cẩn thận.',
        ],
        code: [
          'git commit --amend -m "Message mới"',
          'git reset --soft HEAD~1    # bỏ commit, giữ thay đổi đã stage',
          'git reset HEAD~1           # bỏ commit, giữ thay đổi chưa stage',
        ],
        note: {
          kind: 'warn',
          text: 'git reset --hard xoá luôn thay đổi chưa commit và không có thùng rác. Chỉ dùng khi chắc chắn.',
        },
      },
      {
        heading: 'Đã push: dùng revert',
        paragraphs: [
          'Nếu người khác đã lấy commit về, đừng viết lại lịch sử. git revert tạo một commit mới đảo ngược thay đổi của commit cũ — an toàn cho nhánh dùng chung.',
        ],
        code: ['git revert a1b2c3d', 'git push'],
      },
      {
        heading: 'Lỡ reset --hard mất code?',
        paragraphs: [
          'Git vẫn nhớ các vị trí HEAD trước đó trong reflog. Tìm commit cũ trong git reflog rồi reset về đó.',
        ],
        code: ['git reflog', 'git reset --hard HEAD@{1}'],
      },
      {
        heading: 'Hoàn tác trong Thaigit',
        steps: [
          'Ngay sau khi commit, checkout, pull, merge, rebase, reset, xoá nhánh hay huỷ thay đổi, bấm nút Hoàn tác trên thanh công cụ để quay về trạng thái trước đó.',
          'Sửa commit cuối: bật “Sửa commit trước (amend)” ở ô commit, sửa message hoặc stage thêm file rồi commit lại.',
          'Commit đã push: chuột phải vào commit trên graph → “Revert commit này…”.',
          'Sửa message của commit cũ hơn: chuột phải → “Sửa message commit…”.',
        ],
        shot: 'overview',
        note: {
          kind: 'tip',
          text: 'Nút Hoàn tác hoàn lại thao tác git gần nhất — bấm ngay sau khi lỡ tay là an toàn nhất.',
        },
      },
    ],
    faq: [
      {
        q: 'reset và revert khác nhau thế nào?',
        a: [
          'reset dời nhánh về commit cũ (viết lại lịch sử) — hợp với commit chưa push. revert tạo commit mới đảo ngược thay đổi, lịch sử giữ nguyên — dùng cho commit đã push.',
        ],
      },
      {
        q: 'Amend commit đã push thì sao?',
        a: [
          'Amend tạo commit mới thay cho commit cũ, nên phải push --force-with-lease. Chỉ làm vậy trên nhánh của riêng bạn.',
        ],
      },
    ],
  },
  'merge-rebase': {
    title: 'Git merge và rebase khác nhau thế nào? Khi nào dùng cái nào',
    short: 'Merge hay rebase',
    description:
      'Giải thích dễ hiểu git merge và git rebase, ưu nhược điểm, quy tắc vàng khi rebase, và cách merge / rebase bằng kéo & thả trong Thaigit.',
    intro: [
      'Cả merge và rebase đều đưa thay đổi từ nhánh này sang nhánh khác. Khác nhau ở chỗ lịch sử sau đó trông thế nào.',
    ],
    sections: [
      {
        heading: 'Merge: giữ nguyên lịch sử',
        paragraphs: [
          'git merge nối hai nhánh bằng một merge commit (trừ khi fast-forward được). Lịch sử thể hiện đúng chuyện đã xảy ra, không commit nào bị viết lại — an toàn cho nhánh dùng chung, nhưng graph có thể rối khi nhiều người merge qua lại.',
        ],
        code: ['git switch main', 'git merge feature/gio-hang'],
      },
      {
        heading: 'Rebase: lịch sử thẳng hàng',
        paragraphs: [
          'git rebase lấy các commit của nhánh bạn và “đặt lại” chúng lên đầu nhánh khác. Lịch sử thành một đường thẳng, dễ đọc — nhưng các commit được tạo lại với SHA mới.',
        ],
        code: [
          'git switch feature/gio-hang',
          'git rebase main',
          'git pull --rebase       # kéo code mới mà không tạo merge commit',
        ],
      },
      {
        heading: 'Quy tắc vàng',
        paragraphs: [
          'Đừng rebase những commit đã push lên nhánh người khác đang dùng. Rebase nhánh của riêng bạn trước khi mở pull request thì hoàn toàn ổn; với nhánh chung như main, hãy merge.',
        ],
        note: { kind: 'warn', text: 'Rebase viết lại lịch sử. Chỉ rebase những commit chưa ai khác lấy về.' },
      },
      {
        heading: 'Merge / rebase bằng kéo & thả trong Thaigit',
        steps: [
          'Kéo nhãn nhánh trên graph (hoặc ở sidebar) rồi thả lên nhánh đích.',
          'Thaigit hỏi bạn muốn merge, rebase hay fast-forward — không có gì chạy ngầm ngoài ý muốn.',
          'Nếu có conflict, trình giải xung đột mở ra ngay (xem bài Giải conflict Git).',
          'Đổi ý? Bấm Hoàn tác merge / Hoàn tác rebase.',
        ],
        shot: 'drag',
        paragraphs: [
          'Muốn dọn lịch sử trước khi push (gộp, sửa message, đổi thứ tự, bỏ commit)? Chuột phải vào commit để mở rebase tương tác với các lựa chọn pick, reword, squash, fixup, drop.',
        ],
      },
    ],
    faq: [
      {
        q: 'Fast-forward là gì?',
        a: [
          'Khi nhánh đích chưa có commit mới nào kể từ lúc tách nhánh, Git chỉ cần dời con trỏ nhánh lên — không cần merge commit. Đó là fast-forward.',
        ],
      },
      {
        q: 'Nên dùng merge hay rebase cho team?',
        a: [
          'Phổ biến nhất: rebase nhánh tính năng của riêng bạn lên main để cập nhật, rồi merge (hoặc squash merge) vào main qua pull request.',
        ],
      },
    ],
  },
  stash: {
    title: 'Git stash là gì? Cất tạm thay đổi để chuyển nhánh',
    short: 'Git stash',
    description:
      'Dùng git stash để cất tạm code đang làm dở khi cần chuyển nhánh gấp: stash, stash pop, apply, list, drop — và cách làm bằng một nút trong Thaigit.',
    intro: [
      'Đang code dở thì cần sửa gấp một lỗi trên nhánh khác? Chưa muốn commit nửa vời — hãy stash: Git cất tạm thay đổi vào một ngăn riêng, thư mục làm việc trở lại sạch sẽ.',
    ],
    sections: [
      {
        heading: 'Các lệnh stash hay dùng',
        code: [
          'git stash push -m "đang làm giỏ hàng"   # cất tạm (thêm -u để cất cả file mới)',
          'git stash list                           # xem các stash',
          'git stash pop                            # lấy lại stash mới nhất và xoá nó',
          'git stash apply stash@{1}                # lấy lại nhưng vẫn giữ stash',
          'git stash drop stash@{1}                 # xoá một stash',
        ],
        paragraphs: [
          'Mặc định git stash không cất file chưa track (file mới tạo). Thêm -u nếu muốn cất cả chúng.',
        ],
        note: {
          kind: 'tip',
          text: 'Đặt message khi stash (git stash push -m …) để vài hôm sau còn nhớ stash đó là gì.',
        },
      },
      {
        heading: 'Stash trong Thaigit',
        steps: [
          'Bấm Stash trên thanh công cụ để cất mọi thay đổi chưa commit, hoặc chọn “Stash kèm message…” để đặt tên dễ nhớ.',
          'Khi chuyển nhánh mà đang có thay đổi, Thaigit đề xuất “Stash rồi checkout” — một bước là xong.',
          'Các stash nằm ở sidebar: Apply stash để lấy lại, Xoá stash khi không cần nữa. Lỡ xoá? Bấm Hoàn tác.',
        ],
        shot: 'switch',
      },
    ],
    faq: [
      {
        q: 'stash pop và stash apply khác gì?',
        a: [
          'pop áp thay đổi rồi xoá stash; apply áp thay đổi nhưng vẫn giữ stash để dùng lại. Nếu áp bị conflict, pop sẽ giữ stash lại để bạn không mất gì.',
        ],
      },
    ],
  },
  install: {
    title: 'Cài đặt Git trên macOS và Windows cho người mới bắt đầu',
    short: 'Cài đặt Git',
    description:
      'Hướng dẫn cài Git trên macOS (xcode-select) và Windows (Git for Windows), cấu hình tên và email, rồi mở hoặc clone repository đầu tiên bằng Thaigit.',
    intro: ['Muốn dùng bất kỳ Git client nào, máy cần có Git trước. Cài mất vài phút và chỉ làm một lần.'],
    sections: [
      {
        heading: 'macOS',
        paragraphs: [
          'Mở Terminal và chạy lệnh dưới đây. macOS sẽ hỏi cài Command Line Tools — bấm Cài đặt. Xong thì kiểm tra bằng git --version.',
        ],
        code: ['xcode-select --install', 'git --version'],
      },
      {
        heading: 'Windows',
        steps: [
          'Tải Git for Windows tại git-scm.com/download/win.',
          'Chạy bộ cài, giữ các lựa chọn mặc định là được.',
          'Mở PowerShell hoặc Git Bash, chạy git --version để kiểm tra.',
        ],
      },
      {
        heading: 'Cấu hình tên và email',
        paragraphs: [
          'Mỗi commit ghi tên và email tác giả. Đặt một lần cho cả máy (dùng email trùng với tài khoản GitHub / GitLab để commit hiện đúng người).',
        ],
        code: [
          'git config --global user.name "Nguyễn Văn An"',
          'git config --global user.email "an@example.com"',
        ],
        note: {
          kind: 'tip',
          text: 'Dùng cùng email với tài khoản GitHub để commit hiện đúng ảnh đại diện của bạn.',
        },
      },
      {
        heading: 'Bắt đầu với Thaigit',
        steps: [
          'Tải Thaigit cho macOS hoặc Windows (miễn phí, không cần tài khoản).',
          'Ở màn hình chào, chọn mở thư mục có sẵn, clone từ GitHub / GitLab, hoặc tạo repository mới.',
          'Graph lịch sử hiện ngay — từ đây commit, pull, push bằng nút bấm.',
        ],
        shot: 'welcome',
      },
    ],
    faq: [
      {
        q: 'Có cần tài khoản GitHub để dùng Git không?',
        a: [
          'Không. Git chạy hoàn toàn trên máy bạn. Chỉ khi muốn đưa code lên mạng (push) mới cần tài khoản ở GitHub, GitLab hoặc dịch vụ tương tự.',
        ],
      },
    ],
  },
  'cherry-pick': {
    title: 'Git cherry-pick là gì? Lấy đúng một commit sang nhánh khác',
    short: 'Git cherry-pick',
    description:
      'Dùng git cherry-pick để chép riêng một hoặc vài commit sang nhánh khác mà không merge cả nhánh. Cách dùng, xử lý conflict, và cherry-pick bằng chuột phải trong Thaigit.',
    intro: [
      'Bạn sửa một lỗi trên nhánh tính năng, nhưng bản vá đó cần có ngay trên nhánh chính. Merge cả nhánh thì chưa được vì tính năng chưa xong — lúc này dùng cherry-pick: chép đúng commit đó sang nhánh khác.',
    ],
    sections: [
      {
        heading: 'Cherry-pick hoạt động thế nào?',
        paragraphs: [
          'Git lấy thay đổi của commit được chọn và tạo một commit mới có cùng nội dung trên nhánh bạn đang đứng. Commit mới có mã SHA khác commit gốc, nhưng message và thay đổi giống nhau.',
        ],
        note: {
          kind: 'warn',
          text: 'Commit được chép sang có SHA mới. Dùng nhiều dễ làm lịch sử rối — cần cả nhánh thì hãy merge.',
        },
      },
      {
        heading: 'Dùng bằng dòng lệnh',
        steps: [
          'Chuyển sang nhánh cần nhận commit (ví dụ main).',
          'Lấy mã SHA của commit cần chép (git log --oneline).',
          'Chạy git cherry-pick kèm mã SHA đó.',
        ],
        code: [
          'git switch main',
          'git log --oneline feature/giao-dien',
          'git cherry-pick a1b2c3d',
          'git cherry-pick a1b2c3d..e4f5g6h   # nhiều commit liên tiếp',
        ],
      },
      {
        heading: 'Khi bị conflict',
        paragraphs: [
          'Nếu code ở nhánh đích đã khác nhiều, Git dừng và báo conflict. Giải quyết xong thì đánh dấu đã giải quyết rồi chạy tiếp; muốn bỏ thì huỷ cả thao tác.',
        ],
        code: [
          'git add src/gia.ts',
          'git cherry-pick --continue',
          'git cherry-pick --abort    # bỏ, quay về như cũ',
        ],
      },
      {
        heading: 'Cherry-pick trong Thaigit',
        steps: [
          'Chuột phải vào commit trên graph, chọn Cherry-pick vào <nhánh>.',
          'Thaigit chạy và báo kết quả. Nếu có conflict, banner “Đang cherry-pick” hiện ra cùng trình giải xung đột (xem bài Giải conflict Git).',
          'Chọn nhầm commit? Bấm Hoàn tác cherry-pick.',
        ],
        shot: 'overview',
      },
    ],
    faq: [
      {
        q: 'Cherry-pick khác merge thế nào?',
        a: [
          'Merge đưa toàn bộ lịch sử của một nhánh vào nhánh khác, còn cherry-pick chỉ chép đúng những commit bạn chọn. Cherry-pick tạo commit trùng nội dung nhưng khác SHA, nên dùng nhiều dễ gây lộn xộn lịch sử.',
        ],
      },
    ],
  },
  gitignore: {
    title: '.gitignore là gì? Cách bỏ qua file không muốn đưa lên Git',
    short: 'File .gitignore',
    description:
      'Cách dùng .gitignore để Git không theo dõi file rác, file build, file bí mật (.env). Cú pháp cơ bản, xử lý file lỡ commit, và thêm nhanh vào .gitignore bằng Thaigit.',
    intro: [
      'Không phải file nào trong thư mục dự án cũng nên vào Git: thư mục node_modules, file build, file cấu hình có mật khẩu (.env), file hệ thống như .DS_Store… File .gitignore cho Git biết những thứ cần bỏ qua.',
    ],
    sections: [
      {
        heading: 'Cú pháp cơ bản',
        paragraphs: [
          'Tạo file tên .gitignore ở thư mục gốc dự án, mỗi dòng là một mẫu. Dòng bắt đầu bằng # là chú thích; dấu / ở cuối chỉ thư mục; dấu * thay cho nhiều ký tự; dấu ! để loại trừ một mẫu.',
        ],
        sample: [
          '# Thư viện cài sẵn',
          'node_modules/',
          '',
          '# File build',
          'dist/',
          '*.log',
          '',
          '# Bí mật — không bao giờ commit',
          '.env',
          '',
          '# Nhưng giữ file mẫu',
          '!.env.example',
        ],
      },
      {
        heading: 'File đã lỡ commit thì sao?',
        paragraphs: [
          '.gitignore chỉ có tác dụng với file Git chưa theo dõi. Nếu file đã được commit trước đó, bạn phải bảo Git ngừng theo dõi nó (file trên máy vẫn còn nguyên).',
        ],
        code: ['git rm --cached .env', 'git commit -m "Ngừng theo dõi .env"'],
      },
      {
        heading: 'Lỡ commit mật khẩu hoặc khoá bí mật?',
        paragraphs: ['Xoá file ở commit mới là chưa đủ vì nó vẫn nằm trong lịch sử.'],
        note: {
          kind: 'warn',
          text: 'Đổi ngay mật khẩu / khoá đó và coi như đã lộ, rồi mới tính chuyện viết lại lịch sử.',
        },
      },
      {
        heading: 'Thêm vào .gitignore bằng Thaigit',
        steps: [
          'Trong danh sách “Chưa stage”, chuột phải vào file hoặc thư mục cần bỏ qua.',
          'Chọn “Thêm vào .gitignore”. Thaigit ghi mẫu phù hợp vào file .gitignore và báo lại đã thêm gì.',
          'File biến khỏi danh sách thay đổi; chỉ cần commit file .gitignore.',
        ],
        shot: 'diff-lines',
      },
    ],
    faq: [
      {
        q: '.gitignore nên đặt ở đâu?',
        a: [
          'Thường đặt ở thư mục gốc dự án. Có thể đặt thêm file .gitignore trong thư mục con để áp dụng riêng cho thư mục đó.',
        ],
      },
      {
        q: 'Làm sao bỏ qua file chỉ trên máy của tôi, không đưa vào repo?',
        a: [
          'Ghi mẫu vào file .git/info/exclude trong repo. Cú pháp giống .gitignore nhưng file này không được commit.',
        ],
      },
    ],
  },
  'fetch-pull': {
    title: 'git fetch và git pull khác nhau thế nào? Nên dùng cái nào',
    short: 'Fetch và pull',
    description:
      'So sánh git fetch và git pull, pull merge hay pull rebase, khi nào dùng fast-forward only, và cách chọn kiểu pull trong Thaigit.',
    intro: [
      'Cả hai đều lấy thay đổi từ remote về máy. Khác nhau ở chỗ có tự động đưa thay đổi vào nhánh của bạn hay không.',
    ],
    sections: [
      {
        heading: 'git fetch: chỉ tải về, chưa đụng code của bạn',
        paragraphs: [
          'fetch cập nhật thông tin về các nhánh trên remote (origin/main…) nhưng không đổi nhánh hiện tại hay file đang làm. Chạy lúc nào cũng an toàn; sau đó bạn xem có gì mới rồi mới quyết định merge hay rebase.',
        ],
        code: ['git fetch', 'git log HEAD..origin/main --oneline   # xem remote có gì mới'],
      },
      {
        heading: 'git pull: fetch rồi hợp nhất luôn',
        paragraphs: [
          'pull = fetch + merge (mặc định) hoặc fetch + rebase. Tiện nhưng đổi nhánh của bạn ngay, nên đôi khi gây conflict bất ngờ.',
        ],
        code: [
          'git pull                 # fetch + merge',
          'git pull --rebase        # fetch + rebase, lịch sử thẳng hàng',
          'git pull --ff-only       # chỉ cho phép khi không cần merge',
        ],
      },
      {
        heading: 'Chọn kiểu nào?',
        steps: [
          'Muốn an toàn nhất: fetch trước, xem xong mới merge.',
          'Muốn lịch sử gọn: pull --rebase (chỉ với commit chưa push).',
          'Muốn tránh merge commit vô tình: pull --ff-only — nếu không fast-forward được, Git dừng và để bạn quyết.',
        ],
        note: { kind: 'tip', text: 'Không chắc thì cứ fetch trước — fetch không bao giờ gây conflict.' },
      },
      {
        heading: 'Fetch và pull trong Thaigit',
        steps: [
          'Bấm Fetch trên thanh công cụ để cập nhật mọi remote; Thaigit cũng tự fetch định kỳ.',
          'Bấm Pull để kéo về nhánh hiện tại. Mũi tên nhỏ cạnh nút cho chọn Pull (merge), Pull (rebase) hoặc Pull (chỉ fast-forward).',
          'Muốn nút Pull luôn dùng một kiểu: chọn ở mục “Nút Pull dùng” trong Cài đặt.',
          'Pull xong thấy không ổn? Bấm Hoàn tác pull.',
        ],
        shot: 'overview',
      },
    ],
    faq: [
      {
        q: 'Vì sao nên fetch thường xuyên?',
        a: [
          'Fetch giúp bạn biết đồng nghiệp đã push gì mà chưa đụng vào code của mình, nên ít bị bất ngờ khi push hoặc merge.',
        ],
      },
    ],
  },
  tag: {
    title: 'Git tag là gì? Đánh dấu phiên bản phát hành cho dự án',
    short: 'Git tag',
    description:
      'Git tag dùng để đánh dấu một commit quan trọng như phiên bản v1.0. Phân biệt lightweight và annotated tag, cách tạo, push, xoá tag, và tạo tag bằng chuột phải trong Thaigit.',
    intro: [
      'Nhánh luôn di chuyển theo commit mới, còn tag thì đứng yên. Vì vậy tag hợp để đánh dấu những điểm cần nhớ lâu dài — điển hình là các phiên bản phát hành như v1.0.0.',
    ],
    sections: [
      {
        heading: 'Hai loại tag',
        paragraphs: [
          'Lightweight tag chỉ là một cái nhãn gắn vào commit. Annotated tag lưu thêm người tạo, ngày và một message, nên được khuyên dùng cho bản phát hành.',
        ],
        note: {
          kind: 'tip',
          text: 'Dùng annotated tag cho bản phát hành — có người tạo, ngày và ghi chú đi kèm.',
        },
      },
      {
        heading: 'Các lệnh hay dùng',
        code: [
          'git tag v1.0.0                       # lightweight tag',
          'git tag -a v1.0.0 -m "Bản đầu tiên"   # annotated tag',
          'git tag                               # liệt kê tag',
          'git push origin v1.0.0                # đẩy một tag lên remote',
          'git push origin --tags                # đẩy mọi tag',
          'git tag -d v1.0.0                     # xoá tag trên máy',
          'git push origin --delete v1.0.0       # xoá tag trên remote',
        ],
      },
      {
        heading: 'Tạo tag trong Thaigit',
        steps: [
          'Chuột phải vào commit trên graph, chọn “Tạo tag tại đây…”.',
          'Nhập tên tag. Điền thêm message nếu muốn tạo annotated tag.',
          'Muốn đưa lên remote: kéo nhãn tag thả lên remote (origin) để push. Tag hiện ngay trên graph.',
          'Xoá nhầm tag? Bấm Hoàn tác hoặc Khôi phục tag.',
        ],
        shot: 'drag',
      },
    ],
    faq: [
      {
        q: 'Đặt tên tag thế nào?',
        a: [
          'Phổ biến nhất là dạng v + số phiên bản theo semver, ví dụ v1.2.3: số đầu tăng khi thay đổi lớn, số giữa khi thêm tính năng, số cuối khi sửa lỗi.',
        ],
      },
      {
        q: 'Tag có tự đẩy lên remote khi push không?',
        a: ['Không. Mặc định git push không gửi tag, bạn phải push tag riêng (git push origin <tag>).'],
      },
    ],
  },
  ssh: {
    title: 'Tạo khoá SSH để dùng GitHub, GitLab không cần nhập mật khẩu',
    short: 'Khoá SSH GitHub',
    description:
      'Cách tạo khoá SSH (ed25519), thêm khoá công khai lên GitHub / GitLab và clone repo bằng git@github.com. Làm bằng dòng lệnh hoặc tạo khoá ngay trong Thaigit.',
    intro: [
      'Mỗi lần push lên GitHub mà phải gõ lại mật khẩu hay token rất phiền. Khoá SSH giải quyết việc này: bạn tạo một cặp khoá, đưa nửa công khai lên GitHub, và máy tự chứng minh danh tính mỗi lần kết nối.',
      'Lưu ý: GitHub không còn nhận mật khẩu tài khoản khi dùng Git qua HTTPS — bạn cần dùng khoá SSH hoặc Personal access token.',
    ],
    sections: [
      {
        heading: 'Tạo khoá bằng dòng lệnh',
        steps: [
          'Chạy lệnh ssh-keygen với kiểu ed25519 (loại GitHub và GitLab khuyên dùng).',
          'Bấm Enter để lưu ở vị trí mặc định; đặt passphrase nếu muốn bảo vệ thêm.',
          'In nội dung khoá công khai (file .pub) rồi sao chép.',
        ],
        code: [
          'ssh-keygen -t ed25519 -C "may-cua-an"',
          'cat ~/.ssh/id_ed25519.pub     # macOS / Linux',
          'type %USERPROFILE%\\.ssh\\id_ed25519.pub   # Windows (cmd)',
        ],
        note: {
          kind: 'warn',
          text: 'Chỉ chia sẻ file .pub. Khoá riêng (file không có đuôi) tuyệt đối không gửi cho ai.',
        },
      },
      {
        heading: 'Thêm khoá công khai lên GitHub',
        steps: [
          'Vào GitHub → Settings → SSH and GPG keys → New SSH key.',
          'Đặt tên dễ nhận ra (ví dụ “MacBook công ty”), dán khoá công khai vào ô Key rồi lưu.',
          'Kiểm tra kết nối bằng ssh -T git@github.com.',
          'Với GitLab thì vào Preferences → SSH Keys, các bước tương tự.',
        ],
        code: ['ssh -T git@github.com', 'git clone git@github.com:ten-ban/du-an.git'],
      },
      {
        heading: 'Tạo khoá ngay trong Thaigit',
        steps: [
          'Mở Cài đặt → Khoá SSH, bấm “Tạo khoá mới” và đặt tên theo máy.',
          'Bấm “Sao chép khoá công khai”, dán lên GitHub / GitLab như bước trên.',
          'Từ đó clone, fetch, push repo dạng git@github.com:… mà không cần cấu hình ssh-agent hay thư mục .ssh.',
          'Không dùng khoá nữa? Xoá khoá trong Thaigit và nhớ gỡ khoá công khai trên GitHub / GitLab.',
        ],
        shot: 'welcome',
      },
    ],
    faq: [
      {
        q: 'Khoá riêng (private key) có được chia sẻ không?',
        a: [
          'Tuyệt đối không. Chỉ file .pub (khoá công khai) mới đưa lên GitHub. Ai có khoá riêng là giả danh được bạn.',
        ],
      },
      {
        q: 'SSH hay HTTPS tiện hơn?',
        a: [
          'SSH tiện khi dùng lâu dài vì không phải nhập lại thông tin. HTTPS với token thì dễ cài hơn lúc đầu, nhất là trên máy mượn hoặc sau tường lửa chặn cổng 22.',
        ],
      },
    ],
  },
};
