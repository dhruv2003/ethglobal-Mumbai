const express = require("express");
const cors = require("cors");
require("dotenv").config();

const path = require("node:path");
const fs = require("node:fs");

const app = express();

// Behind a hosting proxy (Railway, Fly, Render...), set TRUST_PROXY to the number of proxy hops
// (usually 1) so req.ip is the visitor, not the proxy, and per-IP rate limits work.
if (process.env.TRUST_PROXY) {
    const n = Number(process.env.TRUST_PROXY);
    app.set("trust proxy", Number.isInteger(n) ? n : process.env.TRUST_PROXY);
}

// Only our own web app may call the API from a browser (CORS_ORIGIN, comma-separated).
const allowed = (process.env.CORS_ORIGIN || "http://localhost:5173,http://localhost:4173,http://127.0.0.1:5173,http://127.0.0.1:4173").split(",").map((s) => s.trim());
app.use(cors({ origin: allowed }));
app.use(express.json({ limit: "1mb" }));


// Judges, submissions and reviews (ES module, loaded once at startup).
process.env.ARENA_SERVER = "1"; // lets the API resume the review queue (the CLI doesn't)
const ready = import("./api.mjs").then(({ router }) => {
    app.use("/api", router);

    // In production one server hosts both: the built web app (WEB_DIST, default frontend/web/dist)
    // on the same origin as /api, so there is no CORS or proxy in between.
    const dist = path.resolve(process.env.WEB_DIST || path.join(__dirname, "../../frontend/web/dist"));
    if (fs.existsSync(path.join(dist, "index.html"))) {
        app.use(express.static(dist, {
            index: false,
            setHeaders(res, file) {
                // Hashed assets never change; the shell and service worker must always be fresh.
                if (file.includes(`${path.sep}assets${path.sep}`)) res.setHeader("cache-control", "public, max-age=31536000, immutable");
                else res.setHeader("cache-control", "no-cache");
            },
        }));
        // Client-side routes (/projects/x, /arena...) get the app shell; unknown /api paths stay 404.
        app.use((req, res, next) => {
            if (req.method !== "GET" && req.method !== "HEAD") return next();
            // /api and missing files (a stale /assets/x.js) must 404, never get the HTML shell.
            if (req.path === "/api" || req.path.startsWith("/api/") || path.extname(req.path)) return next();
            res.setHeader("cache-control", "no-cache");
            res.sendFile(path.join(dist, "index.html"));
        });
        console.log(`Serving the web app from ${dist}`);
    } else {
        app.get("/", (req, res) => res.json({ message: "Backend running!" }));
    }
});

const PORT = process.env.PORT || 3000;

ready.then(() => {
    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
});
