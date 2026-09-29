import { createApp } from "./app";
import { env } from "./config/env";
import { startSchedulerJob } from "./jobs/scheduler";

const app = createApp();

app.listen(env.port, () => {
  console.log(`pdlife-backend listening on port ${env.port} (${env.nodeEnv})`);
});

startSchedulerJob();
