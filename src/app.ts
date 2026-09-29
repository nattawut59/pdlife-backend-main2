import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { env } from "./config/env";
import apiRoutes from "./routes";
import { errorHandler, notFoundHandler } from "./middlewares/errorHandler";

export function createApp() {
  const app = express();

  // Must be set before the rate limiters run: they meter on req.ip, which is only the real
  // client address once Express knows how many proxies to unwind from X-Forwarded-For.
  app.set("trust proxy", env.trustProxy);

  app.use(helmet());
  app.use(cors({ origin: env.corsOrigin }));
  app.use(express.json());
  // ปิด log ตอนรันเทสต์ ไม่งั้นผลเทสต์จะจมอยู่ในบรรทัด request หลายร้อยบรรทัด
  if (env.nodeEnv !== "test" && process.env.PERFORMANCE_AUDIT !== "1") {
    app.use(morgan(env.nodeEnv === "development" ? "dev" : "combined"));
  }

  app.get("/health", (_req, res) => res.json({ status: "ok" }));

  app.use("/api", apiRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
