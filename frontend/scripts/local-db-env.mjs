// GABAY: Ginagamit ng `npm run dev:local`. Binabasa nito ang URL at public (anon) key ng local Supabase na tumatakbo
// sa Docker (`supabase start`) at isinusulat sa frontend/.env.localdb, para ang website sa localhost ay kumonekta
// sa local database at hindi sa production. Walang production key na ginagalaw dito.
/* global console, process */
import { execSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const frontend = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let output;
try {
  output = execSync("supabase status -o env", { cwd: path.join(frontend, ".."), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
} catch {
  console.error("Hindi tumatakbo ang local Supabase. Buksan ang Docker Desktop, tapos patakbuhin sa website_repo: supabase start");
  process.exit(1);
}
const values = Object.fromEntries(
  output.split(/\r?\n/).map((line) => line.match(/^([A-Z_]+)="?(.*?)"?$/)).filter(Boolean).map((m) => [m[1], m[2]]),
);
const url = values.API_URL;
const key = values.ANON_KEY || values.PUBLISHABLE_KEY;
if (!url || !key) {
  console.error("Walang API_URL o ANON_KEY sa `supabase status`. Subukang i-restart: supabase stop && supabase start");
  process.exit(1);
}
// VITE_LOCAL_SKIP_MFA: walang authenticator app ang admin login sa local (tingnan ang src/lib/supabase.ts).
writeFileSync(
  path.join(frontend, ".env.localdb"),
  `# Ginawa ng scripts/local-db-env.mjs. Local Docker database lang ito.\nVITE_SUPABASE_URL=${url}\nVITE_SUPABASE_ANON_KEY=${key}\nVITE_LOCAL_SKIP_MFA=true\n`,
);
// Ganoon din sa server: binabasa ng local edge functions ang supabase/functions/.env (hindi kasama sa git).
const functionsEnv = path.join(frontend, "..", "supabase", "functions", ".env");
const existing = existsSync(functionsEnv) ? readFileSync(functionsEnv, "utf8") : "";
if (!/^LOCAL_SKIP_MFA=/m.test(existing)) {
  appendFileSync(functionsEnv, `${existing && !existing.endsWith("\n") ? "\n" : ""}LOCAL_SKIP_MFA=true\n`);
  console.log("Naidagdag ang LOCAL_SKIP_MFA=true sa supabase/functions/.env. I-restart ang Supabase: supabase stop && supabase start");
}
console.log(`Local database: ${url} (Studio: ${values.STUDIO_URL ?? "http://127.0.0.1:54323"})`);
