const express = require("express");
const cors = require("cors");
require("dotenv").config();

const app = express();

app.use(cors());
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
