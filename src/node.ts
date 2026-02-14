// ---------------------------------------------------------------------------
// Node.js HTTP server entrypoint (for deployment).
// ---------------------------------------------------------------------------

import { serve } from "@hono/node-server";
import { buildApp } from "./app.js";

const port = Number(process.env["PORT"] ?? 3000);
const app = await buildApp();

serve({
  fetch: app.fetch,
  port,
});

