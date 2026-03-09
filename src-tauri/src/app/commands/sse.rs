// ============================================
// SSE Commands
// ============================================

use crate::app::sse::{SseConnectArgs, SseEvent, SseState};
use futures_util::StreamExt;
use std::sync::Arc;
use std::time::Duration;
use tauri::{ipc::Channel, State};

/// 连接 SSE 流
///
/// 通过 reqwest 在 Rust 侧建立 SSE 连接，完全绕过 WebView 的 CORS 限制。
/// 使用 Tauri Channel 将事件流式发送给前端。
#[tauri::command]
pub async fn sse_connect(
    window: tauri::Window,
    state: State<'_, SseState>,
    args: SseConnectArgs,
    on_event: Channel<SseEvent>,
) -> Result<(), String> {
    // 分配连接 ID（per-window，多窗口互不干扰）
    let conn_id = state.id_fetch_add(1) + 1;
    let win_label: Arc<str> = Arc::from(window.label());
    state.active().pin().insert(win_label.clone(), conn_id);

    // 构建请求 - 配置超时防止连接静默死亡
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        // 注意：不设置 read timeout，因为 SSE 是长连接，空闲时间可能很长
        // 改用下面的 tokio::time::timeout 包装每次 chunk 读取
        .tcp_keepalive(Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;
    let mut req = client.get(args.url());

    if let Some(auth) = args.auth_header() {
        req = req.header("Authorization", auth);
    }

    // 发起请求
    let response = req.send().await.map_err(|e| {
        let msg = format!("SSE connection failed: {}", e);
        let _ = on_event.send(SseEvent::Error {
            message: msg.clone(),
        });
        msg
    })?;

    if !response.status().is_success() {
        let status = response.status();
        let msg = format!("SSE server returned {}", status);
        let _ = on_event.send(SseEvent::Error {
            message: msg.clone(),
        });
        return Err(msg);
    }

    // 通知前端已连接
    let _ = on_event.send(SseEvent::Connected);

    // 流式读取 SSE
    // 使用 timeout 包装每次 chunk 读取，防止连接静默断开后永远挂起
    // SSE 服务端通常每 30-60 秒发送心跳，90 秒无数据基本可以判定连接已死
    const READ_TIMEOUT: Duration = Duration::from_secs(90);

    let mut stream = response.bytes_stream();
    let mut buffer: Vec<u8> = Vec::new();
    let mut event_data = String::new();

    loop {
        // 检查该窗口的连接是否被要求断开
        if state.active().pin().get(&win_label) != Some(&conn_id) {
            let _ = on_event.send(SseEvent::Disconnected {
                reason: "Disconnected by client".to_string(),
            });
            return Ok(());
        }

        match tokio::time::timeout(READ_TIMEOUT, stream.next()).await {
            Ok(Some(Ok(chunk))) => {
                buffer.extend_from_slice(&chunk);

                for raw in drain_sse_messages(&mut buffer, &mut event_data) {
                    let _ = on_event.send(SseEvent::Message { raw });
                }
            }
            Ok(Some(Err(e))) => {
                let msg = format!("SSE stream error: {}", e);
                let _ = on_event.send(SseEvent::Error {
                    message: msg.clone(),
                });
                return Err(msg);
            }
            Ok(None) => {
                if !event_data.is_empty() {
                    let _ = on_event.send(SseEvent::Message {
                        raw: event_data.clone(),
                    });
                }
                // 流结束
                let _ = on_event.send(SseEvent::Disconnected {
                    reason: "Stream ended".to_string(),
                });
                return Ok(());
            }
            Err(_) => {
                // 读取超时 — 连接可能已经静默断开
                let msg = format!(
                    "SSE read timeout ({}s without data)",
                    READ_TIMEOUT.as_secs()
                );
                let _ = on_event.send(SseEvent::Error {
                    message: msg.clone(),
                });
                return Err(msg);
            }
        }
    }
}

/// 断开 SSE 连接
#[tauri::command]
pub async fn sse_disconnect(window: tauri::Window, state: State<'_, SseState>) -> Result<(), ()> {
    state.active().pin().remove(window.label());
    Ok(())
}

fn process_sse_line(line: &str, event_data: &mut String, messages: &mut Vec<String>) {
    if let Some(stripped) = line.strip_prefix("data:") {
        let data = stripped.trim();
        if !data.is_empty() {
            if !event_data.is_empty() {
                event_data.push('\n');
            }
            event_data.push_str(data);
        }
        return;
    }

    if line.is_empty() && !event_data.is_empty() {
        messages.push(std::mem::take(event_data));
    }

    // 忽略 event:, id:, retry: 等 SSE 字段
}

fn drain_sse_messages(buffer: &mut Vec<u8>, event_data: &mut String) -> Vec<String> {
    let mut messages = Vec::new();
    let mut line_start = 0usize;

    for index in 0..buffer.len() {
        if buffer[index] != b'\n' {
            continue;
        }

        let mut line_end = index;
        if line_end > line_start && buffer[line_end - 1] == b'\r' {
            line_end -= 1;
        }

        let line = match std::str::from_utf8(&buffer[line_start..line_end]) {
            Ok(line) => line.to_owned(),
            Err(_) => String::from_utf8_lossy(&buffer[line_start..line_end]).into_owned(),
        };

        process_sse_line(&line, event_data, &mut messages);
        line_start = index + 1;
    }

    if line_start > 0 {
        buffer.drain(..line_start);
    }

    messages
}

#[cfg(test)]
mod tests {
    use super::{drain_sse_messages, process_sse_line};

    #[test]
    fn preserves_utf8_when_character_spans_multiple_chunks() {
        let mut buffer = Vec::new();
        let mut event_data = String::new();

        buffer.extend_from_slice(b"data: \xE9");
        assert!(drain_sse_messages(&mut buffer, &mut event_data).is_empty());
        assert_eq!(event_data, "");

        buffer.extend_from_slice(&[0x83, 0xA8, b'\n', b'\n']);
        assert_eq!(
            drain_sse_messages(&mut buffer, &mut event_data),
            vec!["部".to_string()]
        );
        assert!(buffer.is_empty());
        assert_eq!(event_data, "");
    }

    #[test]
    fn combines_multiple_data_lines_into_one_message() {
        let mut messages = Vec::new();
        let mut event_data = String::new();

        process_sse_line("data: 第一行", &mut event_data, &mut messages);
        process_sse_line("data: 第二行", &mut event_data, &mut messages);
        process_sse_line("", &mut event_data, &mut messages);

        assert_eq!(messages, vec!["第一行\n第二行".to_string()]);
        assert_eq!(event_data, "");
    }
}
