const dotenv = require("dotenv");
dotenv.config();

const dns = require("dns");
dns.setServers(["8.8.8.8", "8.8.4.4"]);

const express = require("express");
const cors = require("cors");

const app = express();
global.app = app;

app.set("superSecret", "djkzandjkawsuodxsmsakjuhkj");

/* =========================
   CORS CONFIGURATION
========================= */

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map(o => o.trim())
  : [];

console.log("Allowed Origins:", allowedOrigins);

app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (like Postman)
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      } else {
        console.log("❌ Blocked by CORS:", origin);
        return callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// Handle preflight requests
app.options("*", cors());

/* =========================
   BODY PARSER
========================= */

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

/* =========================
   ROUTES
========================= */

app.use("/api", require("./api/status"));
app.use("/api/auth", require("./api/auth"));
app.use("/api/super-admin", require("./api/super-admin"));
app.use("/api", require("./api/person"));
app.use("/api/portal", require("./api/portal"));

app.use("/api", require("./api/admission"));
app.use("/api", require("./api/parent"));
app.use("/api", require("./api/designation"));
app.use("/api", require("./api/staff"));
app.use("/api", require("./api/student"));
app.use("/api", require("./api/attendance"));
app.use("/api", require("./api/class"));
app.use("/api", require("./api/section"));
app.use("/api", require("./api/subject"));
app.use("/api", require("./api/classRoutine"));
app.use("/api", require("./api/homework"));
app.use("/api", require("./api/academicReport"));
app.use("/api", require("./api/examName"));
app.use("/api", require("./api/exam"));
app.use("/api", require("./api/examSchedule"));
app.use("/api", require("./api/grade"));
app.use("/api", require("./api/result"));

app.use("/api/fee-setup", require("./api/feeSetup"));
app.use("/api", require("./api/account/v1"));
app.use("/api", require("./api/transaction/v1"));
app.use("/api", require("./api/sms/v1"));
app.use("/api", require("./api/book/v1"));
app.use("/api", require("./api/bookIssue/v1"));
app.use("/api", require("./api/certificate/v1"));
app.use("/api", require("./api/salarySetup"));
app.use("/api", require("./api/salaryPayment"));
app.use("/api", require("./api/class-assign"));
app.use("/api", require("./api/ClassSyllabus"));
app.use("/api/fee-type", require("./api/FeeType"));

/* =========================
   GLOBAL ERROR HANDLER  gggod
========================= */

app.use((err, req, res, next) => {
  console.error("Global Error:", err.message);
  res.status(500).json({
    success: false,
    message: err.message || "Internal Server Error",
  });
});

/* =========================
   SERVER START
========================= */

const port = process.env.PORT || 3001;

app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
  console.log(`🌍 Allowed Origins: ${JSON.stringify(allowedOrigins)}`);
});