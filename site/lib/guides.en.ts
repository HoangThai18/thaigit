import type { GuideText } from './guide-types';

export const GUIDES_EN: Record<string, GuideText> = {
  conflict: {
    title: 'How to resolve merge conflicts in Git — a beginner-friendly guide',
    short: 'Resolve conflicts',
    description:
      'What a Git merge conflict is, why it happens on merge / rebase / pull, how to read the <<<<<<< ======= >>>>>>> markers, and how to resolve it from the command line or in a few clicks with Thaigit.',
    intro: [
      'A conflict happens when two branches change the same spot in a file and Git cannot decide which version to keep. It is completely normal in team work — nothing is broken, Git is just waiting for you to choose.',
    ],
    sections: [
      {
        heading: 'When do conflicts happen?',
        paragraphs: [
          'A conflict can appear when you merge, rebase, cherry-pick, revert, pull or re-apply a stash. Git stops halfway, marks the conflicting files and waits for you to resolve them before it continues.',
        ],
      },
      {
        heading: 'Reading the conflict markers',
        paragraphs: [
          'In a conflicting file Git inserts three kinds of markers. The part between <<<<<<< and ======= is the current version (Current — the branch you are on); the part between ======= and >>>>>>> is the incoming version (Incoming — the branch being merged in).',
          'Note: during a rebase the roles are reversed — Current is the branch you are rebasing onto, Incoming is your own commit.',
        ],
        sample: [
          '<<<<<<< HEAD',
          'const price = 120000;',
          '=======',
          'const price = 99000;',
          '>>>>>>> feature/promotion',
        ],
      },
      {
        heading: 'Resolving from the command line',
        steps: [
          'Run git status to see which files conflict (the “Unmerged paths” section).',
          'Open each file, keep the right part and delete the <<<<<<<, ======= and >>>>>>> lines.',
          'Mark the file as resolved with git add <file>.',
          'Continue: git commit (merge), git rebase --continue (rebase) or git cherry-pick --continue.',
          'To give up and go back to how things were: git merge --abort or git rebase --abort.',
        ],
        code: [
          'git status',
          'git add src/price.ts',
          'git commit            # or: git rebase --continue',
          'git merge --abort     # drop the merge, back to how it was',
        ],
        note: {
          kind: 'tip',
          text: 'Run git status at any moment — Git always tells you which step you are in and what to do next.',
        },
      },
      {
        heading: 'Resolving with Thaigit',
        paragraphs: [
          'Thaigit shows a banner saying whether you are merging, rebasing or cherry-picking, plus the list of conflicting files. Click a file to open the conflict resolver: every block is split out, so you never delete markers by hand.',
        ],
        steps: [
          'For each block choose Keep Current, Keep Incoming or keep both.',
          'Many similar blocks? Use the quick “Use all Current” or “Use all Incoming”.',
          'Preview the result, then click “Save & mark resolved”.',
          'When no conflicting files remain, click Continue on the banner. To stop, click Abort — everything returns to how it was before the merge.',
        ],
        shot: 'conflict',
      },
      {
        heading: 'Tips for fewer conflicts',
        steps: [
          'Pull often so your branch does not drift far from the main branch.',
          'Keep commits small, one thing per commit.',
          'Avoid reformatting a whole file (formatting, CRLF/LF changes) in the same commit as real changes.',
        ],
      },
    ],
    faq: [
      {
        q: 'Can I fix a wrong resolution?',
        a: [
          'Yes. If you have not committed yet, run git merge --abort (or click Abort in Thaigit) to start over. If you already committed, click Undo in Thaigit or use git reset to go back.',
        ],
      },
      {
        q: 'What are Current and Incoming?',
        a: [
          'Current is the version on the branch you are on (HEAD); Incoming is the version from the branch being brought in. During a rebase the two roles swap.',
        ],
      },
    ],
  },
  'stage-lines': {
    title: 'Stage line by line in Git (instead of git add -p) — clean, intentional commits',
    short: 'Stage line by line',
    description:
      'How to put only part of a file’s changes in a commit: git add -p on the command line, and how to pick single lines to Stage / Discard in Thaigit.',
    intro: [
      'You edited one file for two different reasons — fixing a bug and adding a feature — and want two separate commits. That is when you stage parts (hunks or single lines) instead of the whole file.',
    ],
    sections: [
      {
        heading: 'What is the staging area?',
        paragraphs: [
          'Git has a “waiting room” (the index / staging area) between your working directory and a commit. Only what is staged goes into the next commit, so you choose exactly which changes are committed.',
        ],
        note: {
          kind: 'tip',
          text: 'Review what is about to be committed with git diff --staged before you commit.',
        },
      },
      {
        heading: 'Using git add -p',
        paragraphs: [
          'git add -p walks through each hunk and asks: y (stage this hunk), n (skip), s (split it smaller), e (edit by hand), q (quit). To unstage part of a file use git restore --staged -p.',
        ],
        code: [
          'git add -p src/cart.ts',
          'git restore --staged -p src/cart.ts   # unstage part of a file',
          'git diff --staged                     # review what will be committed',
        ],
      },
      {
        heading: 'Staging lines in Thaigit',
        steps: [
          'Pick a file under “Unstaged” to see its diff.',
          'Click a line to select it; Shift+click to select a continuous range.',
          'Click “Stage lines” to put those lines in the commit, or “Discard lines” to throw those changes away.',
          'Repeat for other parts, write a message and commit.',
        ],
        shot: 'diff-lines',
        paragraphs: [
          'Discarded the wrong thing? Click Undo right away. Thaigit keeps every byte of the file intact (even CRLF line endings or non-UTF-8 files) when staging part of it.',
        ],
      },
    ],
    faq: [
      {
        q: 'What is the difference between staging a hunk and a line?',
        a: [
          'A hunk is a group of nearby changed lines. Staging by line is finer: you can pick a few lines inside a hunk without the manual edit mode (e) of git add -p.',
        ],
      },
    ],
  },
  undo: {
    title: 'How to undo a commit in Git: reset, revert and amend',
    short: 'Undo a commit',
    description:
      'Committed the wrong thing, the wrong file or a bad message? Compare git reset, git revert and git commit --amend — when to use each — and how to undo with one button in Thaigit.',
    intro: [
      'Committing by mistake happens to everyone. The right fix depends on one question: has the commit been pushed to a remote yet?',
    ],
    sections: [
      {
        heading: 'Not pushed yet: fix it freely',
        paragraphs: [
          'Wrong message or a forgotten file: use git commit --amend to fix the last commit. To drop the last commit but keep your code: git reset --soft HEAD~1 (changes stay staged). Use --mixed to keep the code but unstage it; --hard also deletes the changes — be careful.',
        ],
        code: [
          'git commit --amend -m "New message"',
          'git reset --soft HEAD~1    # drop the commit, keep changes staged',
          'git reset HEAD~1           # drop the commit, keep changes unstaged',
        ],
        note: {
          kind: 'warn',
          text: 'git reset --hard also deletes uncommitted changes, and there is no recycle bin. Use it only when you are sure.',
        },
      },
      {
        heading: 'Already pushed: use revert',
        paragraphs: [
          'If others have already pulled the commit, do not rewrite history. git revert creates a new commit that reverses the old one’s changes — safe for shared branches.',
        ],
        code: ['git revert a1b2c3d', 'git push'],
      },
      {
        heading: 'Lost code after reset --hard?',
        paragraphs: [
          'Git still remembers where HEAD used to be in the reflog. Find the old commit in git reflog and reset to it.',
        ],
        code: ['git reflog', 'git reset --hard HEAD@{1}'],
      },
      {
        heading: 'Undoing in Thaigit',
        steps: [
          'Right after a commit, checkout, pull, merge, rebase, reset, branch deletion or discard, click the Undo button on the toolbar to go back.',
          'Fix the last commit: tick “Amend previous commit” in the commit box, edit the message or stage more files, then commit again.',
          'A pushed commit: right-click it on the graph → “Revert this commit…”.',
          'Change the message of an older commit: right-click → “Edit commit message…”.',
        ],
        note: {
          kind: 'tip',
          text: 'Undo reverses the most recent git action — pressing it right after a slip is the safest.',
        },
        shot: 'overview',
      },
    ],
    faq: [
      {
        q: 'What is the difference between reset and revert?',
        a: [
          'reset moves the branch back to an older commit (rewrites history) — good for commits you have not pushed. revert creates a new commit that reverses a change and leaves history alone — use it for pushed commits.',
        ],
      },
      {
        q: 'What if I amend a commit that was already pushed?',
        a: [
          'Amend creates a new commit in place of the old one, so you must push --force-with-lease. Only do this on a branch that is yours alone.',
        ],
      },
    ],
  },
  'merge-rebase': {
    title: 'Git merge vs rebase: what is the difference and when to use each',
    short: 'Merge vs rebase',
    description:
      'A clear explanation of git merge and git rebase, their pros and cons, the golden rule of rebasing, and how to merge / rebase by drag & drop in Thaigit.',
    intro: [
      'Both merge and rebase bring changes from one branch into another. The difference is how the history looks afterwards.',
    ],
    sections: [
      {
        heading: 'Merge: keep the history as it happened',
        paragraphs: [
          'git merge joins two branches with a merge commit (unless a fast-forward is possible). History shows exactly what happened and no commit is rewritten — safe for shared branches, but the graph can get tangled when many people merge back and forth.',
        ],
        code: ['git switch main', 'git merge feature/cart'],
      },
      {
        heading: 'Rebase: a straight line of history',
        paragraphs: [
          'git rebase takes your branch’s commits and replays them on top of another branch. History becomes a single straight line that is easy to read — but the commits are recreated with new SHAs.',
        ],
        code: [
          'git switch feature/cart',
          'git rebase main',
          'git pull --rebase       # fetch new code without a merge commit',
        ],
      },
      {
        heading: 'The golden rule',
        paragraphs: [
          'Do not rebase commits that others already use. Rebasing your own branch before opening a pull request is fine; for shared branches like main, merge.',
        ],
        note: {
          kind: 'warn',
          text: 'Rebase rewrites history. Only rebase commits nobody else has pulled.',
        },
      },
      {
        heading: 'Merge / rebase by drag & drop in Thaigit',
        steps: [
          'Drag a branch label on the graph (or in the sidebar) and drop it on the target branch.',
          'Thaigit asks whether you want to merge, rebase or fast-forward — nothing runs behind your back.',
          'If there is a conflict, the conflict resolver opens right away (see the guide on resolving conflicts).',
          'Changed your mind? Click Undo merge / Undo rebase.',
        ],
        shot: 'drag',
        paragraphs: [
          'Want to tidy history before pushing (squash, reword, reorder, drop commits)? Right-click a commit to open interactive rebase with pick, reword, squash, fixup and drop.',
        ],
      },
    ],
    faq: [
      {
        q: 'What is a fast-forward?',
        a: [
          'When the target branch has no new commits since you branched off, Git only needs to move the branch pointer forward — no merge commit. That is a fast-forward.',
        ],
      },
      {
        q: 'Merge or rebase for a team?',
        a: [
          'Most common: rebase your own feature branch onto main to update it, then merge (or squash-merge) into main through a pull request.',
        ],
      },
    ],
  },
  stash: {
    title: 'What is git stash? Shelve changes to switch branches',
    short: 'Git stash',
    description:
      'Use git stash to shelve half-finished work when you must switch branches in a hurry: stash, stash pop, apply, list, drop — and the one-button way in Thaigit.',
    intro: [
      'Halfway through some code when an urgent fix comes up on another branch? You do not want a half-baked commit — stash it: Git puts your changes in a separate shelf and your working directory is clean again.',
    ],
    sections: [
      {
        heading: 'Common stash commands',
        code: [
          'git stash push -m "working on cart"   # shelve (add -u to include new files)',
          'git stash list                         # list stashes',
          'git stash pop                          # restore the latest stash and delete it',
          'git stash apply stash@{1}              # restore but keep the stash',
          'git stash drop stash@{1}               # delete a stash',
        ],
        paragraphs: [
          'By default git stash does not shelve untracked (newly created) files. Add -u if you want them too.',
        ],
        note: {
          kind: 'tip',
          text: 'Give a stash a message (git stash push -m …) so you still know what it is a few days later.',
        },
      },
      {
        heading: 'Stash in Thaigit',
        steps: [
          'Click Stash on the toolbar to shelve all uncommitted changes, or choose “Stash with message…” to give it a memorable name.',
          'When you switch branches with changes pending, Thaigit offers “Stash and checkout” — one step and done.',
          'Stashes live in the sidebar: Apply stash to restore, Drop stash when you no longer need it. Dropped by mistake? Click Undo.',
        ],
        shot: 'switch',
      },
    ],
    faq: [
      {
        q: 'What is the difference between stash pop and stash apply?',
        a: [
          'pop applies the changes and deletes the stash; apply applies the changes but keeps the stash for reuse. If applying hits a conflict, pop keeps the stash so you lose nothing.',
        ],
      },
    ],
  },
  install: {
    title: 'How to install Git on Windows 10 / 11 and macOS (with Git Bash)',
    short: 'Install Git',
    description:
      'Download and install Git on Windows 10 / 11 (Git for Windows, Git Bash) and macOS (xcode-select or Homebrew), check git --version, set your name and email, then open your first repository.',
    intro: [
      'To use any Git tool — command line or Git GUI — your machine needs Git first. Installing takes a few minutes and you only do it once.',
    ],
    sections: [
      {
        heading: 'Check whether Git is already installed',
        paragraphs: [
          'Open Terminal (macOS) or PowerShell (Windows) and run the command below. If it prints a version such as git version 2.4x, Git is already there and you can skip the install.',
        ],
        code: ['git --version'],
      },
      {
        heading: 'Install Git on Windows 10 / 11',
        steps: [
          'Download Git for Windows from git-scm.com/download/win — the official page; the 64-bit build suits most machines.',
          'Run the downloaded .exe. The default options are fine; at the editor step you can pick Visual Studio Code if you use it.',
          'When it finishes, open PowerShell or Git Bash and run git --version to check.',
        ],
        code: ['winget install --id Git.Git -e', 'git --version'],
        note: {
          kind: 'tip',
          text: 'Have winget (built into recent Windows 10 / 11)? The winget command above installs Git in one line.',
        },
      },
      {
        heading: 'What is Git Bash?',
        paragraphs: [
          'Git Bash comes with Git for Windows: a command window like the Linux / macOS terminal, with git, ls, cat, ssh-keygen and more. Many online tutorials are written for Bash, so they work as-is in Git Bash.',
          'Not a fan of typing commands? You don’t have to open Git Bash at all — a Git GUI such as Thaigit uses the installed Git and lets you do everything with the mouse.',
        ],
      },
      {
        heading: 'Install Git on macOS',
        paragraphs: [
          'The easiest way: open Terminal and run xcode-select. macOS offers to install the Command Line Tools — click Install, wait a few minutes, then check with git --version.',
          'If you use Homebrew, brew install git gets you the latest Git.',
        ],
        code: ['xcode-select --install', 'git --version', '# or, with Homebrew:', 'brew install git'],
      },
      {
        heading: 'Set your name and email',
        paragraphs: [
          'Every commit records an author name and email. Set them once for the whole machine (use the same email as your GitHub / GitLab account so commits show up as you).',
        ],
        code: [
          'git config --global user.name "Jane Doe"',
          'git config --global user.email "jane@example.com"',
        ],
        note: {
          kind: 'tip',
          text: 'Use the same email as your GitHub account so commits show your avatar.',
        },
      },
      {
        heading: 'Get started with Thaigit',
        steps: [
          'Download Thaigit for macOS or Windows (free, no account needed).',
          'On the welcome screen, open an existing folder, clone from GitHub / GitLab, or create a new repository.',
          'The history graph appears right away — from here you commit, pull and push with buttons.',
        ],
        shot: 'welcome',
      },
    ],
    faq: [
      {
        q: 'Where is it safe to download Git?',
        a: [
          'From the official site git-scm.com (Windows: git-scm.com/download/win). On macOS, Git comes with Apple’s Command Line Tools or via Homebrew. Avoid third-party download sites.',
        ],
      },
      {
        q: 'Is installing Git different on Windows 10 and Windows 11?',
        a: ['No. It is the same Git for Windows installer with the same steps.'],
      },
      {
        q: 'Do I need a GitHub account to use Git?',
        a: [
          'No. Git runs entirely on your computer. You only need an account at GitHub, GitLab or a similar service when you want to put code online (push).',
        ],
      },
    ],
  },
  'cherry-pick': {
    title: 'What is git cherry-pick? Take exactly one commit to another branch',
    short: 'Git cherry-pick',
    description:
      'Use git cherry-pick to copy one or a few commits to another branch without merging the whole branch. How to use it, handle conflicts, and cherry-pick with a right-click in Thaigit.',
    intro: [
      'You fixed a bug on a feature branch, but the fix is needed on the main branch right now. Merging the whole branch is not an option because the feature is not done — use cherry-pick: copy just that commit to another branch.',
    ],
    sections: [
      {
        heading: 'How does cherry-pick work?',
        paragraphs: [
          'Git takes the changes of the chosen commit and creates a new commit with the same content on the branch you are on. The new commit has a different SHA than the original, but the same message and changes.',
        ],
        note: {
          kind: 'warn',
          text: 'The copied commit gets a new SHA. Overusing it muddles history — if you need the whole branch, merge instead.',
        },
      },
      {
        heading: 'From the command line',
        steps: [
          'Switch to the branch that should receive the commit (for example main).',
          'Find the SHA of the commit to copy (git log --oneline).',
          'Run git cherry-pick followed by that SHA.',
        ],
        code: [
          'git switch main',
          'git log --oneline feature/ui',
          'git cherry-pick a1b2c3d',
          'git cherry-pick a1b2c3d..e4f5g6h   # a range of commits',
        ],
      },
      {
        heading: 'When there is a conflict',
        paragraphs: [
          'If the target branch’s code differs a lot, Git stops and reports a conflict. Resolve it, mark it resolved and continue; to give up, abort the whole operation.',
        ],
        code: [
          'git add src/price.ts',
          'git cherry-pick --continue',
          'git cherry-pick --abort    # give up, back to how it was',
        ],
      },
      {
        heading: 'Cherry-pick in Thaigit',
        steps: [
          'Right-click a commit on the graph and choose Cherry-pick into <branch>.',
          'Thaigit runs it and reports the result. On a conflict, a “Cherry-picking” banner appears with the conflict resolver (see the guide on resolving conflicts).',
          'Picked the wrong commit? Click Undo cherry-pick.',
        ],
        shot: 'overview',
      },
    ],
    faq: [
      {
        q: 'How is cherry-pick different from merge?',
        a: [
          'Merge brings in the whole history of a branch; cherry-pick copies only the commits you choose. Cherry-pick creates commits with the same content but a different SHA, so using it a lot can make history messy.',
        ],
      },
    ],
  },
  gitignore: {
    title: 'What is .gitignore? How to keep unwanted files out of Git',
    short: '.gitignore file',
    description:
      'Use .gitignore so Git stops tracking junk files, build output and secrets (.env). Basic syntax, what to do about files already committed, and adding to .gitignore quickly with Thaigit.',
    intro: [
      'Not every file in your project folder belongs in Git: the node_modules folder, build output, config files with passwords (.env), system files like .DS_Store… A .gitignore file tells Git what to skip.',
    ],
    sections: [
      {
        heading: 'Basic syntax',
        paragraphs: [
          'Create a file named .gitignore in the project root; each line is a pattern. A line starting with # is a comment; a trailing / marks a folder; * matches many characters; ! excludes a pattern.',
        ],
        sample: [
          '# Installed packages',
          'node_modules/',
          '',
          '# Build output',
          'dist/',
          '*.log',
          '',
          '# Secrets — never commit',
          '.env',
          '',
          '# But keep the example file',
          '!.env.example',
        ],
      },
      {
        heading: 'What if the file is already committed?',
        paragraphs: [
          '.gitignore only affects files Git is not tracking yet. If a file was committed before, tell Git to stop tracking it (the file on your disk stays).',
        ],
        code: ['git rm --cached .env', 'git commit -m "Stop tracking .env"'],
      },
      {
        heading: 'Committed a password or secret key by mistake?',
        paragraphs: ['Deleting the file in a new commit is not enough because it stays in history.'],
        note: {
          kind: 'warn',
          text: 'Change that password / key right away and treat it as leaked, then think about rewriting history.',
        },
      },
      {
        heading: 'Add to .gitignore with Thaigit',
        steps: [
          'In the “Unstaged” list, right-click the file or folder to skip.',
          'Choose “Add to .gitignore”. Thaigit writes a suitable pattern into .gitignore and tells you what it added.',
          'The file disappears from the changes list; just commit the .gitignore file.',
        ],
        shot: 'diff-lines',
      },
    ],
    faq: [
      {
        q: 'Where should .gitignore live?',
        a: [
          'Usually in the project root. You can add more .gitignore files in subfolders to apply rules only to that folder.',
        ],
      },
      {
        q: 'How do I ignore a file only on my machine, without putting it in the repo?',
        a: [
          'Add the pattern to .git/info/exclude inside the repo. The syntax is the same as .gitignore, but that file is never committed.',
        ],
      },
    ],
  },
  'fetch-pull': {
    title: 'git fetch vs git pull: what is the difference and which to use',
    short: 'Fetch vs pull',
    description:
      'Compare git fetch and git pull, pull with merge or rebase, when to use fast-forward only, and how to choose the pull style in Thaigit.',
    intro: [
      'Both bring changes from the remote to your machine. The difference is whether they also fold those changes into your branch.',
    ],
    sections: [
      {
        heading: 'git fetch: download only, your code is untouched',
        paragraphs: [
          'fetch updates what you know about the remote branches (origin/main…) but does not change your current branch or working files. Running it is always safe; afterwards you look at what is new and decide whether to merge or rebase.',
        ],
        code: ['git fetch', 'git log HEAD..origin/main --oneline   # what is new on the remote'],
      },
      {
        heading: 'git pull: fetch, then integrate right away',
        paragraphs: [
          'pull = fetch + merge (default) or fetch + rebase. Convenient, but it changes your branch immediately, so it can occasionally cause surprise conflicts.',
        ],
        code: [
          'git pull                 # fetch + merge',
          'git pull --rebase        # fetch + rebase, straight history',
          'git pull --ff-only       # only if no merge is needed',
        ],
      },
      {
        heading: 'Which one to choose?',
        steps: [
          'Safest: fetch first, look, then merge.',
          'Want tidy history: pull --rebase (only for commits you have not pushed).',
          'Want to avoid accidental merge commits: pull --ff-only — if it cannot fast-forward, Git stops and lets you decide.',
        ],
        note: {
          kind: 'tip',
          text: 'Not sure? Just fetch first — fetch never causes a conflict.',
        },
      },
      {
        heading: 'Fetch and pull in Thaigit',
        steps: [
          'Click Fetch on the toolbar to update every remote; Thaigit also fetches periodically on its own.',
          'Click Pull to bring changes into the current branch. The small arrow beside it offers Pull (merge if needed), Pull (rebase) or Pull (fast-forward only).',
          'To make the Pull button always use one style, choose it under “Pull button uses” in Settings.',
          'Pull did not go well? Click Undo pull.',
        ],
        shot: 'overview',
      },
    ],
    faq: [
      {
        q: 'Why fetch often?',
        a: [
          'Fetching shows you what teammates pushed without touching your code, so there are fewer surprises when you push or merge.',
        ],
      },
    ],
  },
  tag: {
    title: 'What is a Git tag? Mark release versions of your project',
    short: 'Git tag',
    description:
      'A Git tag marks an important commit such as version v1.0. Lightweight vs annotated tags, how to create, push and delete them, and how to create a tag with a right-click in Thaigit.',
    intro: [
      'Branches move forward with every new commit, but a tag stands still. That makes tags the right tool for marking points worth remembering for a long time — typically release versions like v1.0.0.',
    ],
    sections: [
      {
        heading: 'Two kinds of tags',
        paragraphs: [
          'A lightweight tag is just a label on a commit. An annotated tag also stores who created it, the date and a message, so it is the recommended choice for releases.',
        ],
        note: {
          kind: 'tip',
          text: 'Use annotated tags for releases — they carry the author, date and a note.',
        },
      },
      {
        heading: 'Commands you will use',
        code: [
          'git tag v1.0.0                       # lightweight tag',
          'git tag -a v1.0.0 -m "First release"  # annotated tag',
          'git tag                              # list tags',
          'git push origin v1.0.0               # push one tag',
          'git push origin --tags               # push all tags',
          'git tag -d v1.0.0                    # delete locally',
          'git push origin --delete v1.0.0      # delete on the remote',
        ],
      },
      {
        heading: 'Creating a tag in Thaigit',
        steps: [
          'Right-click a commit on the graph and choose “Create tag here…”.',
          'Enter a tag name. Add a message too if you want an annotated tag.',
          'To publish it, drag the tag label onto the remote (origin) to push. The tag shows on the graph right away.',
          'Deleted a tag by mistake? Click Undo or Restore tag.',
        ],
        shot: 'drag',
      },
    ],
    faq: [
      {
        q: 'How should I name tags?',
        a: [
          'The most common form is v plus a semantic version, such as v1.2.3: the first number goes up for big changes, the middle one for new features, the last one for bug fixes.',
        ],
      },
      {
        q: 'Are tags pushed automatically?',
        a: ['No. By default git push does not send tags; you push them separately (git push origin <tag>).'],
      },
    ],
  },
  ssh: {
    title: 'Create an SSH key for GitHub and GitLab — no more passwords',
    short: 'SSH key for GitHub',
    description:
      'How to create an SSH key (ed25519), add the public key to GitHub / GitLab and clone with git@github.com. Do it on the command line or generate the key right inside Thaigit.',
    intro: [
      'Typing a password or token on every push to GitHub gets old. An SSH key solves that: you create a key pair, give GitHub the public half, and your machine proves who you are on every connection.',
      'Note: GitHub no longer accepts your account password for Git over HTTPS — you need an SSH key or a personal access token.',
    ],
    sections: [
      {
        heading: 'Create a key on the command line',
        steps: [
          'Run ssh-keygen with the ed25519 type (the one GitHub and GitLab recommend).',
          'Press Enter to save in the default location; set a passphrase if you want extra protection.',
          'Print the public key (the .pub file) and copy it.',
        ],
        code: [
          'ssh-keygen -t ed25519 -C "my-laptop"',
          'cat ~/.ssh/id_ed25519.pub     # macOS / Linux',
          'type %USERPROFILE%\\.ssh\\id_ed25519.pub   # Windows (cmd)',
        ],
        note: {
          kind: 'warn',
          text: 'Share only the .pub file. Never send the private key (the file without an extension) to anyone.',
        },
      },
      {
        heading: 'Add the public key to GitHub',
        steps: [
          'Go to GitHub → Settings → SSH and GPG keys → New SSH key.',
          'Give it a recognizable title (for example “Work MacBook”), paste the public key into the Key box and save.',
          'Test the connection with ssh -T git@github.com.',
          'On GitLab go to Preferences → SSH Keys; the steps are similar.',
        ],
        code: ['ssh -T git@github.com', 'git clone git@github.com:your-name/project.git'],
      },
      {
        heading: 'Create a key inside Thaigit',
        steps: [
          'Open Settings → SSH keys, click “New key” and name it after your machine.',
          'Click “Copy public key” and paste it into GitHub / GitLab as above.',
          'From then on you can clone, fetch and push git@github.com:… repositories without setting up ssh-agent or a .ssh folder.',
          'No longer need the key? Delete it in Thaigit and remember to remove the public key on GitHub / GitLab.',
        ],
        shot: 'welcome',
      },
    ],
    faq: [
      {
        q: 'Can I share my private key?',
        a: [
          'Never. Only the .pub file (the public key) goes to GitHub. Anyone holding your private key can impersonate you.',
        ],
      },
      {
        q: 'SSH or HTTPS — which is more convenient?',
        a: [
          'SSH is handier long term because you do not re-enter anything. HTTPS with a token is easier to start with, especially on a borrowed machine or behind a firewall that blocks port 22.',
        ],
      },
    ],
  },
  'git-gui': {
    title: 'The best free Git GUI clients in 2026 for Windows and macOS',
    short: 'Best Git GUI',
    description:
      'A comparison of the most popular Git GUI clients in 2026 — Thaigit, GitHub Desktop, Sourcetree, GitKraken, Fork, TortoiseGit: price, platforms and which one to pick.',
    intro: [
      'A Git GUI (or Git client) lets you use Git with the mouse instead of typing commands: see your commit history as a graph, commit, branch, merge, pull and push with buttons. This guide compares the most popular Git GUIs so you can pick the right one.',
      'Prices and features of these apps change over time — check each app’s website before you buy.',
    ],
    sections: [
      {
        heading: 'What is a Git GUI, and do you need one?',
        paragraphs: [
          'Git is a command-line tool. A Git GUI is a layer on top: it still runs real Git underneath, but shows branches, commits and changes visually so you click instead of memorizing commands.',
          'Beginners worry less about typos; experienced users read the graph, stage single lines and resolve conflicts faster. Every Git GUI works on a standard Git repository, so you can still use the terminal side by side whenever you like.',
        ],
      },
      {
        heading: 'Quick comparison',
        table: {
          head: ['Client', 'Price', 'Platforms', 'Best for'],
          rows: [
            [
              'Thaigit',
              'Free, no account needed',
              'Windows 10 / 11, macOS 11+',
              'Doing Git with the mouse, drag & drop, Vietnamese or English UI',
            ],
            ['GitHub Desktop', 'Free, open source', 'Windows, macOS', 'Beginners who mostly use GitHub'],
            ['Sourcetree', 'Free', 'Windows, macOS', 'Lots of options, Bitbucket / Jira users'],
            [
              'GitKraken Desktop',
              'Free for local and public repos; private repos need a paid plan',
              'Windows, macOS, Linux',
              'Teams that want GitHub, GitLab and Jira integrations',
            ],
            [
              'Fork',
              'Free evaluation, one-time license',
              'Windows, macOS',
              'A fast app, if you don’t mind paying',
            ],
            ['TortoiseGit', 'Free, open source', 'Windows', 'Right-click workflows in File Explorer'],
            [
              'git-gui + gitk',
              'Free, ships with Git',
              'Windows, macOS, Linux',
              'Basic tasks, nothing extra to install',
            ],
          ],
        },
      },
      {
        heading: 'Thaigit — free, drag & drop',
        paragraphs: [
          'Thaigit is a free Git GUI for Windows and macOS: no ads, no account, no limit on private repositories, with a Vietnamese and English interface.',
          'What sets it apart is working with the mouse: drag a branch onto another to merge or rebase, drag it onto a remote to push, click lines to stage them, and resolve conflicts in a few clicks instead of deleting <<<<<<< markers by hand. A colorful history graph opens a 30,000-commit repo in about a second, and the app updates itself.',
        ],
        shot: 'drag',
      },
      {
        heading: 'GitHub Desktop',
        paragraphs: [
          'GitHub’s own app, free and open source. Very approachable for beginners: cloning, committing and opening pull requests are all simple. On the other hand, history is a list rather than a branch graph, and many advanced tasks still send you back to the terminal.',
        ],
      },
      {
        heading: 'Sourcetree',
        paragraphs: [
          'Atlassian’s long-standing free Git client with plenty of features: a graph, interactive rebase, Git-flow, submodules. The interface packs many buttons and options, which can overwhelm beginners, and many users report it slowing down on large repositories.',
        ],
      },
      {
        heading: 'GitKraken Desktop',
        paragraphs: [
          'A good-looking graph, drag & drop, deep integrations with GitHub, GitLab, Bitbucket, Azure DevOps and Jira, and Linux support. The free plan only covers local and public repositories; working with private hosted repositories needs a paid plan.',
        ],
      },
      {
        heading: 'Fork, TortoiseGit and other options',
        steps: [
          'Fork: fast and tidy, with a free evaluation and a one-time license.',
          'TortoiseGit: lives in the File Explorer right-click menu, Windows only.',
          'Tower, Sublime Merge: powerful but paid.',
          'SmartGit: free for non-commercial use, paid for work.',
          'VS Code, JetBrains: Git built into the editor — handy for quick tasks, harder for seeing the whole branch picture.',
        ],
      },
      {
        heading: 'Which Git GUI should you choose?',
        steps: [
          'New to Git and want something completely free: Thaigit.',
          'Private repositories without paying: Thaigit, GitHub Desktop or Sourcetree.',
          'Only GitHub, and as simple as possible: GitHub Desktop or Thaigit.',
          'Need Linux: GitKraken, SmartGit or git-gui.',
          'Need issues, pull requests and Jira inside the client: GitKraken.',
        ],
        note: {
          kind: 'tip',
          text: 'Git GUIs all read the same standard Git repository, so you can try a few on one repo and keep whichever feels best.',
        },
      },
    ],
    faq: [
      {
        q: 'What is the best free Git GUI?',
        a: [
          'It depends on your needs. If you want something completely free (private repos included) with no account, Thaigit is a good fit. If you only work with GitHub and want maximum simplicity, GitHub Desktop is also a solid choice.',
        ],
      },
      {
        q: 'Do I need to know Git commands to use a Git GUI?',
        a: [
          'Not strictly — everyday tasks are buttons. Understanding commits, branches and merges does make you more confident; Thaigit’s guides explain each concept with the matching command.',
        ],
      },
      {
        q: 'Does a Git GUI change my repository differently from the command line?',
        a: [
          'No. Thaigit calls the real git on your machine, so results are identical to the terminal — just easier to see and click.',
        ],
      },
      {
        q: 'Do I need to install Git before using a Git GUI?',
        a: [
          'Some apps bundle their own Git. Thaigit uses the Git installed on your machine: run xcode-select --install on macOS, or install Git for Windows — see the Install Git guide.',
        ],
      },
    ],
  },
  'alt-sourcetree': {
    title: 'A free Sourcetree alternative for Windows and macOS',
    short: 'Sourcetree alternative',
    description:
      'Looking for a Sourcetree alternative? Thaigit vs Sourcetree: drag & drop to merge, line-by-line staging, built-in conflict resolver — and how to switch in a minute.',
    intro: [
      'Sourcetree is Atlassian’s long-standing free Git client and still widely used. If it feels too busy, slows down on large repositories, or you simply want a cleaner interface, Thaigit is a free alternative worth trying.',
    ],
    sections: [
      {
        heading: 'Thaigit vs Sourcetree',
        table: {
          head: ['', 'Thaigit', 'Sourcetree'],
          rows: [
            ['Price', 'Free, no ads', 'Free'],
            ['Platforms', 'Windows 10 / 11, macOS 11+', 'Windows, macOS'],
            [
              'Merge, rebase, push',
              'Drag a branch onto a branch / remote, always confirmed',
              'Menus and dialogs',
            ],
            ['Line staging', 'Click lines, Shift-click for a range', 'By hunk or by line'],
            [
              'Conflicts',
              'Built-in resolver, block by block',
              'Pick one side for the whole file or open an external merge tool',
            ],
            ['Git-flow', 'No dedicated menu yet', 'Yes'],
          ],
        },
      },
      {
        heading: 'Why people look for a Sourcetree alternative',
        paragraphs: [
          'Sourcetree is capable, but it puts a lot of options on one screen and beginners click the wrong thing. Many users also report it slowing down on repositories with long histories.',
          'Thaigit goes the other way: fewer buttons, everyday tasks by drag & drop, a confirmation for every action and an undo button. A 30,000-commit repository opens in about a second.',
        ],
        shot: 'drag',
      },
      {
        heading: 'Switching from Sourcetree to Thaigit',
        steps: [
          'Download Thaigit for Windows or macOS (free, no account needed).',
          'Open the same repository folder you use with Sourcetree — no import, nothing lost: history, branches and stashes stay put.',
          'Remotes, branches and tags appear right away in the graph and sidebar.',
          'Thaigit uses the git on your machine, so SSH keys and credentials already configured for git keep working.',
        ],
        note: {
          kind: 'tip',
          text: 'You can keep Sourcetree and use both for a while — they read the same standard Git repository.',
        },
      },
    ],
    faq: [
      {
        q: 'Will I lose my commit history if I switch?',
        a: [
          'No. History, branches, tags and stashes live in the Git repository itself; Thaigit just reads and shows them.',
        ],
      },
      {
        q: 'Is Thaigit free like Sourcetree?',
        a: ['Yes. Thaigit is free, with no ads, no account and no limit on private repositories.'],
      },
    ],
  },
  'alt-github-desktop': {
    title: 'A GitHub Desktop alternative with a branch graph and drag & drop',
    short: 'GitHub Desktop alternative',
    description:
      'Thaigit vs GitHub Desktop: a colorful history graph, drag & drop to merge / rebase / push, a built-in conflict resolver — free for Windows and macOS.',
    intro: [
      'GitHub Desktop is simple and free, great when you are learning Git. Once a project has many branches you will want to see where they split and join, and merge faster — that is when a Git GUI with a graph like Thaigit helps.',
    ],
    sections: [
      {
        heading: 'Thaigit vs GitHub Desktop',
        table: {
          head: ['', 'Thaigit', 'GitHub Desktop'],
          rows: [
            ['Price', 'Free', 'Free, open source'],
            ['History', 'Colorful graph of every branch', 'Commit list of the current branch'],
            ['Merge, rebase, push', 'Drag & drop on the graph or sidebar', 'Branch menu'],
            ['Line staging', 'Yes', 'Yes'],
            ['Conflicts', 'Built-in resolver', 'Pick one side for the whole file or open your editor'],
            ['Remotes', 'GitHub, GitLab, Bitbucket, any Git server', 'Optimized for GitHub'],
            ['Interface language', 'English and Vietnamese', 'English'],
          ],
        },
      },
      {
        heading: 'See the whole branch picture',
        paragraphs: [
          'Thaigit draws every branch in its own color, so you can see at a glance where a branch came from, whether it was merged, and which commit you are on. Press ⌘B / Ctrl+B to find and switch branches in a second.',
        ],
        shot: 'overview-dark',
      },
      {
        heading: 'Switching from GitHub Desktop to Thaigit',
        steps: [
          'Download Thaigit for Windows or macOS.',
          'Open the repository folder you cloned with GitHub Desktop — no need to clone again.',
          'Pull, push and branch as before, now with drag & drop.',
        ],
        note: {
          kind: 'tip',
          text: 'Thaigit uses the git on your machine. If you have only used GitHub Desktop so far, install Git (see the Install Git guide) and set up an SSH key or token to push to GitHub.',
        },
      },
    ],
    faq: [
      {
        q: 'Does Thaigit work with GitHub?',
        a: [
          'Yes. Thaigit works with any Git remote: GitHub, GitLab, Bitbucket or your company’s own server.',
        ],
      },
      {
        q: 'Can I use GitHub Desktop and Thaigit together?',
        a: ['Yes. Both read the same standard Git repository, so you can use them side by side.'],
      },
    ],
  },
  'alt-gitkraken': {
    title: 'A free GitKraken alternative that works with private repositories',
    short: 'GitKraken alternative',
    description:
      'Thaigit vs GitKraken Desktop: a colorful graph and drag & drop to merge — free even for private repositories, no account needed, for Windows and macOS.',
    intro: [
      'GitKraken is known for its graph and drag & drop, but the free plan only covers local and public repositories. If you work with private repositories and don’t want a monthly fee, Thaigit works in a similar way and is completely free.',
    ],
    sections: [
      {
        heading: 'Thaigit vs GitKraken',
        table: {
          head: ['', 'Thaigit', 'GitKraken Desktop'],
          rows: [
            [
              'Price',
              'Free, private repos included',
              'Free for local and public repos; private repos need a paid plan',
            ],
            ['Platforms', 'Windows 10 / 11, macOS 11+', 'Windows, macOS, Linux'],
            ['Colorful graph', 'Yes', 'Yes'],
            ['Drag & drop to merge, rebase, push', 'Yes', 'Yes'],
            ['Issues, pull requests, Jira', 'Not yet', 'Yes'],
          ],
        },
      },
      {
        heading: 'Drag & drop like GitKraken, for free',
        paragraphs: [
          'In Thaigit, drag a branch label on the graph and drop it onto another branch to merge, rebase or fast-forward; drop it onto a remote to push. There is always a confirmation, nothing runs behind your back.',
        ],
        shot: 'drag',
      },
      {
        heading: 'When GitKraken is still the better fit',
        paragraphs: [
          'If your team needs issues, pull requests and Jira inside the Git client, or you must run on Linux, GitKraken remains a strong choice. If you mostly commit, branch, merge and resolve conflicts, Thaigit covers it at no cost.',
        ],
      },
    ],
    faq: [
      {
        q: 'Does Thaigit limit private repositories?',
        a: [
          'No. Thaigit is free for every repository, private or public, on GitHub, GitLab, Bitbucket or your own server.',
        ],
      },
      {
        q: 'Do I need an account to use Thaigit?',
        a: ['No. Download it, open a repository and you are ready to go.'],
      },
    ],
  },
};
