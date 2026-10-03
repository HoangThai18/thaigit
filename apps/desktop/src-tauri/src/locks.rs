//! Khoá theo repo: khoá theo `realpath(commonDir)`, toàn tiến trình (chung mọi cửa sổ, mọi worktree).
//! `write`/`network` độc quyền, `read` không khoá. Auto-fetch (`background`) chỉ chạy khi `try_lock` được và không có op
//! chờ; khi một op thường phải chờ sau auto-fetch thì auto-fetch bị huỷ (ưu tiên thấp, có thể bị chen).

use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tokio::sync::OwnedMutexGuard;

use crate::errors::AppError;
use crate::exec::CancelToken;

/// Op đang giữ khoá.
#[derive(Clone)]
pub struct Holder {
    pub op_id: String,
    pub background: bool,
    pub cancel: Arc<CancelToken>,
}

#[derive(Default)]
struct LockState {
    holder: Option<Holder>,
    /// `(bắt đầu, kết thúc)` của các op write/network gần đây — để tắt tiếng sự kiện watcher theo thời điểm sự kiện xảy ra.
    intervals: VecDeque<(Instant, Option<Instant>)>,
}

const KEEP_INTERVALS: usize = 32;
const PREEMPT_POLL: Duration = Duration::from_millis(100);

pub struct RepoLock {
    gate: Arc<tokio::sync::Mutex<()>>,
    waiting: AtomicUsize,
    /// Thời gian `git status` lần trước (ms): watcher không phát sự kiện dồn dập hơn mức này.
    status_ms: AtomicU64,
    state: Mutex<LockState>,
}

/// Giữ khoá cho tới khi thả (hết op).
pub struct LockGuard {
    lock: Arc<RepoLock>,
    _permit: OwnedMutexGuard<()>,
}

impl Drop for LockGuard {
    fn drop(&mut self) {
        let mut state = self.lock.state();
        state.holder = None;
        if let Some(last) = state.intervals.back_mut()
            && last.1.is_none()
        {
            last.1 = Some(Instant::now());
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum AcquireError {
    /// Op bị huỷ trong lúc xếp hàng.
    Cancelled,
    /// Auto-fetch không lấy được khoá ngay.
    Busy,
}

impl From<AcquireError> for AppError {
    fn from(error: AcquireError) -> Self {
        match error {
            AcquireError::Cancelled => AppError::Busy("Thao tác đã bị huỷ khi đang chờ".into()),
            AcquireError::Busy => AppError::Busy("Repo đang bận, bỏ qua lần chạy nền này".into()),
        }
    }
}

impl RepoLock {
    fn new() -> Arc<Self> {
        Arc::new(Self {
            gate: Arc::new(tokio::sync::Mutex::new(())),
            waiting: AtomicUsize::new(0),
            status_ms: AtomicU64::new(0),
            state: Mutex::new(LockState::default()),
        })
    }

    fn state(&self) -> std::sync::MutexGuard<'_, LockState> {
        self.state.lock().unwrap_or_else(|p| p.into_inner())
    }

    fn begin(self: &Arc<Self>, permit: OwnedMutexGuard<()>, holder: Holder) -> LockGuard {
        self.begin_with(permit, holder, true)
    }

    /// `mute = false`: op không ghi gì vào working tree nên sự kiện watcher trong lúc nó chạy vẫn là của người dùng.
    fn begin_with(self: &Arc<Self>, permit: OwnedMutexGuard<()>, holder: Holder, mute: bool) -> LockGuard {
        let mut state = self.state();
        state.holder = Some(holder);
        if !mute {
            drop(state);
            return LockGuard { lock: self.clone(), _permit: permit };
        }
        state.intervals.push_back((Instant::now(), None));
        while state.intervals.len() > KEEP_INTERVALS {
            state.intervals.pop_front();
        }
        drop(state);
        LockGuard { lock: self.clone(), _permit: permit }
    }

    /// Xếp hàng lấy khoá độc quyền (FIFO). Nếu đang bị auto-fetch giữ thì huỷ auto-fetch để nhường chỗ.
    pub async fn acquire(self: &Arc<Self>, holder: Holder, cancel: Option<&CancelToken>) -> Result<LockGuard, AcquireError> {
        struct Waiting<'a>(&'a AtomicUsize);
        impl Drop for Waiting<'_> {
            fn drop(&mut self) {
                self.0.fetch_sub(1, Ordering::SeqCst);
            }
        }
        self.waiting.fetch_add(1, Ordering::SeqCst);
        let _waiting = Waiting(&self.waiting);
        let lock_future = self.gate.clone().lock_owned();
        tokio::pin!(lock_future);
        loop {
            self.preempt_background();
            tokio::select! {
                permit = &mut lock_future => return Ok(self.begin(permit, holder)),
                () = tokio::time::sleep(PREEMPT_POLL) => {}
                () = async {
                    match cancel {
                        Some(token) => token.cancelled().await,
                        None => std::future::pending().await,
                    }
                } => return Err(AcquireError::Cancelled),
            }
        }
    }

    /// Auto-fetch: chỉ chạy khi không có op nào đang giữ hoặc đang chờ.
    pub fn try_acquire_background(self: &Arc<Self>, holder: Holder) -> Result<LockGuard, AcquireError> {
        if self.waiting.load(Ordering::SeqCst) > 0 {
            return Err(AcquireError::Busy);
        }
        let permit = self.gate.clone().try_lock_owned().map_err(|_| AcquireError::Busy)?;
        Ok(self.begin(permit, holder))
    }

    /// Lệnh ghi nền của snapshot (chỉ ghi vào git dir): như auto-fetch là chỉ chạy khi rảnh và không ai chờ, nhưng KHÔNG bị chen
    /// ngang (giết `update-ref` giữa chừng để lại file `.lock`) và không tắt tiếng watcher.
    pub fn try_acquire_quiet(self: &Arc<Self>, holder: Holder) -> Result<LockGuard, AcquireError> {
        if self.waiting.load(Ordering::SeqCst) > 0 {
            return Err(AcquireError::Busy);
        }
        let permit = self.gate.clone().try_lock_owned().map_err(|_| AcquireError::Busy)?;
        Ok(self.begin_with(permit, Holder { background: false, ..holder }, false))
    }

    fn preempt_background(&self) {
        if let Some(holder) = self.state().holder.clone()
            && holder.background
        {
            holder.cancel.cancel();
        }
    }

    /// Repo đang có op write/network của app?
    pub fn is_active(&self) -> bool {
        self.state().holder.is_some()
    }

    /// Sự kiện xảy ra lúc `when` có nằm trong một op write/network (cộng `grace` sau khi op xong) không?
    pub fn is_muted_at(&self, when: Instant, grace: Duration) -> bool {
        self.state().intervals.iter().any(|(start, end)| when >= *start && end.is_none_or(|end| when <= end + grace))
    }

    pub fn record_status_ms(&self, millis: u64) {
        self.status_ms.store(millis, Ordering::Relaxed);
    }

    pub fn status_ms(&self) -> u64 {
        self.status_ms.load(Ordering::Relaxed)
    }

    pub fn waiting(&self) -> usize {
        self.waiting.load(Ordering::SeqCst)
    }
}

#[derive(Default)]
pub struct Locks {
    map: Mutex<HashMap<String, Arc<RepoLock>>>,
}

impl Locks {
    /// Khoá của repo (tạo nếu chưa có); `key` = `path_key(realpath(commonDir))`.
    pub fn for_key(&self, key: &str) -> Arc<RepoLock> {
        self.map.lock().unwrap_or_else(|p| p.into_inner()).entry(key.to_string()).or_insert_with(RepoLock::new).clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn holder(id: &str, background: bool) -> Holder {
        Holder { op_id: id.into(), background, cancel: CancelToken::new() }
    }

    #[tokio::test]
    async fn write_ops_on_the_same_repo_run_one_at_a_time_in_order() {
        let locks = Locks::default();
        let lock = locks.for_key("/repo/.git");
        let events = Arc::new(Mutex::new(Vec::new()));
        let mut tasks = Vec::new();
        for index in 0..4 {
            let lock = lock.clone();
            let events = events.clone();
            tasks.push(tokio::spawn(async move {
                let guard = lock.acquire(holder(&format!("op{index}"), false), None).await.unwrap();
                events.lock().unwrap().push(format!("start{index}"));
                tokio::time::sleep(Duration::from_millis(30)).await;
                events.lock().unwrap().push(format!("end{index}"));
                drop(guard);
            }));
            // Đảm bảo thứ tự xếp hàng ổn định.
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        for task in tasks {
            task.await.unwrap();
        }
        let events = events.lock().unwrap().clone();
        assert_eq!(events, ["start0", "end0", "start1", "end1", "start2", "end2", "start3", "end3"]);
    }

    #[tokio::test]
    async fn different_repos_do_not_block_each_other_and_same_realpath_shares_one_lock() {
        let locks = Locks::default();
        let a = locks.for_key("/a/.git");
        let b = locks.for_key("/b/.git");
        let _held = a.acquire(holder("a", false), None).await.unwrap();
        let other = tokio::time::timeout(Duration::from_millis(200), b.acquire(holder("b", false), None)).await;
        assert!(other.is_ok(), "repo khác không bị chặn");
        assert!(Arc::ptr_eq(&a, &locks.for_key("/a/.git")));
    }

    #[tokio::test]
    async fn read_ops_never_take_the_lock() {
        // `read` không gọi acquire: giữ khoá ghi không ảnh hưởng — chỉ cần xác nhận khoá không bị chiếm bởi việc đọc.
        let lock = Locks::default().for_key("/r/.git");
        let guard = lock.acquire(holder("w", false), None).await.unwrap();
        assert!(lock.is_active());
        drop(guard);
        assert!(!lock.is_active());
    }

    #[tokio::test]
    async fn background_fetch_only_runs_when_idle_and_nobody_waits() {
        let lock = Locks::default().for_key("/r/.git");
        let guard = lock.try_acquire_background(holder("auto", true)).expect("rảnh thì chạy được");
        assert!(lock.try_acquire_background(holder("auto2", true)).is_err(), "đang có op giữ khoá");
        drop(guard);
        // Có op đang chờ thì auto-fetch không chen vào.
        let held = lock.acquire(holder("w1", false), None).await.unwrap();
        let waiter = {
            let lock = lock.clone();
            tokio::spawn(async move { lock.acquire(holder("w2", false), None).await.map(drop) })
        };
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert_eq!(lock.waiting(), 1);
        drop(held);
        waiter.await.unwrap().unwrap();
        assert!(lock.try_acquire_background(holder("auto3", true)).is_ok());
    }

    #[tokio::test]
    async fn a_waiting_op_preempts_a_running_background_fetch() {
        let lock = Locks::default().for_key("/r/.git");
        let auto = holder("auto", true);
        let auto_cancel = auto.cancel.clone();
        let guard = lock.try_acquire_background(auto).unwrap();
        let waiter = {
            let lock = lock.clone();
            tokio::spawn(async move { lock.acquire(holder("pull", false), None).await.map(drop) })
        };
        tokio::time::timeout(Duration::from_secs(2), auto_cancel.cancelled()).await.expect("auto-fetch phải bị huỷ để nhường");
        drop(guard);
        waiter.await.unwrap().unwrap();
    }

    #[tokio::test]
    async fn a_queued_op_can_be_cancelled_before_it_starts() {
        let lock = Locks::default().for_key("/r/.git");
        let _held = lock.acquire(holder("w1", false), None).await.unwrap();
        let token = CancelToken::new();
        let waiter = {
            let lock = lock.clone();
            let token = token.clone();
            tokio::spawn(async move { lock.acquire(holder("w2", false), Some(&token)).await.map(drop) })
        };
        tokio::time::sleep(Duration::from_millis(30)).await;
        token.cancel();
        let result = tokio::time::timeout(Duration::from_secs(1), waiter).await.unwrap().unwrap();
        assert_eq!(result, Err(AcquireError::Cancelled));
        assert_eq!(lock.waiting(), 0);
    }

    #[tokio::test]
    async fn mute_windows_follow_op_intervals_with_grace() {
        let lock = Locks::default().for_key("/r/.git");
        let before = Instant::now();
        tokio::time::sleep(Duration::from_millis(10)).await;
        let guard = lock.acquire(holder("w", false), None).await.unwrap();
        let during = Instant::now();
        assert!(lock.is_muted_at(during, Duration::ZERO));
        assert!(!lock.is_muted_at(before, Duration::from_millis(1)), "trước op không bị tắt tiếng");
        drop(guard);
        let after_end = Instant::now();
        tokio::time::sleep(Duration::from_millis(60)).await;
        assert!(lock.is_muted_at(during, Duration::ZERO), "sự kiện lúc op chạy vẫn bị tắt dù tới trễ");
        assert!(lock.is_muted_at(after_end, Duration::from_millis(500)), "trong thời gian ân hạn");
        assert!(!lock.is_muted_at(Instant::now(), Duration::from_millis(10)), "sau ân hạn thì không");
    }

    #[tokio::test]
    async fn quiet_background_write_skips_when_busy_never_mutes_and_is_never_preempted() {
        let lock = Locks::default().for_key("/r/.git");
        let held = lock.acquire(holder("w", false), None).await.unwrap();
        assert_eq!(lock.try_acquire_quiet(holder("snap", false)).err(), Some(AcquireError::Busy), "repo bận thì bỏ qua");
        drop(held);
        tokio::time::sleep(Duration::from_millis(5)).await;

        let snap = holder("snap", false);
        let snap_cancel = snap.cancel.clone();
        let guard = lock.try_acquire_quiet(snap).expect("rảnh thì chạy được");
        let during = Instant::now();
        assert!(!lock.is_muted_at(during, Duration::ZERO), "file người dùng sửa lúc chụp snapshot vẫn phải được báo");
        let waiter = {
            let lock = lock.clone();
            tokio::spawn(async move { lock.acquire(holder("commit", false), None).await.map(drop) })
        };
        tokio::time::sleep(Duration::from_millis(250)).await;
        assert!(!snap_cancel.is_cancelled(), "lệnh ghi nền không bị giết giữa chừng");
        assert_eq!(lock.try_acquire_quiet(holder("snap2", false)).err(), Some(AcquireError::Busy), "có op chờ thì không chen");
        drop(guard);
        waiter.await.unwrap().unwrap();
        assert!(!lock.is_muted_at(during, Duration::ZERO), "đóng khoá không mở lại khoảng tắt tiếng cũ");
    }

    #[test]
    fn status_duration_is_shared_per_repo() {
        let lock = Locks::default().for_key("/r/.git");
        assert_eq!(lock.status_ms(), 0);
        lock.record_status_ms(420);
        assert_eq!(lock.status_ms(), 420);
    }
}
