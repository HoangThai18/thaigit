import type { GuideText } from './guide-types';

export const GUIDES_VI: Record<string, GuideText> = {
  conflict: {
    title: 'Cách giải quyết conflict (xung đột) trong Git — dễ hiểu cho người mới',
    short: 'Giải conflict Git',
    description:
      'Conflict Git là gì, vì sao xảy ra khi merge / rebase / pull, đọc các dấu <<<<<<< ======= >>>>>>> thế nào và cách giải quyết bằng lệnh hoặc bằng vài cú bấm trong Gitlane.',
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
        heading: 'Giải conflict bằng Gitlane',
        paragraphs: [
          'Gitlane hiện banner cho biết đang merge, rebase hay cherry-pick, kèm danh sách file xung đột. Bấm vào file để mở trình giải xung đột: mỗi khối được tách riêng, không cần tự xoá dấu.',
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
          'Được. Nếu chưa commit, chạy git merge --abort (hoặc bấm Huỷ trong Gitlane) để làm lại từ đầu. Nếu đã commit, bấm Hoàn tác trong Gitlane hoặc dùng git reset để quay lại.',
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
      'Cách chỉ đưa một phần thay đổi của file vào commit: git add -p trên dòng lệnh và cách chọn từng dòng để Stage / Huỷ trong Gitlane.',
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
        heading: 'Stage từng dòng trong Gitlane',
        steps: [
          'Chọn file trong mục “Chưa stage” để xem diff.',
          'Bấm vào một dòng để chọn, Shift + bấm để chọn cả đoạn liên tiếp.',
          'Bấm “Stage dòng” để đưa những dòng đó vào commit, hoặc “Huỷ dòng” để bỏ hẳn thay đổi đó khỏi file.',
          'Lặp lại cho phần khác, viết message rồi commit.',
        ],
        shot: 'diff-lines',
        paragraphs: [
          'Lỡ huỷ nhầm? Bấm Hoàn tác ngay sau đó. Gitlane giữ nguyên từng byte của file (kể cả xuống dòng CRLF hay file không phải UTF-8) khi stage một phần.',
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
      'Lỡ commit sai, commit nhầm file hay sai message? So sánh git reset, git revert, git commit --amend — khi nào dùng cái nào — và cách hoàn tác bằng một nút trong Gitlane.',
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
        heading: 'Hoàn tác trong Gitlane',
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
      'Giải thích dễ hiểu git merge và git rebase, ưu nhược điểm, quy tắc vàng khi rebase, và cách merge / rebase bằng kéo & thả trong Gitlane.',
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
        heading: 'Merge / rebase bằng kéo & thả trong Gitlane',
        steps: [
          'Kéo nhãn nhánh trên graph (hoặc ở sidebar) rồi thả lên nhánh đích.',
          'Gitlane hỏi bạn muốn merge, rebase hay fast-forward — không có gì chạy ngầm ngoài ý muốn.',
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
      'Dùng git stash để cất tạm code đang làm dở khi cần chuyển nhánh gấp: stash, stash pop, apply, list, drop — và cách làm bằng một nút trong Gitlane.',
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
        heading: 'Stash trong Gitlane',
        steps: [
          'Bấm Stash trên thanh công cụ để cất mọi thay đổi chưa commit, hoặc chọn “Stash kèm message…” để đặt tên dễ nhớ.',
          'Khi chuyển nhánh mà đang có thay đổi, Gitlane đề xuất “Stash rồi checkout” — một bước là xong.',
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
    title: 'Cách cài Git trên Windows 10 / 11 và macOS cho người mới (kèm Git Bash)',
    short: 'Cài đặt Git',
    description:
      'Hướng dẫn tải và cài Git cho Windows 10 / 11 (Git for Windows, Git Bash) và macOS (xcode-select hoặc Homebrew), kiểm tra git --version, cấu hình tên, email rồi mở repository đầu tiên.',
    intro: [
      'Muốn dùng bất kỳ phần mềm Git nào — dòng lệnh hay Git GUI — máy cần có Git trước. Cài mất vài phút và chỉ làm một lần.',
    ],
    sections: [
      {
        heading: 'Kiểm tra máy đã có Git chưa',
        paragraphs: [
          'Mở Terminal (macOS) hoặc PowerShell (Windows) và chạy lệnh dưới đây. Nếu hiện số phiên bản như git version 2.4x là đã có Git, bỏ qua bước cài.',
        ],
        code: ['git --version'],
      },
      {
        heading: 'Cài Git trên Windows 10 / 11',
        steps: [
          'Tải Git for Windows tại git-scm.com/download/win — đây là trang chính thức, bản 64-bit hợp với hầu hết máy.',
          'Chạy file .exe vừa tải. Giữ các lựa chọn mặc định là được; ở bước chọn trình soạn thảo, có thể đổi sang Visual Studio Code nếu bạn đang dùng.',
          'Cài xong, mở PowerShell hoặc Git Bash rồi chạy git --version để kiểm tra.',
        ],
        code: ['winget install --id Git.Git -e', 'git --version'],
        note: {
          kind: 'tip',
          text: 'Đã có winget (sẵn trên Windows 10 / 11 bản mới)? Lệnh winget ở trên cài Git chỉ bằng một dòng.',
        },
      },
      {
        heading: 'Git Bash là gì?',
        paragraphs: [
          'Git Bash được cài kèm Git for Windows: một cửa sổ dòng lệnh giống terminal Linux / macOS, có sẵn git, ls, cat, ssh-keygen… Nhiều hướng dẫn trên mạng viết lệnh cho Bash, nên dùng Git Bash sẽ chạy được y nguyên.',
          'Không thích gõ lệnh? Bạn không bắt buộc phải mở Git Bash — Git GUI như Gitlane dùng Git đã cài và cho bạn làm mọi việc bằng chuột.',
        ],
      },
      {
        heading: 'Cài Git trên macOS (MacBook, iMac)',
        paragraphs: [
          'Cách dễ nhất: mở Terminal và chạy lệnh xcode-select. macOS sẽ hỏi cài Command Line Tools — bấm Cài đặt, chờ vài phút, xong kiểm tra bằng git --version.',
          'Nếu đã dùng Homebrew, có thể cài bản Git mới nhất bằng brew install git.',
        ],
        code: ['xcode-select --install', 'git --version', '# hoặc, nếu có Homebrew:', 'brew install git'],
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
        heading: 'Bắt đầu với Gitlane',
        steps: [
          'Tải Gitlane cho macOS hoặc Windows (miễn phí, không cần tài khoản).',
          'Ở màn hình chào, chọn mở thư mục có sẵn, clone từ GitHub / GitLab, hoặc tạo repository mới.',
          'Graph lịch sử hiện ngay — từ đây commit, pull, push bằng nút bấm.',
        ],
        shot: 'welcome',
      },
    ],
    faq: [
      {
        q: 'Tải Git ở đâu cho an toàn?',
        a: [
          'Tải từ trang chính thức git-scm.com (Windows: git-scm.com/download/win). Trên macOS, Git đi kèm Command Line Tools của Apple hoặc cài qua Homebrew. Tránh các trang tải phần mềm trung gian.',
        ],
      },
      {
        q: 'Cài Git cho Windows 10 và Windows 11 có khác nhau không?',
        a: ['Không. Cùng một bộ cài Git for Windows, các bước giống hệt nhau.'],
      },
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
      'Dùng git cherry-pick để chép riêng một hoặc vài commit sang nhánh khác mà không merge cả nhánh. Cách dùng, xử lý conflict, và cherry-pick bằng chuột phải trong Gitlane.',
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
        heading: 'Cherry-pick trong Gitlane',
        steps: [
          'Chuột phải vào commit trên graph, chọn Cherry-pick vào <nhánh>.',
          'Gitlane chạy và báo kết quả. Nếu có conflict, banner “Đang cherry-pick” hiện ra cùng trình giải xung đột (xem bài Giải conflict Git).',
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
      'Cách dùng .gitignore để Git không theo dõi file rác, file build, file bí mật (.env). Cú pháp cơ bản, xử lý file lỡ commit, và thêm nhanh vào .gitignore bằng Gitlane.',
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
        heading: 'Thêm vào .gitignore bằng Gitlane',
        steps: [
          'Trong danh sách “Chưa stage”, chuột phải vào file hoặc thư mục cần bỏ qua.',
          'Chọn “Thêm vào .gitignore”. Gitlane ghi mẫu phù hợp vào file .gitignore và báo lại đã thêm gì.',
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
      'So sánh git fetch và git pull, pull merge hay pull rebase, khi nào dùng fast-forward only, và cách chọn kiểu pull trong Gitlane.',
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
        heading: 'Fetch và pull trong Gitlane',
        steps: [
          'Bấm Fetch trên thanh công cụ để cập nhật mọi remote; Gitlane cũng tự fetch định kỳ.',
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
      'Git tag dùng để đánh dấu một commit quan trọng như phiên bản v1.0. Phân biệt lightweight và annotated tag, cách tạo, push, xoá tag, và tạo tag bằng chuột phải trong Gitlane.',
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
        heading: 'Tạo tag trong Gitlane',
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
      'Cách tạo khoá SSH (ed25519), thêm khoá công khai lên GitHub / GitLab và clone repo bằng git@github.com. Làm bằng dòng lệnh hoặc tạo khoá ngay trong Gitlane.',
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
        heading: 'Tạo khoá ngay trong Gitlane',
        steps: [
          'Mở Cài đặt → Khoá SSH, bấm “Tạo khoá mới” và đặt tên theo máy.',
          'Bấm “Sao chép khoá công khai”, dán lên GitHub / GitLab như bước trên.',
          'Từ đó clone, fetch, push repo dạng git@github.com:… mà không cần cấu hình ssh-agent hay thư mục .ssh.',
          'Không dùng khoá nữa? Xoá khoá trong Gitlane và nhớ gỡ khoá công khai trên GitHub / GitLab.',
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
  'git-gui': {
    title: 'Top phần mềm Git GUI miễn phí tốt nhất 2026 cho Windows và macOS',
    short: 'Phần mềm Git GUI',
    description:
      'So sánh các phần mềm Git GUI (Git client có giao diện) phổ biến nhất 2026: Gitlane, GitHub Desktop, Sourcetree, GitKraken, Fork, TortoiseGit — giá, hệ điều hành và nên chọn cái nào.',
    intro: [
      'Phần mềm Git GUI (còn gọi là Git client) giúp bạn dùng Git bằng chuột thay vì gõ lệnh: xem lịch sử commit dạng graph, commit, tạo nhánh, merge, pull, push chỉ bằng nút bấm. Bài này so sánh các phần mềm Git GUI phổ biến nhất hiện nay để bạn chọn đúng cái hợp với mình.',
      'Giá và tính năng của các app có thể thay đổi theo thời gian — trước khi mua, hãy xem lại trang chủ của từng app.',
    ],
    sections: [
      {
        heading: 'Git GUI là gì? Có cần không?',
        paragraphs: [
          'Git vốn là công cụ dòng lệnh. Git GUI là lớp giao diện đặt lên trên: nó vẫn gọi đúng Git bên dưới, nhưng hiển thị nhánh, commit và thay đổi trực quan để bạn bấm thay vì nhớ lệnh.',
          'Người mới đỡ sợ gõ sai lệnh; người làm lâu năm thì xem graph, stage từng dòng và giải conflict nhanh hơn. Vì mọi Git GUI dùng chung repo Git chuẩn, bạn vẫn có thể mở terminal làm song song bất cứ lúc nào.',
        ],
      },
      {
        heading: 'Bảng so sánh nhanh',
        table: {
          head: ['Phần mềm', 'Giá', 'Hệ điều hành', 'Hợp với'],
          rows: [
            [
              'Gitlane',
              'Miễn phí, không cần tài khoản',
              'Windows 10 / 11, macOS 11+',
              'Muốn làm Git bằng chuột, kéo & thả, giao diện tiếng Việt',
            ],
            ['GitHub Desktop', 'Miễn phí, mã nguồn mở', 'Windows, macOS', 'Người mới, chủ yếu dùng GitHub'],
            ['Sourcetree', 'Miễn phí', 'Windows, macOS', 'Cần nhiều tuỳ chọn, dùng Bitbucket / Jira'],
            [
              'GitKraken Desktop',
              'Miễn phí cho repo cục bộ và công khai; repo riêng tư cần gói trả phí',
              'Windows, macOS, Linux',
              'Nhóm cần tích hợp GitHub, GitLab, Jira',
            ],
            [
              'Fork',
              'Dùng thử miễn phí, bản quyền trả một lần',
              'Windows, macOS',
              'Muốn app nhanh, sẵn sàng trả phí',
            ],
            [
              'TortoiseGit',
              'Miễn phí, mã nguồn mở',
              'Windows',
              'Quen thao tác chuột phải trong File Explorer',
            ],
            [
              'git-gui + gitk',
              'Miễn phí, có sẵn trong Git',
              'Windows, macOS, Linux',
              'Thao tác cơ bản, không cài thêm',
            ],
          ],
        },
      },
      {
        heading: 'Gitlane — miễn phí, kéo & thả, giao diện tiếng Việt',
        paragraphs: [
          'Gitlane là Git GUI miễn phí cho Windows và macOS, không quảng cáo, không cần tài khoản và không giới hạn repo riêng tư. Đây là một trong số ít Git client có giao diện tiếng Việt (có cả tiếng Anh).',
          'Điểm khác biệt là cách làm bằng chuột: kéo nhánh thả lên nhánh khác để merge hoặc rebase, kéo nhánh lên remote để push, bấm chọn từng dòng để stage, và giải conflict bằng vài cú bấm thay vì tự xoá dấu <<<<<<<. Graph lịch sử nhiều màu, mở repo 30.000 commit trong khoảng một giây, app tự cập nhật.',
        ],
        shot: 'drag',
      },
      {
        heading: 'GitHub Desktop',
        paragraphs: [
          'Ứng dụng chính chủ của GitHub, miễn phí và mã nguồn mở. Rất dễ dùng cho người mới: clone, commit, tạo pull request đều gọn. Bù lại, lịch sử hiển thị dạng danh sách chứ không có graph nhánh, và nhiều thao tác nâng cao vẫn phải quay về terminal.',
        ],
      },
      {
        heading: 'Sourcetree',
        paragraphs: [
          'Git client miễn phí lâu đời của Atlassian, nhiều tính năng: graph, interactive rebase, Git-flow, submodule. Giao diện nhiều nút và tuỳ chọn nên người mới dễ rối, và nhiều người dùng phản ánh app chậm dần khi repo lớn.',
        ],
      },
      {
        heading: 'GitKraken Desktop',
        paragraphs: [
          'Graph đẹp, có kéo & thả, tích hợp sâu với GitHub, GitLab, Bitbucket, Azure DevOps và Jira, chạy được cả trên Linux. Bản miễn phí chỉ dùng với repo cục bộ và repo công khai; làm việc với repo riêng tư trên máy chủ cần gói trả phí.',
        ],
      },
      {
        heading: 'Fork, TortoiseGit và các lựa chọn khác',
        steps: [
          'Fork: nhanh, giao diện gọn, có bản dùng thử miễn phí và bản quyền trả một lần.',
          'TortoiseGit: gắn vào menu chuột phải của File Explorer, chỉ có trên Windows.',
          'Tower, Sublime Merge: mạnh nhưng trả phí.',
          'SmartGit: miễn phí cho mục đích phi thương mại, dùng cho công việc thì trả phí.',
          'VS Code, JetBrains: Git có sẵn trong trình soạn thảo, tiện cho thao tác nhanh nhưng khó xem toàn cảnh nhánh.',
        ],
      },
      {
        heading: 'Nên chọn phần mềm Git GUI nào?',
        steps: [
          'Mới học Git, muốn miễn phí hoàn toàn và có tiếng Việt: Gitlane.',
          'Làm việc với repo riêng tư mà không muốn trả phí: Gitlane, GitHub Desktop hoặc Sourcetree.',
          'Chỉ dùng GitHub và cần thật đơn giản: GitHub Desktop hoặc Gitlane.',
          'Cần chạy trên Linux: GitKraken, SmartGit hoặc git-gui.',
          'Cần tích hợp issue, pull request, Jira ngay trong app: GitKraken.',
        ],
        note: {
          kind: 'tip',
          text: 'Các Git GUI đều đọc chung một repo Git chuẩn, nên bạn có thể cài thử vài app trên cùng một repo rồi giữ lại cái thấy thuận tay nhất.',
        },
      },
    ],
    faq: [
      {
        q: 'Phần mềm Git GUI miễn phí nào tốt nhất?',
        a: [
          'Tuỳ nhu cầu. Muốn miễn phí hoàn toàn (kể cả repo riêng tư), không cần tài khoản và có giao diện tiếng Việt thì chọn Gitlane. Chỉ làm việc với GitHub và cần thật đơn giản thì GitHub Desktop cũng là lựa chọn tốt.',
        ],
      },
      {
        q: 'Có phần mềm Git GUI tiếng Việt không?',
        a: [
          'Có. Gitlane có giao diện tiếng Việt và tiếng Anh, chạy trên Windows 10 / 11 và macOS 11 trở lên.',
        ],
      },
      {
        q: 'Dùng Git GUI có cần biết lệnh Git không?',
        a: [
          'Không bắt buộc — các việc thường ngày đều có nút bấm. Nhưng hiểu commit, nhánh, merge là gì sẽ giúp bạn dùng tự tin hơn; các bài hướng dẫn của Gitlane giải thích từng khái niệm kèm lệnh tương ứng.',
        ],
      },
      {
        q: 'Git GUI có làm khác đi repo so với dùng lệnh không?',
        a: [
          'Không. Gitlane gọi thẳng git trên máy bạn, nên kết quả giống hệt khi gõ lệnh trong terminal — chỉ dễ nhìn và dễ bấm hơn.',
        ],
      },
      {
        q: 'Có cần cài Git trước khi dùng Git GUI không?',
        a: [
          'Một số app kèm sẵn Git riêng. Gitlane dùng Git đã cài trên máy: macOS chạy xcode-select --install, Windows cài Git for Windows — xem bài Cài đặt Git.',
        ],
      },
    ],
  },
  'alt-sourcetree': {
    title: 'Phần mềm thay thế Sourcetree miễn phí cho Windows và macOS',
    short: 'Thay thế Sourcetree',
    description:
      'Tìm phần mềm thay thế Sourcetree? So sánh Gitlane và Sourcetree: kéo & thả để merge, stage từng dòng, giải conflict, giao diện tiếng Việt — và cách chuyển sang trong một phút.',
    intro: [
      'Sourcetree là Git client miễn phí lâu đời của Atlassian và vẫn được nhiều người dùng. Nếu bạn thấy Sourcetree quá nhiều nút, chậm với repo lớn, hoặc chỉ muốn một giao diện tiếng Việt gọn gàng hơn, Gitlane là lựa chọn miễn phí đáng thử.',
    ],
    sections: [
      {
        heading: 'Gitlane và Sourcetree khác nhau thế nào?',
        table: {
          head: ['Tiêu chí', 'Gitlane', 'Sourcetree'],
          rows: [
            ['Giá', 'Miễn phí, không quảng cáo', 'Miễn phí'],
            ['Hệ điều hành', 'Windows 10 / 11, macOS 11+', 'Windows, macOS'],
            [
              'Merge, rebase, push',
              'Kéo nhánh thả lên nhánh / remote, luôn hỏi lại',
              'Qua menu và hộp thoại',
            ],
            ['Stage từng dòng', 'Bấm chọn dòng, Shift để chọn liên tiếp', 'Theo hunk hoặc theo dòng'],
            [
              'Giải conflict',
              'Trình giải xung đột có sẵn, chọn từng khối',
              'Chọn cả file theo một bên hoặc mở công cụ merge ngoài',
            ],
            ['Git-flow', 'Chưa có mục riêng', 'Có'],
          ],
        },
      },
      {
        heading: 'Vì sao nhiều người tìm cách thay Sourcetree',
        paragraphs: [
          'Sourcetree mạnh nhưng nhồi nhiều tuỳ chọn lên cùng một màn hình, người mới dễ bấm nhầm. Nhiều người dùng cũng phản ánh app chậm dần khi repo có lịch sử dài.',
          'Gitlane đi theo hướng ngược lại: ít nút hơn, việc thường ngày làm bằng kéo & thả, mọi thao tác có hộp thoại hỏi lại và có nút hoàn tác. Repo 30.000 commit mở trong khoảng một giây.',
        ],
        shot: 'drag',
      },
      {
        heading: 'Chuyển từ Sourcetree sang Gitlane',
        steps: [
          'Tải Gitlane cho Windows hoặc macOS (miễn phí, không cần tài khoản).',
          'Mở đúng thư mục repo bạn đang dùng với Sourcetree — không cần import, không mất lịch sử, nhánh hay stash.',
          'Remote, nhánh và tag hiện ra ngay trên graph và sidebar.',
          'Gitlane dùng chính git trên máy nên khoá SSH và thông tin đăng nhập đã cấu hình cho git vẫn dùng được.',
        ],
        note: {
          kind: 'tip',
          text: 'Bạn có thể giữ Sourcetree và dùng song song một thời gian — hai app cùng đọc một repo Git chuẩn.',
        },
      },
    ],
    faq: [
      {
        q: 'Chuyển sang Gitlane có mất lịch sử commit không?',
        a: [
          'Không. Lịch sử, nhánh, tag và stash nằm trong chính repo Git, Gitlane chỉ đọc và hiển thị chúng.',
        ],
      },
      {
        q: 'Gitlane có miễn phí như Sourcetree không?',
        a: ['Có. Gitlane miễn phí, không quảng cáo, không cần tài khoản và không giới hạn repo riêng tư.'],
      },
    ],
  },
  'alt-github-desktop': {
    title: 'Phần mềm thay thế GitHub Desktop: có graph nhánh, kéo & thả để merge',
    short: 'Thay thế GitHub Desktop',
    description:
      'So sánh Gitlane và GitHub Desktop: graph lịch sử nhiều màu, kéo & thả để merge / rebase / push, giải conflict ngay trong app, giao diện tiếng Việt — miễn phí cho Windows và macOS.',
    intro: [
      'GitHub Desktop đơn giản và miễn phí, rất hợp lúc mới học Git. Khi dự án có nhiều nhánh, bạn sẽ muốn nhìn thấy các nhánh tách ra, nhập lại thế nào và merge nhanh hơn — đó là lúc nên thử một Git GUI có graph như Gitlane.',
    ],
    sections: [
      {
        heading: 'Gitlane và GitHub Desktop khác nhau thế nào?',
        table: {
          head: ['Tiêu chí', 'Gitlane', 'GitHub Desktop'],
          rows: [
            ['Giá', 'Miễn phí', 'Miễn phí, mã nguồn mở'],
            ['Graph lịch sử', 'Graph nhiều màu, thấy mọi nhánh', 'Danh sách commit của nhánh hiện tại'],
            ['Merge, rebase, push', 'Kéo & thả trên graph hoặc sidebar', 'Qua menu Branch'],
            ['Stage từng dòng', 'Có', 'Có'],
            [
              'Giải conflict',
              'Trình giải xung đột ngay trong app',
              'Chọn cả file theo một bên hoặc mở trình soạn thảo',
            ],
            ['Dịch vụ remote', 'GitHub, GitLab, Bitbucket, máy chủ Git bất kỳ', 'Tối ưu cho GitHub'],
            ['Giao diện tiếng Việt', 'Có', 'Không'],
          ],
        },
      },
      {
        heading: 'Thấy toàn cảnh nhánh bằng graph',
        paragraphs: [
          'Graph của Gitlane vẽ mỗi nhánh một màu, nên bạn thấy ngay nhánh nào tách từ đâu, đã merge chưa, đang đứng ở commit nào. Nhấn ⌘B / Ctrl+B để tìm và chuyển nhánh trong một giây.',
        ],
        shot: 'overview-dark',
      },
      {
        heading: 'Chuyển từ GitHub Desktop sang Gitlane',
        steps: [
          'Tải Gitlane cho Windows hoặc macOS.',
          'Mở thư mục repo bạn đã clone bằng GitHub Desktop — không cần clone lại.',
          'Pull, push, tạo nhánh như cũ, chỉ khác là làm được bằng kéo & thả.',
        ],
        note: {
          kind: 'tip',
          text: 'Gitlane dùng git trên máy. Nếu trước giờ chỉ dùng GitHub Desktop, hãy cài Git (xem bài Cài đặt Git) và tạo khoá SSH hoặc token để push lên GitHub.',
        },
      },
    ],
    faq: [
      {
        q: 'Gitlane có dùng được với GitHub không?',
        a: [
          'Có. Gitlane làm việc với mọi remote Git: GitHub, GitLab, Bitbucket hay máy chủ riêng của công ty.',
        ],
      },
      {
        q: 'Có thể dùng cả GitHub Desktop và Gitlane không?',
        a: ['Được. Hai app cùng đọc một repo Git chuẩn, bạn dùng song song thoải mái.'],
      },
    ],
  },
  'alt-gitkraken': {
    title: 'Phần mềm thay thế GitKraken miễn phí, dùng được cả repo riêng tư',
    short: 'Thay thế GitKraken',
    description:
      'So sánh Gitlane và GitKraken Desktop: graph nhiều màu, kéo & thả để merge — miễn phí cả với repo riêng tư, không cần tài khoản, giao diện tiếng Việt cho Windows và macOS.',
    intro: [
      'GitKraken nổi tiếng với graph đẹp và kéo & thả, nhưng bản miễn phí chỉ dùng với repo cục bộ và repo công khai. Nếu bạn cần làm việc với repo riêng tư mà không muốn trả phí hằng tháng, Gitlane có cách làm tương tự và miễn phí hoàn toàn.',
    ],
    sections: [
      {
        heading: 'Gitlane và GitKraken khác nhau thế nào?',
        table: {
          head: ['Tiêu chí', 'Gitlane', 'GitKraken Desktop'],
          rows: [
            [
              'Giá',
              'Miễn phí, kể cả repo riêng tư',
              'Miễn phí cho repo cục bộ và công khai; repo riêng tư cần gói trả phí',
            ],
            ['Hệ điều hành', 'Windows 10 / 11, macOS 11+', 'Windows, macOS, Linux'],
            ['Graph nhiều màu', 'Có', 'Có'],
            ['Kéo & thả để merge, rebase, push', 'Có', 'Có'],
            ['Tích hợp issue, pull request, Jira', 'Chưa có', 'Có'],
          ],
        },
      },
      {
        heading: 'Kéo & thả như GitKraken, nhưng miễn phí',
        paragraphs: [
          'Trong Gitlane, kéo nhãn nhánh trên graph rồi thả lên nhánh khác để merge, rebase hoặc fast-forward; thả lên remote để push. Luôn có hộp thoại hỏi lại, không có gì chạy ngầm ngoài ý muốn.',
        ],
        shot: 'drag',
      },
      {
        heading: 'Khi nào GitKraken vẫn hợp hơn?',
        paragraphs: [
          'Nếu nhóm bạn cần xem issue, pull request và Jira ngay trong Git client, hoặc phải chạy trên Linux, GitKraken vẫn là lựa chọn mạnh. Còn nếu chủ yếu commit, tạo nhánh, merge và giải conflict, Gitlane đủ dùng mà không tốn phí.',
        ],
      },
    ],
    faq: [
      {
        q: 'Gitlane có giới hạn repo riêng tư không?',
        a: [
          'Không. Gitlane miễn phí với mọi repo, riêng tư hay công khai, trên GitHub, GitLab, Bitbucket hay máy chủ riêng.',
        ],
      },
      {
        q: 'Có cần tạo tài khoản để dùng Gitlane không?',
        a: ['Không cần. Tải về, mở repo là dùng được ngay.'],
      },
    ],
  },
};
