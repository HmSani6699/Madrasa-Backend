// const dotenv = require("dotenv");
// dotenv.config();

// const dns = require("dns");
// dns.setServers(["8.8.8.8", "8.8.4.4"]);

// const express = require("express");
// const cors = require("cors");

// const app = express();
// global.app = app;

// app.set("superSecret", "djkzandjkawsuodxsmsakjuhkj");

// /* =========================
//    CORS CONFIGURATION
// ========================= */

// const allowedOrigins = process.env.ALLOWED_ORIGINS
//   ? process.env.ALLOWED_ORIGINS.split(",").map(o => o.trim())
//   : [];

// console.log("Allowed Origins:", allowedOrigins);

// app.use(
//   cors({
//     origin: function (origin, callback) {
//       // Allow requests with no origin (like Postman)
//       if (!origin) return callback(null, true);

//       if (allowedOrigins.includes(origin)) {
//         return callback(null, true);
//       } else {
//         console.log("❌ Blocked by CORS:", origin);
//         return callback(new Error("Not allowed by CORS"));
//       }
//     },
//     credentials: true,
//     methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
//     allowedHeaders: ["Content-Type", "Authorization"],
//   })
// );

// // Handle preflight requests
// app.options("*", cors());

// /* =========================
//    BODY PARSER
// ========================= */

// app.use(express.json({ limit: "50mb" }));
// app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// /* =========================
//    ROUTES
// ========================= */

// app.use("/api", require("./api/status"));
// app.use("/api/auth", require("./api/auth"));
// app.use("/api/super-admin", require("./api/super-admin"));
// app.use("/api", require("./api/person"));
// app.use("/api/portal", require("./api/portal"));

// app.use("/api", require("./api/admission"));
// app.use("/api", require("./api/parent"));
// app.use("/api", require("./api/designation"));
// app.use("/api", require("./api/staff"));
// app.use("/api", require("./api/student"));
// app.use("/api", require("./api/attendance"));
// app.use("/api", require("./api/class"));
// app.use("/api", require("./api/section"));
// app.use("/api/subject-types", require("./api/subjectType"));
// app.use("/api", require("./api/subject"));
// app.use("/api", require("./api/classRoutine"));
// app.use("/api", require("./api/homework"));
// app.use("/api", require("./api/academicReport"));
// app.use("/api", require("./api/examName"));
// app.use("/api", require("./api/exam"));
// app.use("/api", require("./api/examSchedule"));
// app.use("/api", require("./api/grade"));
// app.use("/api", require("./api/result"));

// app.use("/api/fee-setup", require("./api/feeSetup"));
// app.use("/api/fee-management/v1", require("./api/feeManagement/v1"));
// app.use("/api", require("./api/account/v1"));
// app.use("/api", require("./api/transaction/v1"));
// app.use("/api", require("./api/sms/v1"));
// app.use("/api", require("./api/book/v1"));
// app.use("/api", require("./api/bookIssue/v1"));
// app.use("/api", require("./api/certificate/v1"));
// app.use("/api", require("./api/salarySetup"));
// app.use("/api", require("./api/salaryPayment"));
// app.use("/api/payroll/v1", require("./api/payroll/v1"));
// app.use("/api", require("./api/class-assign"));
// app.use("/api", require("./api/ClassSyllabus"));
// app.use("/api/fee-type", require("./api/FeeType"));

// /* =========================
//    GLOBAL ERROR HANDLER  gggod
// ========================= */

// app.use((err, req, res, next) => {
//   console.error("Global Error:", err.message);
//   res.status(500).json({
//     success: false,
//     message: err.message || "Internal Server Error",
//   });
// });

// /* =========================
//    SERVER START
// ========================= */

// const port = process.env.PORT || 3001;

// app.listen(port, () => {
//   console.log(`🚀 Server running on port ${port}`);
//   console.log(`🌍 Allowed Origins: ${JSON.stringify(allowedOrigins)}`);
// });










// =========================vercel ====================


// require("dotenv").config();

// const express = require("express");
// const cors = require("cors");

// const app = express();

// global.app = app;

// /* =========================
//    APP CONFIGURATION
// ========================= */

// // Keep JWT secret in environment variables
// app.set("superSecret", process.env.JWT_SECRET);

// /* =========================
//    CORS CONFIGURATION
// ========================= */

// const allowedOrigins = process.env.ALLOWED_ORIGINS
//   ? process.env.ALLOWED_ORIGINS.split(",").map(o => o.trim()).filter(Boolean)
//   : [];

// console.log("Allowed Origins:", allowedOrigins);

// const corsOptions = {
//   origin: function (origin, callback) {
//     // Allow requests without an Origin header (Postman, server-to-server)
//     if (!origin) {
//       return callback(null, true);
//     }

//     if (allowedOrigins.includes(origin)) {
//       return callback(null, true);
//     }

//     console.log("Blocked by CORS:", origin);
//     return callback(new Error("Not allowed by CORS"));
//   },

//   credentials: true,

//   methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],

//   allowedHeaders: ["Content-Type", "Authorization"]
// };

// app.use(cors(corsOptions));

// /* =========================
//    BODY PARSER
// ========================= */

// app.use(express.json({ limit: "50mb" }));

// app.use(
//   express.urlencoded({
//     extended: true,
//     limit: "50mb"
//   })
// );

// /* =========================
//    ROUTES
// ========================= */

// app.use("/api", require("./api/status"));

// app.use("/api/auth", require("./api/auth"));

// app.use("/api/super-admin", require("./api/super-admin"));

// app.use("/api", require("./api/person"));

// app.use("/api/portal", require("./api/portal"));

// app.use("/api", require("./api/admission"));

// app.use("/api", require("./api/parent"));

// app.use("/api", require("./api/designation"));

// app.use("/api", require("./api/staff"));

// app.use("/api", require("./api/student"));

// app.use("/api", require("./api/attendance"));

// app.use("/api", require("./api/class"));

// app.use("/api", require("./api/section"));

// app.use("/api/subject-types", require("./api/subjectType"));

// app.use("/api", require("./api/subject"));

// app.use("/api", require("./api/classRoutine"));

// app.use("/api", require("./api/homework"));

// app.use("/api", require("./api/academicReport"));

// app.use("/api", require("./api/examName"));

// app.use("/api", require("./api/exam"));

// app.use("/api", require("./api/examSchedule"));

// app.use("/api", require("./api/grade"));

// app.use("/api", require("./api/result"));

// app.use("/api/fee-setup", require("./api/feeSetup"));

// app.use("/api/fee-management/v1", require("./api/feeManagement/v1"));

// app.use("/api", require("./api/account/v1"));

// app.use("/api", require("./api/transaction/v1"));

// app.use("/api", require("./api/sms/v1"));

// app.use("/api", require("./api/book/v1"));

// app.use("/api", require("./api/bookIssue/v1"));

// app.use("/api", require("./api/certificate/v1"));

// app.use("/api", require("./api/salarySetup"));

// app.use("/api", require("./api/salaryPayment"));

// app.use("/api/payroll/v1", require("./api/payroll/v1"));

// app.use("/api", require("./api/class-assign"));

// app.use("/api", require("./api/ClassSyllabus"));

// app.use("/api/fee-type", require("./api/FeeType"));

// /* =========================
//    404 HANDLER
// ========================= */

// app.use((req, res) => {
//   res.status(404).json({
//     success: false,
//     message: "API endpoint not found",
//     path: req.originalUrl
//   });
// });

// /* =========================
//    GLOBAL ERROR HANDLER
// ========================= */

// app.use((err, req, res, next) => {
//   console.error("Global Error:", err.message);

//   if (res.headersSent) {
//     return next(err);
//   }

//   const statusCode =
//     err.message === "Not allowed by CORS" ? 403 : 500;

//   res.status(statusCode).json({
//     success: false,
//     message: err.message || "Internal Server Error"
//   });
// });

// /* =========================
//    SERVER START & EXPORT
// ========================= */

// const PORT = process.env.PORT || 3001;

// // Local development server
// if (require.main === module) {
//   app.listen(PORT, () => {
//     console.log(`Server running on port ${PORT}`);
//     console.log(
//       `Allowed Origins: ${JSON.stringify(allowedOrigins)}`
//     );
//   });
// }

// // Vercel Serverless Function
// module.exports = app;




// ===============================================

require("dotenv").config();

const express = require("express");
const cors = require("cors");

const app = express();

global.app = app;

/* =========================
   APP CONFIGURATION
========================= */

app.set("superSecret", process.env.JWT_SECRET);

/* =========================
   CORS CONFIGURATION
========================= */

const defaultAllowedOrigins = [
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:5173",
  "https://www.madrasasheba.com",
  "https://madrasasheba.com",
  "https://madrasasheba.vercel.app"
];

const envOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS
    .split(",")
    .map(origin => origin.trim())
    .filter(Boolean)
  : [];

const allowedOrigins = Array.from(new Set([...defaultAllowedOrigins, ...envOrigins]));

console.log("Allowed Origins:", allowedOrigins);

const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests without an Origin header (Postman, mobile, curl)
    if (!origin) {
      return callback(null, true);
    }

    const isAllowed =
      allowedOrigins.includes(origin) ||
      /^https?:\/\/(.+\.)?madrasasheba\.com(:\d+)?$/.test(origin) ||
      /^https?:\/\/(.+\.)?vercel\.app(:\d+)?$/.test(origin);

    if (isAllowed) {
      return callback(null, true);
    }

    console.log("Blocked by CORS:", origin);

    return callback(new Error("Not allowed by CORS"));
  },

  credentials: true,

  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],

  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "Accept", "Origin"]
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

/* =========================
   BODY PARSER
========================= */

app.use(express.json({ limit: "50mb" }));

app.use(
  express.urlencoded({
    extended: true,
    limit: "50mb"
  })
);

/* =========================
   ROUTE CONFIGURATION
   All routes are loaded from
   the renamed "routes" folder.
========================= */

const routeDefinitions = [
  ["/api", "status"],
  ["/api/auth", "auth"],
  ["/api/super-admin", "super-admin"],
  ["/api", "person"],
  ["/api/portal", "portal"],
  ["/api", "admission"],
  ["/api", "parent"],
  ["/api", "designation"],
  ["/api", "staff"],
  ["/api", "student"],
  ["/api", "attendance"],
  ["/api", "class"],
  ["/api", "section"],
  ["/api/subject-types", "subjectType"],
  ["/api", "subject"],
  ["/api", "classRoutine"],
  ["/api", "homework"],
  ["/api", "academicReport"],
  ["/api", "examName"],
  ["/api", "exam"],
  ["/api", "examSchedule"],
  ["/api", "grade"],
  ["/api", "result"],
  ["/api/fee-setup", "feeSetup"],
  ["/api/fee-management/v1", "feeManagement/v1"],
  ["/api", "account/v1"],
  ["/api", "transaction/v1"],
  ["/api", "sms/v1"],
  ["/api", "book/v1"],
  ["/api", "bookIssue/v1"],
  ["/api", "certificate/v1"],
  ["/api", "salarySetup"],
  ["/api", "salaryPayment"],
  ["/api/payroll/v1", "payroll/v1"],
  ["/api", "class-assign"],
  ["/api", "ClassSyllabus"],
  ["/api/fee-type", "FeeType"],
  ["/api/demo-request", "demoRequest"],
  ["/api/reviews", "review"]
];

/* =========================
   REGISTER ALL ROUTES
========================= */

routeDefinitions.forEach(([basePath, routeFile]) => {
  const router = require("./routes/" + routeFile);

  app.use(basePath, router);

  console.log(`Route registered: ${basePath} -> ${routeFile}`);
});

/* =========================
   HEALTH CHECK
========================= */

app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Madrasa Backend API is running",
    environment: process.env.NODE_ENV || "production"
  });
});

/* =========================
   404 HANDLER
========================= */

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "API endpoint not found",
    path: req.originalUrl
  });
});

/* =========================
   GLOBAL ERROR HANDLER
========================= */

app.use((err, req, res, next) => {
  console.error("Global Error:", err.message);

  if (res.headersSent) {
    return next(err);
  }

  const statusCode =
    err.message === "Not allowed by CORS" ? 403 : 500;

  res.status(statusCode).json({
    success: false,
    message: err.message || "Internal Server Error"
  });
});

/* =========================
   SERVER START & EXPORT
========================= */

const PORT = process.env.PORT || 3001;

// Local development
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);

    console.log(
      "Allowed Origins:",
      JSON.stringify(allowedOrigins)
    );
  });
}

// Vercel Serverless Function
module.exports = app;

