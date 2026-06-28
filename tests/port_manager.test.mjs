import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { run } from "../src/port_manager.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

function createHarness(options = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "port-manager-test-"));
  const configPath = path.join(tempDir, ".port-manager.config.json");
  const stdout = [];
  const stderr = [];
  const env = {
    ...process.env,
    PORT_MANAGER_CONFIG: configPath,
  };

  return {
    tempDir,
    configPath,
    stdout,
    stderr,
    async runCli(args, runOptions = {}) {
      return run(args, {
        cwd: runOptions.cwd ?? tempDir,
        env,
        isPortAvailable: runOptions.isPortAvailable ?? options.isPortAvailable ?? (async () => true),
        io: {
          stdout: (message) => stdout.push(message),
          stderr: (message) => stderr.push(message),
        },
      });
    },
    cleanup() {
      fs.rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

test("PORT_MANAGER_HOME stores config in global config directory", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "port-manager-home-"));
  const stdout = [];
  const stderr = [];
  try {
    const code = await run(["set", "--path", "/tmp/global-home-project", "--port", "31030"], {
      cwd: tempDir,
      env: {
        ...process.env,
        PORT_MANAGER_HOME: tempDir,
        PORT_MANAGER_CONFIG: undefined,
      },
      isPortAvailable: async () => true,
      io: {
        stdout: (message) => stdout.push(message),
        stderr: (message) => stderr.push(message),
      },
    });

    assert.equal(code, 0);
    assert.deepEqual(stderr, []);
    assert.equal(stdout.at(-1), "31030");
    assert.equal(fs.existsSync(path.join(tempDir, ".port-manager.config.json")), true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("assign creates config and is idempotent", async () => {
  const harness = createHarness();
  try {
    assert.equal(await harness.runCli(["assign", "--path", "/tmp/example", "--start", "31000", "--end", "31010"]), 0);
    assert.equal(await harness.runCli(["assign", "--path", "/tmp/example", "--start", "31000", "--end", "31010"]), 0);

    assert.equal(harness.stdout[0], harness.stdout[1]);
    assert.deepEqual(
      JSON.parse(fs.readFileSync(harness.configPath, "utf8")),
      { [fs.realpathSync.native("/tmp") + "/example"]: Number(harness.stdout[0]) },
    );
  } finally {
    harness.cleanup();
  }
});

test("assign supports tansui-port command form", async () => {
  const harness = createHarness();
  try {
    assert.equal(await harness.runCli(["assign", "--path", "/tmp/tansui-project", "--start", "31012", "--end", "31012"]), 0);
    assert.equal(harness.stdout.at(-1), "31012");
  } finally {
    harness.cleanup();
  }
});

test("old spaced command form is rejected", async () => {
  const harness = createHarness();
  try {
    assert.equal(await harness.runCli(["port", "assign", "--path", "/tmp/direct-project"]), 1);
    assert.match(harness.stderr.at(-1), /expected command form: tansui-port <command>/);
  } finally {
    harness.cleanup();
  }
});

test("path normalization resolves relative segments and real ancestors", async () => {
  const harness = createHarness();
  try {
    const projectDir = path.join(harness.tempDir, "project");
    const nestedPath = path.join(projectDir, "..", "project");

    assert.equal(await harness.runCli(["assign", "--path", nestedPath, "--start", "31020", "--end", "31030"]), 0);

    assert.deepEqual(
      JSON.parse(fs.readFileSync(harness.configPath, "utf8")),
      { [path.join(fs.realpathSync.native(harness.tempDir), "project")]: Number(harness.stdout[0]) },
    );
  } finally {
    harness.cleanup();
  }
});

test("set get and release", async () => {
  const harness = createHarness();
  try {
    assert.equal(await harness.runCli(["set", "--path", "/tmp/manual-project", "--port", "31040"]), 0);
    assert.equal(await harness.runCli(["get", "--path", "/tmp/manual-project"]), 0);
    assert.equal(await harness.runCli(["release", "--path", "/tmp/manual-project"]), 0);

    assert.deepEqual(harness.stdout, ["31040", "31040", "31040"]);
    assert.equal(await harness.runCli(["get", "--path", "/tmp/manual-project"]), 1);
    assert.match(harness.stderr.at(-1), /no port configured/);
  } finally {
    harness.cleanup();
  }
});

test("invalid JSON fails", async () => {
  const harness = createHarness();
  try {
    fs.writeFileSync(harness.configPath, "{", "utf8");
    assert.equal(await harness.runCli(["list"]), 1);
    assert.match(harness.stderr.at(-1), /invalid JSON/);
  } finally {
    harness.cleanup();
  }
});

test("doctor reports invalid ports", async () => {
  const harness = createHarness();
  try {
    fs.writeFileSync(harness.configPath, JSON.stringify({ "/tmp/example": 70000 }), "utf8");
    assert.equal(await harness.runCli(["doctor"]), 1);
    assert.match(harness.stdout.join("\n"), /ERROR \/tmp\/example: port 70000 is outside 1-65535/);
  } finally {
    harness.cleanup();
  }
});

test("set prevents duplicate ports", async () => {
  const harness = createHarness();
  try {
    assert.equal(await harness.runCli(["set", "--path", "/tmp/project-a", "--port", "31050"]), 0);
    assert.equal(await harness.runCli(["set", "--path", "/tmp/project-b", "--port", "31050"]), 1);
    assert.match(harness.stderr.at(-1), /already assigned/);
  } finally {
    harness.cleanup();
  }
});

test("set reports occupied ports", async () => {
  const harness = createHarness({
    isPortAvailable: async (port) => port !== 31055,
  });
  try {
    assert.equal(await harness.runCli(["set", "--path", "/tmp/project-a", "--port", "31055"]), 1);
    assert.match(harness.stderr.at(-1), /port 31055 is already in use/);
    assert.equal(fs.existsSync(harness.configPath), false);
  } finally {
    harness.cleanup();
  }
});

test("assign skips occupied ports", async () => {
  const harness = createHarness({
    isPortAvailable: async (port) => port !== 31060,
  });
  try {
    assert.equal(await harness.runCli(["assign", "--path", "/tmp/skip-occupied", "--start", "31060", "--end", "31061"]), 0);
    assert.equal(harness.stdout.at(-1), "31061");
  } finally {
    harness.cleanup();
  }
});

test("package test runs from repo root", () => {
  assert.equal(fs.existsSync(path.join(repoRoot, "package.json")), true);
});
