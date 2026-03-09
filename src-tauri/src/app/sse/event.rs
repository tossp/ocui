// ============================================
// SSE Event Types (sent to frontend via Channel)
// ============================================

use serde::Serialize;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "event", content = "data")]
pub enum SseEvent {
    /// SSE 连接已建立
    Connected,
    /// 收到一条 SSE 数据（已解析的 JSON 字符串）
    #[serde(rename_all = "camelCase")]
    Message {
        /// 原始 JSON 字符串，前端自行解析
        raw: String,
    },
    /// SSE 连接断开（正常结束）
    Disconnected { reason: String },
    /// SSE 连接出错
    Error { message: String },
}
