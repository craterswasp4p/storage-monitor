import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

export const files = ["bootstrap.mjs", "platform.mjs", "lifecycle.mjs"];

/**
 * Committed loader: fetch the runner files from the exact workflow revision into a
 * private directory, then start them without the download token. Prints one neutral
 * line on failure and nothing else.
 */
export async function start({
  env = process.env,
  request = fetch,
  run = spawn,
  signals = process,
  log = console.error,
} = {}) {
  const root = mkdtempSync(join(tmpdir(), "job-"));
  try {
    for (const file of files) {
      const url = `${env.GITHUB_API_URL || "https://api.github.com"}/repos/${env.GITHUB_REPOSITORY}/contents/${env.WORKER_FILES}/${file}?ref=${env.GITHUB_SHA}`;
      const response = await request(url, {
        headers: {
          Authorization: `Bearer ${env.WORKER_DOWNLOAD_TOKEN}`,
          Accept: "application/vnd.github.raw+json",
        },
        redirect: "error",
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) throw Error("download");
      writeFileSync(join(root, file), await response.text(), { mode: 0o600 });
    }
    const childEnv = { ...env };
    delete childEnv.WORKER_DOWNLOAD_TOKEN;
    const child = run(process.execPath, [join(root, "bootstrap.mjs")], {
      env: childEnv,
      stdio: "inherit",
    });
    const forward = () => child.kill("SIGTERM");
    signals.on("SIGTERM", forward);
    signals.on("SIGINT", forward);
    try {
      return await new Promise((resolve) => {
        child.on("error", () => resolve(1));
        child.on("exit", (code) => resolve(code ?? 1));
      });
    } finally {
      signals.removeListener("SIGTERM", forward);
      signals.removeListener("SIGINT", forward);
    }
  } catch {
    log("Startup failed.");
    return 1;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  process.exitCode = await start();
