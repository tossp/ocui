// ============================================
// Unified Bridge Commands
//
// A single set of Tauri commands that transparently proxies both
// HTTP streaming (SSE) and WebSocket (PTY) connections.
//
// The frontend picks the transport by URL scheme:
//   ws:// / wss://   → WebSocket (bidirectional)
//   http:// / https:// → HTTP stream  (read-only)
// ============================================

use crate::app::bridge::{
    BridgeCommand, BridgeConnection, BridgeEvent, BridgeKey, BridgeState,
    ConnectArgs, DisconnectArgs, SendArgs,
};
use futures_util::{SinkExt, StreamExt};
use std::time::Duration;
use tauri::{ipc::Channel, State};
use tokio::sync::mpsc;

fn emit(channel: &Channel<BridgeEvent>, event: BridgeEvent) {
    let _ = channel.send(event);
}

// ============================================
// bridge_connect — auto-selects transport
// ============================================

#[tauri::command]
pub async fn bridge_connect(
    window: tauri::Window,
    state: State<'_, BridgeState>,
    args: ConnectArgs,
    on_event: Channel<BridgeEvent>,
) -> Result<(), String> {
    if args.is_websocket() {
        connect_ws(window, state, args, on_event).await
    } else {
        connect_stream(window, state, args, on_event).await
    }
}

// ============================================
// bridge_send — WebSocket only
// ============================================

#[tauri::command]
pub async fn bridge_send(
    window: tauri::Window,
    state: State<'_, BridgeState>,
    args: SendArgs,
) -> Result<(), String> {
    let key = BridgeKey::new(window.label(), args.bridge_id());
    let sender = state
        .sender(&key)
        .ok_or_else(|| format!("bridge '{}' is not active", args.bridge_id()))?;

    sender
        .send(BridgeCommand::Send(args.data().to_string()))
        .map_err(|_| format!("bridge '{}' is closed", args.bridge_id()))
}

// ============================================
// bridge_disconnect
// ============================================

#[tauri::command]
pub async fn bridge_disconnect(
    window: tauri::Window,
    state: State<'_, BridgeState>,
    args: DisconnectArgs,
) -> Result<(), String> {
    let key = BridgeKey::new(window.label(), args.bridge_id());
    state.disconnect(&key);
    Ok(())
}

// ============================================
// HTTP stream transport (for SSE)
// ============================================

async fn connect_stream(
    window: tauri::Window,
    state: State<'_, BridgeState>,
    args: ConnectArgs,
    on_event: Channel<BridgeEvent>,
) -> Result<(), String> {
    let conn_id = state.next_conn_id();
    let key = BridgeKey::new(window.label(), args.bridge_id());

    // Replace any previous connection with the same key
    if let Some(prev) = state.replace(key.clone(), BridgeConnection::new_stream(conn_id)) {
        if let Some(tx) = prev.tx {
            let _ = tx.send(BridgeCommand::Close);
        }
    }

    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .tcp_keepalive(Duration::from_secs(30))
        .build()
        .map_err(|e| format!("failed to create HTTP client: {}", e))?;

    let mut req = client.get(args.url());
    if let Some(auth) = args.auth_header() {
        req = req.header("Authorization", auth);
    }

    let response = match req.send().await {
        Ok(r) => r,
        Err(e) => {
            let msg = format!("HTTP stream connection failed: {}", e);
            emit(&on_event, BridgeEvent::Error { message: msg.clone() });
            state.remove_if_current(&key, conn_id);
            return Err(msg);
        }
    };

    if !response.status().is_success() {
        let msg = format!("HTTP stream server returned {}", response.status());
        emit(&on_event, BridgeEvent::Error { message: msg.clone() });
        state.remove_if_current(&key, conn_id);
        return Err(msg);
    }

    emit(&on_event, BridgeEvent::Connected);

    // Read timeout — if no data arrives for 90s the connection is likely dead
    const READ_TIMEOUT: Duration = Duration::from_secs(90);
    let mut stream = response.bytes_stream();

    loop {
        // Check cancellation (disconnect or replaced by a new connect)
        if !state.is_current(&key, conn_id) {
            emit(&on_event, BridgeEvent::Disconnected {
                code: None,
                reason: "Disconnected by client".to_string(),
            });
            return Ok(());
        }

        match tokio::time::timeout(READ_TIMEOUT, stream.next()).await {
            Ok(Some(Ok(chunk))) => {
                let text = String::from_utf8_lossy(&chunk).into_owned();
                emit(&on_event, BridgeEvent::Data { data: text });
            }
            Ok(Some(Err(e))) => {
                let msg = format!("HTTP stream error: {}", e);
                emit(&on_event, BridgeEvent::Error { message: msg.clone() });
                state.remove_if_current(&key, conn_id);
                return Err(msg);
            }
            Ok(None) => {
                state.remove_if_current(&key, conn_id);
                emit(&on_event, BridgeEvent::Disconnected {
                    code: None,
                    reason: "Stream ended".to_string(),
                });
                return Ok(());
            }
            Err(_) => {
                let msg = format!(
                    "HTTP stream read timeout ({}s without data)",
                    READ_TIMEOUT.as_secs()
                );
                emit(&on_event, BridgeEvent::Error { message: msg.clone() });
                state.remove_if_current(&key, conn_id);
                return Err(msg);
            }
        }
    }
}

// ============================================
// WebSocket transport (for PTY)
// ============================================

async fn connect_ws(
    window: tauri::Window,
    state: State<'_, BridgeState>,
    args: ConnectArgs,
    on_event: Channel<BridgeEvent>,
) -> Result<(), String> {
    use tokio_tungstenite::{
        connect_async,
        tungstenite::{client::IntoClientRequest, http::HeaderValue, Error as WsError, Message},
    };

    let conn_id = state.next_conn_id();
    let key = BridgeKey::new(window.label(), args.bridge_id());
    let (tx, mut rx) = mpsc::unbounded_channel();

    // Replace any previous connection with the same key
    if let Some(prev) = state.replace(key.clone(), BridgeConnection::new_ws(conn_id, tx)) {
        if let Some(prev_tx) = prev.tx {
            let _ = prev_tx.send(BridgeCommand::Close);
        }
    }

    let mut request = args
        .url()
        .into_client_request()
        .map_err(|e| format!("invalid WebSocket URL: {}", e))?;

    if let Some(auth) = args.auth_header() {
        let value = HeaderValue::from_str(auth)
            .map_err(|e| format!("invalid Authorization header: {}", e))?;
        request.headers_mut().insert("Authorization", value);
    }

    let (ws_stream, _) = match connect_async(request).await {
        Ok(result) => result,
        Err(error) => {
            let message = match error {
                WsError::Http(response) => format!("WebSocket server returned {}", response.status()),
                other => format!("WebSocket connection failed: {}", other),
            };
            emit(&on_event, BridgeEvent::Error { message: message.clone() });
            state.remove_if_current(&key, conn_id);
            return Err(message);
        }
    };

    emit(&on_event, BridgeEvent::Connected);

    let (mut write, mut read) = ws_stream.split();

    loop {
        tokio::select! {
            outbound = rx.recv() => match outbound {
                Some(BridgeCommand::Send(data)) => {
                    if let Err(error) = write.send(Message::Text(data.into())).await {
                        let msg = format!("WebSocket write failed: {}", error);
                        emit(&on_event, BridgeEvent::Error { message: msg.clone() });
                        state.remove_if_current(&key, conn_id);
                        return Err(msg);
                    }
                }
                Some(BridgeCommand::Close) | None => {
                    let _ = write.close().await;
                    state.remove_if_current(&key, conn_id);
                    emit(&on_event, BridgeEvent::Disconnected {
                        code: Some(1000),
                        reason: "Disconnected by client".to_string(),
                    });
                    return Ok(());
                }
            },
            inbound = read.next() => match inbound {
                Some(Ok(message)) => match message {
                    Message::Text(text) => {
                        emit(&on_event, BridgeEvent::Data { data: text.to_string() });
                    }
                    Message::Binary(bytes) => {
                        emit(&on_event, BridgeEvent::Data {
                            data: String::from_utf8_lossy(&bytes).into_owned(),
                        });
                    }
                    Message::Ping(payload) => {
                        if let Err(error) = write.send(Message::Pong(payload)).await {
                            let msg = format!("WebSocket pong failed: {}", error);
                            emit(&on_event, BridgeEvent::Error { message: msg.clone() });
                            state.remove_if_current(&key, conn_id);
                            return Err(msg);
                        }
                    }
                    Message::Pong(_) => {}
                    Message::Close(frame) => {
                        let code = frame.as_ref().map(|f| u16::from(f.code));
                        let reason = frame
                            .map(|f| f.reason.to_string())
                            .unwrap_or_else(|| "Connection closed by server".to_string());
                        state.remove_if_current(&key, conn_id);
                        emit(&on_event, BridgeEvent::Disconnected { code, reason });
                        return Ok(());
                    }
                    _ => {}
                },
                Some(Err(error)) => {
                    let msg = format!("WebSocket stream error: {}", error);
                    emit(&on_event, BridgeEvent::Error { message: msg.clone() });
                    state.remove_if_current(&key, conn_id);
                    return Err(msg);
                }
                None => {
                    state.remove_if_current(&key, conn_id);
                    emit(&on_event, BridgeEvent::Disconnected {
                        code: None,
                        reason: "Stream ended".to_string(),
                    });
                    return Ok(());
                }
            }
        }
    }
}
