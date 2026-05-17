mod app;
mod args;
mod dispatch;
mod render;

#[tokio::main]
async fn main() {
    app::run().await;
}
