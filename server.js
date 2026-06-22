// Custom server entry for Phusion Passenger (Plesk / Hetzner managed Node).
//
// Passenger runs THIS file (set it as the panel's "Script path") and provides
// the address to listen on via process.env.PORT — which may be a TCP port or a
// Unix socket path, so we handle both. The app must already be built
// (`npm run build`) since this serves the production output in `.next/`.
require("dotenv").config(); // load .env from the working directory, if present

const { createServer } = require("http");
const next = require("next");

const portEnv = process.env.PORT;
// Passenger usually passes a numeric port, but can pass a socket path.
const listenTarget = portEnv && /^\d+$/.test(portEnv) ? parseInt(portEnv, 10) : portEnv || 3000;

const app = next({ dev: false });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  createServer((req, res) => handle(req, res)).listen(listenTarget, () => {
    console.log(`> TriTrainer ready (listening on ${listenTarget})`);
  });
});
