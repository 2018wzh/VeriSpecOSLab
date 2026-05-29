mod adapters;
mod auth;
mod config;
mod error;
#[cfg(feature = "postgres")]
mod postgres_crud;
#[cfg(feature = "postgres")]
mod postgres_store;
mod routes;
mod state;
mod store;
mod time;

pub use config::PortalConfig;
pub use error::{PortalError, PortalResult};
#[cfg(feature = "postgres")]
pub use postgres_store::PostgresStore;
pub use routes::router;
pub use state::AppState;
pub use store::InMemoryStore;
