use std::net::SocketAddr;

use tokio::net::TcpListener;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};
use vos_portal::{AppState, PortalConfig, router};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "vos_portal=info,tower_http=info".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    let config = PortalConfig::from_env();
    let state = AppState::demo(config.clone()).await?;
    let app = router(state);
    let addr = SocketAddr::from((config.host, config.port));
    let listener = TcpListener::bind(addr).await?;

    tracing::info!(%addr, "vos-portal listening");
    axum::serve(listener, app).await?;
    Ok(())
}
