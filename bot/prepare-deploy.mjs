// Deploy preflight: fetch LIVE Worker bindings so the original D1 is preserved.
// This script must never print environment-variable values or secrets.
import fs from "node:fs/promises";

const account = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
const token = process.env.CLOUDFLARE_API_TOKEN?.trim();
const workerName = "five-oceans-merch-bot";
const api = "https://api.cloudflare.com/client/v4";

function stop(message) {
  throw new Error("Deploy stopped safely: " + message);
}

if (!/^[0-9a-f]{32}$/i.test(account || "")) {
  stop("Set GitHub Actions secret CLOUDFLARE_ACCOUNT_ID (32-character Cloudflare account ID).");
}
if (!token) {
  stop("Set GitHub Actions secret CLOUDFLARE_API_TOKEN with Workers Scripts read/write permissions.");
}

async function cfGet(path) {
  const response = await fetch(api + path, {
    headers: { Authorization: "Bearer " + token, Accept: "application/json" }
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.success || !body.result) {
    stop("Cloudflare API settings are unavailable (HTTP " + response.status +
      "). Check token permissions and account ID.");
  }
  return body.result;
}

const settings = await cfGet(
  "/accounts/" + account + "/workers/scripts/" + workerName + "/settings"
);
const bindings = Array.isArray(settings.bindings) ? settings.bindings : null;
if (!bindings) stop("Existing Worker bindings could not be read. No deployment performed.");

// Unrecognized binding types may disappear when Wrangler deploys. Fail closed.
const safeTypes = new Set(["d1", "plain_text", "secret_text"]);
const unknown = bindings.filter(b => !safeTypes.has(b.type));
if (unknown.length) {
  stop("Worker has additional unsupported binding types. Review before deploying.");
}

const database = bindings.find(b => b.name === "DB" && b.type === "d1");
const databaseId = database?.database_id || database?.id;
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(databaseId || "")) {
  // UUID-style D1 IDs are required. Do not create or select another database.
  stop("Original D1 binding DB / database_id not found. Existing CRM must remain unchanged.");
}

const required = [
  "TELEGRAM_BOT_TOKEN", "TELEGRAM_WEBHOOK_SECRET", "ADMIN_CHAT_ID",
  "BOT_ADMIN_ID", "BOT_ADMIN_PASSWORD"
];
for (const name of required) {
  if (!bindings.some(b => b.name === name &&
      (b.type === "plain_text" || b.type === "secret_text"))) {
    stop("Missing Worker variable/secret " + name + ". Add it in Cloudflare Worker Settings first.");
  }
}
const adminBinding = bindings.find(b => b.name === "BOT_ADMIN_ID");
if (adminBinding.type === "plain_text" && !/^[0-9]{5,20}$/.test(String(adminBinding.text || ""))) {
  stop("BOT_ADMIN_ID must be the numeric personal Telegram ID, not @username.");
}

let databaseName = "five-oceans-merch-existing-d1";
try {
  const record = await cfGet("/accounts/" + account + "/d1/database/" + databaseId);
  if (typeof record.name === "string" && record.name) databaseName = record.name;
} catch {
  // A Workers-only token need not have D1 read permissions.
}

const config = {
  "$schema": "node_modules/wrangler/config-schema.json",
  name: workerName,
  main: "./worker.js",
  compatibility_date: "2026-10-20",
  workers_dev: true,
  keep_vars: true,
  d1_databases: [{
    binding: "DB",
    database_name: databaseName,
    database_id: databaseId
  }]
};
await fs.writeFile("bot/wrangler.generated.jsonc", JSON.stringify(config, null, 2) + "\n", {
  mode: 0o600
});
console.log("Preflight OK: existing Worker, original D1 and required settings detected.");
console.log("Ready for deployment. Secrets have not been copied into GitHub.");
