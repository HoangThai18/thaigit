import type { FaqItem } from './content';
import type { ShotName } from './shots';

export interface GuideSection {
  heading: string;
  paragraphs?: string[];
  /** Các bước làm theo thứ tự. */
  steps?: string[];
  /** Lệnh git tương đương, mỗi phần tử một dòng. */
  code?: string[];
  /** Nội dung file mẫu (không phải lệnh), mỗi phần tử một dòng. */
  sample?: string[];
  shot?: ShotName;
}

export interface Guide {
  slug: string;
  title: string;
  /** Tiêu đề ngắn cho thẻ ở trang danh sách. */
  short: string;
  description: string;
  /** `YYYY-MM-DD` */
  updated: string;
  minutes: number;
  intro: string[];
  sections: GuideSection[];
  faq: FaqItem[];
}

/** Bài hướng dẫn ở /huong-dan/ — mỗi bài trả lời một câu hỏi người dùng hay tìm, kèm cách làm bằng lệnh và bằng Thaigit. */
export const GUIDES: Guide[] = [
  {
    slug: 'giai-conflict-git',
    title: 'Cách giải quyết conflict (xung đột) trong Git — dễ hiểu cho người mới',
    short: 'Giải conflict Git',
    description:
      'Conflict Git là gì, vì sao xảy ra khi merge / rebase / pull, đọc các dấu <<<<<<< ======= >>>>>>> thế nào và cách giải quyết bằng lệnh hoặc bằng vài cú bấm trong Thaigit.',
    updated: '2026-10-05',
    minutes: 6,
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
  {
    slug: 'stage-tung-dong',
    title: 'Stage từng dòng trong Git (thay cho git add -p) — commit gọn, đúng ý',
    short: 'Stage từng dòng',
    description:
      'Cách chỉ đưa một phần thay đổi của file vào commit: git add -p trên dòng lệnh và cách chọn từng dòng để Stage / Huỷ trong Thaigit.',
    updated: '2026-10-05',
    minutes: 4,
    intro: [
      'Bạn sửa một file cho hai việc khác nhau — sửa lỗi và thêm tính năng — nhưng muốn tách thành hai commit riêng. Lúc đó cần stage từng phần (từng hunk hoặc từng dòng) thay vì cả file.',
    ],
    sections: [
      {
        heading: 'Staging area là gì?',
        paragraphs: [
          'Git có một “vùng chờ” (index / staging area) nằm giữa thư mục làm việc và commit. Chỉ những gì đã stage mới vào commit kế tiếp. Nhờ vậy bạn chọn chính xác thay đổi nào được commit.',
        ],
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
  {
    slug: 'hoan-tac-commit',
    title: 'Cách hoàn tác (undo) commit trong Git: reset, revert, amend',
    short: 'Hoàn tác commit',
    description:
      'Lỡ commit sai, commit nhầm file hay sai message? So sánh git reset, git revert, git commit --amend — khi nào dùng cái nào — và cách hoàn tác bằng một nút trong Thaigit.',
    updated: '2026-10-05',
    minutes: 5,
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
  {
    slug: 'merge-va-rebase',
    title: 'Git merge và rebase khác nhau thế nào? Khi nào dùng cái nào',
    short: 'Merge hay rebase',
    description:
      'Giải thích dễ hiểu git merge và git rebase, ưu nhược điểm, quy tắc vàng khi rebase, và cách merge / rebase bằng kéo & thả trong Thaigit.',
    updated: '2026-10-05',
    minutes: 6,
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
  {
    slug: 'git-stash',
    title: 'Git stash là gì? Cất tạm thay đổi để chuyển nhánh',
    short: 'Git stash',
    description:
      'Dùng git stash để cất tạm code đang làm dở khi cần chuyển nhánh gấp: stash, stash pop, apply, list, drop — và cách làm bằng một nút trong Thaigit.',
    updated: '2026-10-05',
    minutes: 4,
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
  {
    slug: 'cai-dat-git',
    title: 'Cài đặt Git trên macOS và Windows cho người mới bắt đầu',
    short: 'Cài đặt Git',
    description:
      'Hướng dẫn cài Git trên macOS (xcode-select) và Windows (Git for Windows), cấu hình tên và email, rồi mở hoặc clone repository đầu tiên bằng Thaigit.',
    updated: '2026-10-05',
    minutes: 4,
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
];

export function findGuide(slug: string): Guide | undefined {
  return GUIDES.find((guide) => guide.slug === slug);
}
