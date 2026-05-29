use axum::http::HeaderMap;
use vos_course::User;

use crate::{AppState, PortalError, PortalResult};

pub async fn user_from_headers(state: &AppState, headers: &HeaderMap) -> PortalResult<User> {
    let token = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .or_else(|| {
            headers
                .get("x-vos-token")
                .and_then(|value| value.to_str().ok())
        })
        .ok_or(PortalError::Unauthorized)?;
    state.user_for_token(token).await
}
