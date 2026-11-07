import { createServer } from "node:http";
import express from "express";
import path from "path";
import cors from "cors";
import { Server } from "socket.io";
import { prisma } from "./db/prisma";
import helmet from "helmet";
import { MulterError } from "multer";
import { verifyToken } from "./lib/jwt";

// Routers
import { authRouter } from "./routes/auth.routes";
import { medicinesRouter } from "./routes/medicines.routes";
import { ordersRouter } from "./routes/orders.routes";
import { paymentRouter } from "./routes/payment.routes";
import { webhookRouter } from "./routes/webhook.routes";
import { inventoryRouter } from "./routes/inventory.routes";
import { pharmaciesRouter } from "./routes/pharmacies.routes";
import { usersRouter } from "./routes/users.routes";
import { adminRouter } from "./routes/admin.routes";
import prescriptionsRouter from "./routes/prescriptions.routes";
import { validateRazorpayConfig, isRazorpayMode } from "./services/RazorpayService";
import { PaymentError } from "./controllers/payment.controller";

// Custom error classes
import {
  CheckoutValidationError,
  InsufficientStockError,
  OrderNotFoundError,
} from "./controllers/orders.controller";
import { AuthError } from "./middleware/auth.middleware";
import { AuthValidationError } from "./controllers/auth.controller";
import { InventoryValidationError } from "./controllers/inventory.controller";

// Validate Razorpay config at startup (only when Razorpay mode is enabled)
if (isRazorpayMode()) {
  validateRazorpayConfig();
}

const PORT = Number(process.env.PORT) || 8080;
const app = express();

// ─── Middleware ────────────────────────────────────────────────────────────────

app.use(helmet({ contentSecurityPolicy: false }));
app.use(
  cors({
    origin: process.env.NODE_ENV === "production" ? process.env.CLIENT_URL : ["http://localhost:5173", "http://localhost:3000"],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

// ─── Webhook route MUST be registered BEFORE express.json() ──────────────────
// Razorpay webhook signature verification requires the EXACT raw request body.
// express.json() would parse and re-serialize the body, breaking the HMAC check.
app.use("/api/webhooks",
  express.raw({ type: "application/json", limit: "1mb" }),
  webhookRouter
);

// All other routes use JSON parsing
app.use(express.json());
app.use((req, _res, next) => {
  req.body ??= {};
  next();
});

// ─── Routes ───────────────────────────────────────────────────────────────────

app.get("/health", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true, timestamp: new Date().toISOString() });
  } catch (err) {
    console.error("[health] database check failed:", err);
    res.status(503).json({
      ok: false,
      error: "Database unavailable",
      timestamp: new Date().toISOString(),
    });
  }
});

app.use("/api/auth", authRouter);
app.use("/api/medicines", medicinesRouter);
app.use("/api/orders", ordersRouter);
app.use("/api", paymentRouter);
app.use("/api/inventory", inventoryRouter);
app.use("/api/pharmacies", pharmaciesRouter);
app.use("/api/users", usersRouter);
app.use("/api/admin", adminRouter);
app.use("/api", prescriptionsRouter);

// ─── Global Error Handler ─────────────────────────────────────────────────────

app.use(
  (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    let statusCode = 500;
    let code = "INTERNAL_SERVER_ERROR";
    let message = "Internal server error";

    if (err instanceof MulterError) {
      statusCode = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      code = 'UPLOAD_ERROR';
      message = err.code === 'LIMIT_FILE_SIZE' ? 'Uploaded image is too large' : 'Invalid upload';
    } else if (err instanceof SyntaxError && "status" in err && err.status === 400) {
      statusCode = 400;
      code = "VALIDATION_ERROR";
      message = "Invalid JSON body";
    } else if (err instanceof AuthError) {
      statusCode = err.status;
      code = err.status === 403 ? "FORBIDDEN" : "UNAUTHORIZED";
      message = err.message;
    } else if (err instanceof AuthValidationError) {
      statusCode = 400;
      code = "VALIDATION_ERROR";
      message = err.message;
    } else if (err instanceof InsufficientStockError) {
      statusCode = 409;
      code = "INSUFFICIENT_STOCK";
      message = err.message;
    } else if (err instanceof CheckoutValidationError) {
      statusCode = 400;
      code = "VALIDATION_ERROR";
      message = err.message;
    } else if (err instanceof OrderNotFoundError) {
      statusCode = 404;
      code = "NOT_FOUND";
      message = err.message;
    } else if (err instanceof InventoryValidationError) {
      statusCode = 400;
      code = "VALIDATION_ERROR";
      message = err.message;
    } else if (err instanceof PaymentError) {
      statusCode = err.statusCode;
      code = "PAYMENT_ERROR";
      message = err.message;
    } else {
      console.error(err);
    }

    res.status(statusCode).json({
      success: false,
      error: { code, message }
    });
  },
);

// ─── Serve Frontend (Production) ──────────────────────────────────────────────
if (process.env.NODE_ENV === "production") {
  const frontendPath = path.join(__dirname, "../../customer-app/dist");
  app.use(express.static(frontendPath));

  // Express 5 rejects bare "*" routes; use middleware after static instead.
  app.use((req, res, next) => {
    if (req.path.startsWith("/api") || req.path.startsWith("/health")) return next();
    res.sendFile(path.join(frontendPath, "index.html"));
  });
}

// ─── HTTP + WebSockets (Socket.io) ───────────────────────────────────────────

const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: process.env.NODE_ENV === "production" ? false : "http://localhost:5173",
    methods: ["GET", "POST"],
  },
});

io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error("Authentication error"));
  try {
    const decoded = verifyToken(token);
    socket.data.user = decoded;
    next();
  } catch (err) {
    next(new Error("Authentication error"));
  }
});

io.on("connection", (socket) => {
  console.log(`[socket.io] connected: ${socket.id}`);

  socket.on("disconnect", (reason) => {
    console.log(`[socket.io] disconnected: ${socket.id} (${reason})`);
  });

  socket.on("join_tracking_room", async (orderId: unknown) => {
    const id =
      typeof orderId === "string"
        ? orderId.trim()
        : orderId &&
            typeof orderId === "object" &&
            "orderId" in orderId &&
            typeof (orderId as { orderId: unknown }).orderId === "string"
          ? (orderId as { orderId: string }).orderId.trim()
          : "";
    if (!id) return;
    
    const user = socket.data.user;
    if (!user) return;
    try {
      const order = await prisma.order.findUnique({ where: { id } });
      if (!order) return;
      if (user.role === "CUSTOMER" && order.customerId !== user.sub) return;
      if (user.role === "RIDER" && order.riderId !== user.sub) return;
      if (!["ADMIN", "CUSTOMER", "RIDER"].includes(user.role) &&
          (!user.pharmacyId || user.pharmacyId !== order.pharmacyId)) return;
      void socket.join(id);
    } catch {}
  });

  socket.on("rider_location_update", async (payload: unknown) => {
    if (!payload || typeof payload !== "object") return;
    const { orderId, lat, lng } = payload as { orderId?: unknown; lat?: unknown; lng?: unknown };
    if (typeof orderId !== "string" || !orderId.trim()) return;
    if (typeof lat !== "number" || typeof lng !== "number" || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      return;
    }
    
    const user = socket.data.user;
    if (!user || user.role !== "RIDER") return;
    try {
      const order = await prisma.order.findUnique({ where: { id: orderId.trim() } });
      if (!order || order.riderId !== user.sub) return;
      socket.to(orderId.trim()).emit("location_update", { lat, lng });
    } catch {}
  });
});

// ─── Server Lifecycle ─────────────────────────────────────────────────────────

export function startServer() {
  httpServer.listen(PORT, () => {
    console.log(`\n🚀 PharmaDash API — http://localhost:${PORT}`);
    console.log(`   Socket.io:  same port (CORS: http://localhost:5173)`);
    console.log(`   Health:     GET  /health`);
    console.log(`   Auth:       POST /api/auth/register  |  POST /api/auth/login`);
    console.log(`   Medicines:  GET  /api/medicines`);
    console.log(`   Pharmacies: GET  /api/pharmacies`);
    console.log(`   Orders:     POST /api/orders  |  GET /api/orders`);
    console.log(`   Inventory:  GET  /api/inventory  (ADMIN)`);
    console.log(`   Users:      GET  /api/users/me\n`);
  });
}

if (require.main === module) startServer();

export { app, io, httpServer };

async function shutdown(signal: string) {
  console.log(`${signal} received, closing Socket.io, HTTP server, and Prisma…`);
  await new Promise<void>((resolve) => {
    io.close(() => resolve());
  });
  httpServer.close(() => void 0);
  await prisma.$disconnect();
  process.exit(0);
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
