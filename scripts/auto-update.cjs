#!/usr/bin/env node
// Runs automatically before `npm run dev` (via the root "predev" script).
// Checks origin/main, and if this laptop is cleanly behind, pulls +
// reinstalls whatever changed - so most laptops just get "npm run dev"
// and are current, no manual git steps. Never touches anything if the
// laptop has local uncommitted changes or has diverged from main; in
// either case it just warns and lets `npm run dev` continue as normal.

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const STATUS_FILE = path.join(ROOT, ".arc-update-status.json");

function run(cmd, cwd = ROOT) {
  return execSync(cmd, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function writeStatus(status) {
  try {
    fs.writeFileSync(
      STATUS_FILE,
      JSON.stringify({ ...status, checkedAt: new Date().toISOString() }, null, 2)
    );
  } catch {
    // best-effort only - a failed write here should never block `npm run dev`
  }
}

function changedFolders(fromRef, toRef) {
  const files = run(`git diff --name-only ${fromRef} ${toRef}`).split("\n").filter(Boolean);
  return {
    files,
    rootDeps: files.some((f) => f === "package.json" || f === "package-lock.json"),
    backendDeps: files.some((f) => f.startsWith("cors-proxy/package")),
    frontendDeps: files.some((f) => f.startsWith("cors-proxy-ui/package") && !f.startsWith("cors-proxy-ui/extension")),
    extensionChanged: files.some((f) => f.startsWith("cors-proxy-ui/extension/")),
  };
}

function main() {
  let localHead, remoteHead, dirty;
  try {
    localHead = run("git rev-parse HEAD");
    run("git fetch origin main --quiet");
    remoteHead = run("git rev-parse origin/main");
    dirty = run("git status --porcelain").length > 0;
  } catch (err) {
    console.warn("[auto-update] Skipped (not a git checkout, or git unavailable):", err.message.split("\n")[0]);
    writeStatus({ updated: false, skippedReason: "git-unavailable" });
    return;
  }

  if (localHead === remoteHead) {
    console.log("[auto-update] Already up to date with origin/main.");
    writeStatus({ updated: false, upToDate: true, commit: localHead, skippedReason: null });
    return;
  }

  if (dirty) {
    console.warn(
      "[auto-update] You're behind origin/main, but skipping auto-pull because you have " +
        "uncommitted local changes. Commit/stash them, then `git pull` manually."
    );
    writeStatus({ updated: false, commit: localHead, skippedReason: "local-changes" });
    return;
  }

  try {
    console.log(`[auto-update] Pulling latest changes (${localHead.slice(0, 7)} -> ${remoteHead.slice(0, 7)})...`);
    run("git pull --ff-only origin main");
  } catch (err) {
    console.warn(
      "[auto-update] Skipping auto-pull - history has diverged (would need a merge). " +
        "Resolve manually with `git pull`."
    );
    writeStatus({ updated: false, commit: localHead, skippedReason: "diverged" });
    return;
  }

  const changed = changedFolders(localHead, remoteHead);

  if (changed.rootDeps) {
    console.log("[auto-update] Root dependencies changed - running npm install...");
    execSync("npm install", { cwd: ROOT, stdio: "inherit" });
  }
  if (changed.backendDeps) {
    console.log("[auto-update] Backend dependencies changed - running npm install in cors-proxy...");
    execSync("npm install", { cwd: path.join(ROOT, "cors-proxy"), stdio: "inherit" });
  }
  if (changed.frontendDeps) {
    console.log("[auto-update] Frontend dependencies changed - running npm install in cors-proxy-ui...");
    execSync("npm install", { cwd: path.join(ROOT, "cors-proxy-ui"), stdio: "inherit" });
  }

  console.log(`[auto-update] Updated to ${remoteHead.slice(0, 7)}.`);
  if (changed.extensionChanged) {
    console.log(
      "[auto-update] The Chrome extension's source changed - reload it manually: " +
        "chrome://extensions -> ARC Token Sync -> Reload."
    );
  }

  writeStatus({
    updated: true,
    fromCommit: localHead,
    toCommit: remoteHead,
    extensionChanged: changed.extensionChanged,
    skippedReason: null,
  });
}

main();
