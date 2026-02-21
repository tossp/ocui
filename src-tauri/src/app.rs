// ============================================
// Tauri Application Entry Point
// SSE Bridge + Plugin Registration
// ============================================

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;
use tauri::{ipc::Channel, Manager, State};

#[cfg(not(mobile))]
use std::sync::Mutex;

#[cfg(not(mobile))]
use std::process::{Child, Command, Stdio};

#[cfg(not(mobile))]
use std::path::PathBuf;

#[derive(Default)]
struct OpencodeServerState {
    #[cfg(not(mobile))]
    child: Mutex<Option<Child>>,
}

#[cfg(not(mobile))]
const DEFAULT_SERVER_URL: &str = "http://127.0.0.1:4096";

#[cfg(not(mobile))]
async fn check_health(base_url: &str) -> bool {
    let url = format!("{}/global/health", base_url.trim_end_matches('/'));

    let client = match reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(7))
        .build()
    {
        Ok(c) => c,
        Err(_) => return false,
    };

    client
        .get(url)
        .send()
        .await
        .map(|r| r.status().is_success())
        .unwrap_or(false)
}

#[cfg(not(mobile))]
async fn wait_for_health(base_url: &str, timeout: Duration) -> bool {
    let deadline = tokio::time::Instant::now() + timeout;
    loop {
        if check_health(base_url).await {
            return true;
        }

        if tokio::time::Instant::now() >= deadline {
            return false;
        }

        tokio::time::sleep(Duration::from_millis(150)).await;
    }
}

#[cfg(not(mobile))]
fn spawn_opencode_server() -> Result<Child, String> {
    let mut cmd = Command::new(resolve_opencode_bin().unwrap_or_else(|| "opencode".into()));
    cmd.arg("serve")
        .arg("--hostname")
        .arg("127.0.0.1")
        .arg("--port")
        .arg("4096")
        .env("OPENCODE_SERVER_PASSWORD", "")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    cmd.spawn().map_err(|e| format!("Failed to spawn 'opencode serve': {e}"))
}

#[cfg(not(mobile))]
fn resolve_opencode_bin() -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Some(dir) = std::env::var_os("OPENCODE_INSTALL_DIR") {
        candidates.push(PathBuf::from(dir).join("opencode"));
    }

    if let Some(dir) = std::env::var_os("XDG_BIN_DIR") {
        candidates.push(PathBuf::from(dir).join("opencode"));
    }

    if let Some(home) = std::env::var_os("HOME") {
        let home = PathBuf::from(home);
        candidates.push(home.join(".opencode/bin/opencode"));
        candidates.push(home.join("bin/opencode"));
        candidates.push(home.join(".local/bin/opencode"));
    }

    candidates.push(PathBuf::from("/opt/homebrew/bin/opencode"));
    candidates.push(PathBuf::from("/usr/local/bin/opencode"));

    for path in candidates {
        if path.is_file() {
            return Some(path);
        }
    }

    None
}

#[cfg(not(mobile))]
async fn ensure_opencode_running(app: tauri::AppHandle) {
    if check_health(DEFAULT_SERVER_URL).await {
        log::info!("OpenCode server already running at {DEFAULT_SERVER_URL}");
        return;
    }

    let state = app.state::<OpencodeServerState>();
    let started = {
        let Ok(mut guard) = state.child.lock() else {
            return;
        };

        if guard.is_some() {
            return;
        }

        log::info!("Starting OpenCode server: opencode serve --hostname 127.0.0.1 --port 4096");
        match spawn_opencode_server() {
            Ok(child) => {
                *guard = Some(child);
                true
            }
            Err(err) => {
                log::error!("{err}");
                false
            }
        }
    };

    if !started {
        return;
    }

    if wait_for_health(DEFAULT_SERVER_URL, Duration::from_secs(20)).await {
        log::info!("OpenCode server ready at {DEFAULT_SERVER_URL}");
    } else {
        log::warn!("OpenCode server did not become healthy at {DEFAULT_SERVER_URL} within timeout");
        stop_opencode_server(&app);
    }
}

#[cfg(not(mobile))]
fn stop_opencode_server(app: &tauri::AppHandle) {
    let state = app.state::<OpencodeServerState>();
    let Ok(mut guard) = state.child.lock() else {
        return;
    };

    let Some(mut child) = guard.take() else {
        return;
    };

    log::info!("Stopping OpenCode server (opencode)");
    let _ = child.kill();
    std::thread::spawn(move || {
        let _ = child.wait();
    });
}

// ============================================
// SSE Connection State
// ============================================

/// 用于管理 SSE 连接的全局状态
/// 存储一个可选的 abort flag，用于取消正在进行的 SSE 连接
struct SseState {
    /// 每次连接分配一个递增 ID，用于区分不同连接
    current_id: AtomicU64,
    /// 当前活跃连接的 ID，0 表示无连接
    active_id: AtomicU64,
}

impl Default for SseState {
    fn default() -> Self {
        Self {
            current_id: AtomicU64::new(0),
            active_id: AtomicU64::new(0),
        }
    }
}

// ============================================
// SSE Event Types (sent to frontend via Channel)
// ============================================

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "event", content = "data")]
enum SseEvent {
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

// ============================================
// SSE Commands
// ============================================

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SseConnectArgs {
    url: String,
    auth_header: Option<String>,
}

/// 连接 SSE 流
///
/// 通过 reqwest 在 Rust 侧建立 SSE 连接，完全绕过 WebView 的 CORS 限制。
/// 使用 Tauri Channel 将事件流式发送给前端。
#[tauri::command]
async fn sse_connect(
    state: State<'_, SseState>,
    args: SseConnectArgs,
    on_event: Channel<SseEvent>,
) -> Result<(), String> {
    // 分配连接 ID
    let conn_id = state.current_id.fetch_add(1, Ordering::SeqCst) + 1;
    // 设置为活跃连接
    state.active_id.store(conn_id, Ordering::SeqCst);

    // 构建请求 - 配置超时防止连接静默死亡
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        // 注意：不设置 read timeout，因为 SSE 是长连接，空闲时间可能很长
        // 改用下面的 tokio::time::timeout 包装每次 chunk 读取
        .tcp_keepalive(Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;
    let mut req = client.get(&args.url);

    if let Some(ref auth) = args.auth_header {
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
    let mut buffer = String::new();
    let mut event_data = String::new();

    loop {
        // 检查是否被要求断开
        if state.active_id.load(Ordering::SeqCst) != conn_id {
            let _ = on_event.send(SseEvent::Disconnected {
                reason: "Disconnected by client".to_string(),
            });
            return Ok(());
        }

        match tokio::time::timeout(READ_TIMEOUT, stream.next()).await {
            Ok(Some(Ok(chunk))) => {
                let text = String::from_utf8_lossy(&chunk);
                buffer.push_str(&text);

                // 按行解析 SSE 协议
                while let Some(newline_pos) = buffer.find('\n') {
                    let line = buffer[..newline_pos].to_string();
                    buffer = buffer[newline_pos + 1..].to_string();

                    let line = line.trim_end_matches('\r');

                    if let Some(stripped) = line.strip_prefix("data:") {
                        let data = stripped.trim();
                        if !data.is_empty() {
                            if !event_data.is_empty() {
                                event_data.push('\n');
                            }
                            event_data.push_str(data);
                        }
                        continue;
                    }

                    if line.is_empty() {
                        if !event_data.is_empty() {
                            let _ = on_event.send(SseEvent::Message {
                                raw: event_data.clone(),
                            });
                            event_data.clear();
                        }
                        continue;
                    }

                    // 忽略 event:, id:, retry: 等 SSE 字段
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
                let msg = format!("SSE read timeout ({}s without data)", READ_TIMEOUT.as_secs());
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
async fn sse_disconnect(state: State<'_, SseState>) -> Result<(), String> {
    state.active_id.store(0, Ordering::SeqCst);
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .manage(SseState::default())
        .manage(OpencodeServerState::default())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // 始终启用 log 插件，方便排查问题
            app.handle().plugin(
                tauri_plugin_log::Builder::default()
                    .level(log::LevelFilter::Info)
                    .build(),
            )?;

            // 自动打开 devtools，方便调试（相当于浏览器 F12）
            #[cfg(debug_assertions)]
            if let Some(window) = app.get_webview_window("main") {
                window.open_devtools();
            }

            #[cfg(not(mobile))]
            {
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    ensure_opencode_running(handle).await;
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![sse_connect, sse_disconnect])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app, event| {
            #[cfg(not(mobile))]
            if matches!(event, tauri::RunEvent::Exit) {
                stop_opencode_server(app);
            }
        });
}
