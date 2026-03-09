use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SseConnectArgs {
    url: String,
    auth_header: Option<String>,
}

impl SseConnectArgs {
    #[inline(always)]
    pub fn url(&self) -> &str {
        &self.url
    }

    #[inline(always)]
    pub fn auth_header(&self) -> Option<&str> {
        self.auth_header.as_deref()
    }
}
