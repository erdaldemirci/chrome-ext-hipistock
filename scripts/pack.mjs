import { mkdir, readFile, rm, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const dist = resolve(root, "dist");
const releaseDir = resolve(root, "release");

async function main() {
  const manifest = JSON.parse(
    await readFile(resolve(dist, "manifest.json"), "utf8"),
  );
  const version = String(manifest.version || "0.0.0");
  const name = String(manifest.name || "hipistock")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  await mkdir(releaseDir, { recursive: true });
  const zipPath = resolve(releaseDir, `${name}-${version}.zip`);
  await rm(zipPath, { force: true });

  await new Promise((resolvePromise, reject) => {
    const child = spawn("zip", ["-r", "-q", zipPath, "."], {
      cwd: dist,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolvePromise(undefined);
      else reject(new Error(`zip exit ${code}`));
    });
  });

  const size = (await stat(zipPath)).size;
  console.log(`Packed ${zipPath} (${(size / 1024).toFixed(1)} KB)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
