// ============================================
// SSE Connection State
// ============================================

use papaya::HashMap as PaHashMap;
use std::sync::{atomic::AtomicU64, Arc};

/// 用于管理 SSE 连接的全局状态（支持多窗口）
/// 每个窗口独立维护自己的 SSE 连接，互不干扰
pub struct SseState {
    /// 每次连接分配一个递增 ID，用于区分不同连接
    next_id: AtomicU64,
    /// 每个窗口的活跃连接 ID: window label → connection ID
    active: PaHashMap<Arc<str>, u64>,
}

impl Default for SseState {
    fn default() -> Self {
        Self {
            next_id: AtomicU64::new(0),
            active: PaHashMap::new(),
        }
    }
}

impl SseState {
    // #[inline(always)]
    // pub fn next_id(&self) -> u64 {
    //     self.next_id.load(std::sync::atomic::Ordering::SeqCst)
    // }

    #[inline(always)]
    pub fn active(&self) -> &PaHashMap<Arc<str>, u64> {
        &self.active
    }

    #[inline(always)]
    pub fn id_fetch_add(&self, value: u64) -> u64 {
        self.next_id
            .fetch_add(value, std::sync::atomic::Ordering::SeqCst)
    }
}
