const requested = process.argv[2];
if (requested !== "production" && requested !== "demo") throw new Error("Expected production or demo build mode");
if (requested === "production" && process.env.VOS_PORTAL_DEMO === "1") throw new Error("Production build refuses Demo configuration");
if (requested === "demo" && process.env.DATABASE_URL) throw new Error("Demo build refuses DATABASE_URL");
console.log(`VOS Portal ${requested} build boundary validated`);
