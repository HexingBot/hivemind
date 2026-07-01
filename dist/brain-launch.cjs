#!/usr/bin/env node
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// bin/brain-launch.js
var brain_launch_exports = {};
__export(brain_launch_exports, {
  buildLaunchPlan: () => buildLaunchPlan,
  childEnv: () => childEnv,
  resolveWisearcherPath: () => resolveWisearcherPath
});
module.exports = __toCommonJS(brain_launch_exports);
var import_node_fs = require("node:fs");
var import_node_path = require("node:path");
var import_node_url = require("node:url");
var import_node_child_process = require("node:child_process");
var import_meta = {};
function resolveWisearcherPath({ env = process.env, exists = import_node_fs.existsSync } = {}) {
  if (env.WISEARCHER_PATH) {
    const p = (0, import_node_path.resolve)(env.WISEARCHER_PATH);
    if (!exists((0, import_node_path.join)(p, "wisearcher", "mcp_server.py"))) {
      throw new Error(`WISEARCHER_PATH has no wisearcher/mcp_server.py: ${p}`);
    }
    return p;
  }
  const roots = [env.CLAUDE_PLUGIN_ROOT, env.CLAUDE_PROJECT_DIR, process.cwd()].filter(Boolean);
  for (const r of roots) {
    for (const cand of [(0, import_node_path.join)(r, "..", "wisearcher"), (0, import_node_path.join)(r, "..", "..", "wisearcher")]) {
      if (exists((0, import_node_path.join)(cand, "wisearcher", "mcp_server.py"))) return (0, import_node_path.resolve)(cand);
    }
  }
  throw new Error("could not resolve the wisearcher repo; set WISEARCHER_PATH");
}
function buildLaunchPlan({ wisearcherPath, exists = import_node_fs.existsSync } = {}) {
  const compose = (0, import_node_path.join)(wisearcherPath, "docker-compose.yml");
  const venvScript = [
    (0, import_node_path.join)(wisearcherPath, ".venv", "bin", "wisearcher-mcp"),
    (0, import_node_path.join)(wisearcherPath, ".venv", "Scripts", "wisearcher-mcp.exe")
  ].find(exists);
  const venvPython = [
    (0, import_node_path.join)(wisearcherPath, ".venv", "bin", "python"),
    (0, import_node_path.join)(wisearcherPath, ".venv", "Scripts", "python.exe")
  ].find(exists);
  const python = venvPython ?? "python3";
  let mcp;
  if (venvScript) mcp = { command: venvScript, args: [] };
  else if (venvPython) mcp = { command: venvPython, args: ["-m", "wisearcher.mcp_server"] };
  else mcp = { command: "wisearcher-mcp", args: [] };
  return {
    docker: exists(compose) ? { command: "docker", args: ["compose", "-f", compose, "up", "-d"] } : null,
    mcp: { ...mcp, cwd: wisearcherPath },
    python: { command: python, args: [], cwd: wisearcherPath }
  };
}
function childEnv(env = process.env) {
  const e = { ...env };
  delete e.ANTHROPIC_API_KEY;
  return e;
}
function bringUpDocker(plan) {
  if (!plan.docker) return;
  const r = (0, import_node_child_process.spawnSync)(plan.docker.command, plan.docker.args, {
    stdio: ["ignore", "ignore", "inherit"],
    env: childEnv()
  });
  if (r.status !== 0) {
    process.stderr.write("[brain-launch] docker compose up failed; continuing (kb_health will report)\n");
  }
}
function runHealth(plan) {
  bringUpDocker(plan);
  const code = "from wisearcher.mcp_server import kb_health, build_engine; import json; print(json.dumps(kb_health(build_engine())))";
  const r = (0, import_node_child_process.spawnSync)(plan.python.command, ["-c", code], {
    cwd: plan.python.cwd,
    env: childEnv(),
    stdio: ["ignore", "inherit", "inherit"]
  });
  process.exit(r.status ?? 1);
}
function execMcp(plan) {
  bringUpDocker(plan);
  const child = (0, import_node_child_process.spawn)(plan.mcp.command, plan.mcp.args, {
    cwd: plan.mcp.cwd,
    env: childEnv(),
    stdio: "inherit"
  });
  child.on("exit", (code) => process.exit(code ?? 0));
  child.on("error", (err) => {
    process.stderr.write(`[brain-launch] failed to exec the MCP server: ${err.message}
`);
    process.exit(127);
  });
}
function main(argv = process.argv.slice(2)) {
  let plan;
  try {
    plan = buildLaunchPlan({ wisearcherPath: resolveWisearcherPath() });
  } catch (err) {
    process.stderr.write(`[brain-launch] ${err.message}
`);
    process.exit(2);
  }
  if (argv.includes("--health")) runHealth(plan);
  else execMcp(plan);
}
if (import_meta.url === (0, import_node_url.pathToFileURL)(process.argv[1] || "").href) main();
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  buildLaunchPlan,
  childEnv,
  resolveWisearcherPath
});
