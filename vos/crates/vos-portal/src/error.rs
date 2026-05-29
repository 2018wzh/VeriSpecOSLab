use axum::Json;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde_json::json;
use thiserror::Error;
use uuid::Uuid;

pub type PortalResult<T> = Result<T, PortalError>;

#[derive(Debug, Error)]
pub enum PortalError {
    #[error("not found: {0}")]
    NotFound(String),
    #[error("unauthorized")]
    Unauthorized,
    #[error("forbidden")]
    Forbidden,
    #[error("bad request: {0}")]
    BadRequest(String),
    #[error("conflict: {0}")]
    Conflict(String),
    #[error("adapter error: {0}")]
    Adapter(String),
    #[error("database error: {0}")]
    Database(String),
    #[error("internal error: {0}")]
    Internal(String),
}

impl PortalError {
    pub fn missing(entity: &str, id: Uuid) -> Self {
        Self::NotFound(format!("{entity} {id}"))
    }

    fn status(&self) -> StatusCode {
        match self {
            Self::NotFound(_) => StatusCode::NOT_FOUND,
            Self::Unauthorized => StatusCode::UNAUTHORIZED,
            Self::Forbidden => StatusCode::FORBIDDEN,
            Self::BadRequest(_) => StatusCode::BAD_REQUEST,
            Self::Conflict(_) => StatusCode::CONFLICT,
            Self::Adapter(_) | Self::Database(_) | Self::Internal(_) => {
                StatusCode::INTERNAL_SERVER_ERROR
            }
        }
    }
}

impl IntoResponse for PortalError {
    fn into_response(self) -> Response {
        let status = self.status();
        let body = Json(json!({
            "ok": false,
            "error": {
                "status": status.as_u16(),
                "message": self.to_string(),
            }
        }));
        (status, body).into_response()
    }
}

impl From<vos_course::CourseAdapterError> for PortalError {
    fn from(value: vos_course::CourseAdapterError) -> Self {
        Self::Adapter(value.to_string())
    }
}

#[cfg(feature = "postgres")]
impl From<sqlx::Error> for PortalError {
    fn from(value: sqlx::Error) -> Self {
        Self::Database(value.to_string())
    }
}
