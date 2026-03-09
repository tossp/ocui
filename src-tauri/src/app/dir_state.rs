// ============================================
// Open Directory State (desktop only)
// 存储启动时传入的目录路径（右键菜单、拖放等）
// ============================================

use papaya::HashMap as PaHashMap;
use std::sync::Arc;

pub struct OpenDirectoryState {
    /// per-window 待处理目录: window label → directory path
    pending: PaHashMap<String, Arc<str>>,
}

impl Default for OpenDirectoryState {
    fn default() -> Self {
        Self {
            pending: PaHashMap::new(),
        }
    }
}

impl OpenDirectoryState {
    pub fn pending(&self) -> &PaHashMap<String, Arc<str>> {
        &self.pending
    }
}
