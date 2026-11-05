const express = require("express");
const cors = require("cors");
require("dotenv").config();

const app = express();

// Only our own web app may call the API from a browser (CORS_ORIGIN, comma-separated).
const allowed = (process.env.CORS_ORIGIN || "http://localhost:5173,http://localhost:4173,http://127.0.0.1:5173,http://127.0.0.1:4173").split(",").map((s) => s.trim());
app.use(cors({ origin: allowed }));
app.use(express.json({ limit: "1mb" }));

app.get("/", (req, res) => {
    res.json({ message: "Backend running!" });
});

// Judges, submissions and reviews (ES module, loaded once at startup).
const ready = import("./api.mjs").then(({ router }) => {
    app.use("/api", router);
});

const PORT = process.env.PORT || 3000;

ready.then(() => {
    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
});
