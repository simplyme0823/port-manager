import { cac } from "cac";
import detectPort from "detect-port";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const DEFAULT_START = 3000;
const DEFAULT_END = 9999;
const LOCK_TIMEOUT_MS = 10_000;

type Config = Record<string, number>;
type RawConfig = unknown;
type PortChecker = (port: number) => Promise<boolean>;
type PortCommandOptions = {
  path?: unknown;
  start?: unknown;
  end?: unknown;
  port?: unknown;
  help?: unknown;
  h?: unknown;
  "--"?: string[];
};

class PortManagerError extends Error {}
class ConfigError extends PortManagerError {}
class LockError extends PortManagerError {}

type Io = {
  stdout: (message: string) => void;
  stderr: (message: string) => void;
};

type Runtime = {
  cwd: string;
  env: NodeJS.ProcessEnv;
  isPortAvailable: PortChecker;
  io: Io;
};

function configPath(env: NodeJS.ProcessEnv): string {
  const configured = env.PORT_MANAGER_CONFIG;
  if (configured) {
    return resolvePath(configured);
  }
  return path.join(globalConfigDir(env), ".port-manager.config.json");
}

function globalConfigDir(env: NodeJS.ProcessEnv): string {
  const configured = env.PORT_MANAGER_HOME;
  if (configured) {
    return resolvePath(configured);
  }
  return path.join(os.homedir(), ".port-manager");
}

function resolvePath(rawPath: string): string {
  const expanded = rawPath === "~" || rawPath.startsWith("~/") || rawPath.startsWith("~\\")
    ? path.join(os.homedir(), rawPath.slice(2))
    : rawPath;
  return path.resolve(expanded);
}

function normalizeProjectPath(rawPath: string | undefined, cwd: string): string {
  const absolutePath = resolvePath(rawPath ?? cwd);
  return resolveWithRealAncestor(absolutePath);
}

function resolveWithRealAncestor(absolutePath: string): string {
  let current = absolutePath;
  const missingParts: string[] = [];

  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) {
      return absolutePath;
    }
    missingParts.unshift(path.basename(current));
    current = parent;
  }

  const realAncestor = fs.realpathSync.native(current);
  return path.join(realAncestor, ...missingParts);
}

function isValidPort(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 65_535;
}

function validatePort(value: number, label = "port"): void {
  if (!isValidPort(value)) {
    throw new ConfigError(`${label} must be an integer from 1 to 65535`);
  }
}

function validateRange(start: number, end: number): void {
  validatePort(start, "start");
  validatePort(end, "end");
  if (start > end) {
    throw new ConfigError("start must be less than or equal to end");
  }
}

function loadRawConfig(filePath: string): RawConfig {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new ConfigError(`invalid JSON in ${filePath}: ${error.message}`);
    }
    throw error;
  }
}

function validateConfigData(data: RawConfig): { config: Config; issues: string[] } {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    return { config: {}, issues: ["config root must be a JSON object"] };
  }

  const config: Config = {};
  const issues: string[] = [];
  const portToPaths = new Map<number, string[]>();

  for (const [rawKey, rawValue] of Object.entries(data as Record<string, unknown>)) {
    if (rawKey.length === 0) {
      issues.push("invalid project path key: empty string");
      continue;
    }
    if (typeof rawValue !== "number" || !Number.isInteger(rawValue)) {
      issues.push(`${rawKey}: port must be an integer`);
      continue;
    }
    if (!isValidPort(rawValue)) {
      issues.push(`${rawKey}: port ${rawValue} is outside 1-65535`);
      continue;
    }

    config[rawKey] = rawValue;
    const paths = portToPaths.get(rawValue) ?? [];
    paths.push(rawKey);
    portToPaths.set(rawValue, paths);
  }

  for (const [port, pathsForPort] of [...portToPaths.entries()].sort(([a], [b]) => a - b)) {
    if (pathsForPort.length > 1) {
      issues.push(`duplicate port ${port}: ${pathsForPort.sort().join(", ")}`);
    }
  }

  return { config, issues };
}

function loadConfig(filePath: string): Config {
  const { config, issues } = validateConfigData(loadRawConfig(filePath));
  if (issues.length > 0) {
    throw new ConfigError(issues.join("; "));
  }
  return config;
}

function sortedConfig(config: Config): Config {
  return Object.fromEntries(Object.entries(config).sort(([left], [right]) => left.localeCompare(right)));
}

function writeConfig(filePath: string, config: Config): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`,
  );

  try {
    fs.writeFileSync(tempPath, `${JSON.stringify(sortedConfig(config), null, 2)}\n`, "utf8");
    fs.renameSync(tempPath, filePath);
  } finally {
    if (fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }
  }
}

function lockPathFor(filePath: string): string {
  return path.join(path.dirname(filePath), `${path.basename(filePath)}.lock`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withFileLock<T>(lockPath: string, action: () => Promise<T>): Promise<T> {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  let descriptor: number | undefined;

  while (descriptor === undefined) {
    try {
      descriptor = fs.openSync(lockPath, "wx");
      fs.writeFileSync(descriptor, String(process.pid), "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "EEXIST" && Date.now() < deadline) {
        await sleep(50);
        continue;
      }
      if (isNodeError(error) && error.code === "EEXIST") {
        throw new LockError(`timed out waiting for lock ${lockPath}`);
      }
      throw error;
    }
  }

  try {
    return await action();
  } finally {
    fs.closeSync(descriptor);
    try {
      fs.unlinkSync(lockPath);
    } catch (error) {
      if (!isNodeError(error) || error.code !== "ENOENT") {
        throw error;
      }
    }
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

async function isPortAvailable(port: number): Promise<boolean> {
  try {
    const detectedPort = await detectPort(port);
    if (typeof detectedPort !== "number") {
      return true;
    }
    return detectedPort === port;
  } catch (error) {
    if (isNodeError(error) && error.code === "EPERM") {
      return true;
    }
    throw error;
  }
}

function parseNumber(value: unknown, label: string): number {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new ConfigError(`${label} must be an integer`);
  }
  return Number(value);
}

function optionString(options: PortCommandOptions, name: "path"): string | undefined {
  const value = options[name];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new ConfigError(`--${name} requires a value`);
  }
  return value;
}

function buildCli() {
  const cli = cac("tansui-port");

  cli
    .command("list", "Print all project-to-port mappings.")
    .option("-h, --help", "Show help");

  cli
    .command("get", "Print the configured port for a project path.")
    .option("-h, --help", "Show help")
    .option("--path <path>", "Project path. Defaults to the current working directory.");

  cli
    .command("assign", "Print the existing port for a path, or allocate and print one.")
    .option("-h, --help", "Show help")
    .option("--path <path>", "Project path. Defaults to the current working directory.")
    .option("--start <start>", `Allocation range start. Default: ${DEFAULT_START}.`)
    .option("--end <end>", `Allocation range end. Default: ${DEFAULT_END}.`);

  cli
    .command("set", "Explicitly assign a port to a project path.")
    .option("-h, --help", "Show help")
    .option("--path <path>", "Project path. Defaults to the current working directory.")
    .option("--port <port>", "Port to set explicitly.");

  cli
    .command("release", "Remove the mapping for a project path.")
    .option("-h, --help", "Show help")
    .option("--path <path>", "Project path. Defaults to the current working directory.");

  cli
    .command("doctor", "Validate config and report occupied configured ports.")
    .option("-h, --help", "Show help");

  return cli;
}

function usage(): string {
  return [
    "usage: tansui-port <command> [options]",
    "",
    "commands:",
    "  list",
    "  get [--path PATH]",
    "  assign [--path PATH] [--start 3000] [--end 9999]",
    "  set [--path PATH] --port PORT",
    "  release [--path PATH]",
    "  doctor",
  ].join("\n");
}

async function commandList(runtime: Runtime): Promise<number> {
  const config = loadConfig(configPath(runtime.env));
  runtime.io.stdout(JSON.stringify(sortedConfig(config), null, 2));
  return 0;
}

async function commandGet(runtime: Runtime, options: PortCommandOptions): Promise<number> {
  const projectPath = normalizeProjectPath(optionString(options, "path"), runtime.cwd);
  const config = loadConfig(configPath(runtime.env));
  const port = config[projectPath];
  if (port === undefined) {
    throw new PortManagerError(`no port configured for ${projectPath}`);
  }
  runtime.io.stdout(String(port));
  return 0;
}

async function commandAssign(runtime: Runtime, options: PortCommandOptions): Promise<number> {
  const start = parseNumber(options.start ?? DEFAULT_START, "start");
  const end = parseNumber(options.end ?? DEFAULT_END, "end");
  validateRange(start, end);

  const projectPath = normalizeProjectPath(optionString(options, "path"), runtime.cwd);
  const filePath = configPath(runtime.env);

  return withFileLock(lockPathFor(filePath), async () => {
    const config = loadConfig(filePath);
    const existing = config[projectPath];
    if (existing !== undefined) {
      runtime.io.stdout(String(existing));
      return 0;
    }

    const usedPorts = new Set(Object.values(config));
    for (let port = start; port <= end; port += 1) {
      if (usedPorts.has(port)) {
        continue;
      }
      if (!(await runtime.isPortAvailable(port))) {
        continue;
      }

      config[projectPath] = port;
      writeConfig(filePath, config);
      runtime.io.stdout(String(port));
      return 0;
    }

    throw new PortManagerError(`no available port in range ${start}-${end}`);
  });
}

async function commandSet(runtime: Runtime, options: PortCommandOptions): Promise<number> {
  const port = parseNumber(options.port, "port");
  validatePort(port);

  const projectPath = normalizeProjectPath(optionString(options, "path"), runtime.cwd);
  const filePath = configPath(runtime.env);

  return withFileLock(lockPathFor(filePath), async () => {
    const config = loadConfig(filePath);
    for (const [existingPath, existingPort] of Object.entries(config)) {
      if (existingPath !== projectPath && existingPort === port) {
        throw new PortManagerError(`port ${port} is already assigned to ${existingPath}`);
      }
    }

    if (!(await runtime.isPortAvailable(port))) {
      throw new PortManagerError(`port ${port} is already in use`);
    }

    config[projectPath] = port;
    writeConfig(filePath, config);
    runtime.io.stdout(String(port));
    return 0;
  });
}

async function commandRelease(runtime: Runtime, options: PortCommandOptions): Promise<number> {
  const projectPath = normalizeProjectPath(optionString(options, "path"), runtime.cwd);
  const filePath = configPath(runtime.env);

  return withFileLock(lockPathFor(filePath), async () => {
    const config = loadConfig(filePath);
    const removed = config[projectPath];
    if (removed !== undefined) {
      delete config[projectPath];
      writeConfig(filePath, config);
      runtime.io.stdout(String(removed));
    }
    return 0;
  });
}

async function commandDoctor(runtime: Runtime): Promise<number> {
  const filePath = configPath(runtime.env);
  const data = loadRawConfig(filePath);
  const { config, issues } = validateConfigData(data);

  runtime.io.stdout(`config: ${filePath}`);
  if (!fs.existsSync(filePath)) {
    runtime.io.stdout("OK config file does not exist yet; it will be created on first write");
  }

  for (const issue of issues) {
    runtime.io.stdout(`ERROR ${issue}`);
  }

  if (issues.length > 0) {
    return 1;
  }

  let occupiedCount = 0;
  for (const [projectPath, port] of Object.entries(sortedConfig(config))) {
    if (!(await runtime.isPortAvailable(port))) {
      occupiedCount += 1;
      runtime.io.stdout(`WARN occupied port ${port}: ${projectPath}`);
    }
  }

  if (occupiedCount === 0) {
    runtime.io.stdout("OK no configured ports are currently occupied");
  }
  return 0;
}

export async function run(
  argv: string[],
  overrides: Partial<Runtime> = {},
): Promise<number> {
  const runtime: Runtime = {
    cwd: overrides.cwd ?? process.cwd(),
    env: overrides.env ?? process.env,
    isPortAvailable: overrides.isPortAvailable ?? isPortAvailable,
    io: overrides.io ?? {
      stdout: (message: string) => console.log(message),
      stderr: (message: string) => console.error(message),
    },
  };

  try {
    if (argv[0] === "help") {
      runtime.io.stdout(usage());
      return 0;
    }

    const cli = buildCli();
    const parsed = cli.parse(["node", "tansui-port", ...argv], { run: false });

    const command = cli.matchedCommandName;
    const options = parsed.options as PortCommandOptions;
    if (command === "help" || options.help || options.h) {
      runtime.io.stdout(usage());
      return 0;
    }
    if (typeof command !== "string") {
      const rawCommand = parsed.args[0];
      if (rawCommand === "port") {
        throw new PortManagerError(`expected command form: tansui-port <command>\n${usage()}`);
      }
      throw new PortManagerError(`missing or unknown command\n${usage()}`);
    }

    cli.matchedCommand?.checkUnknownOptions();
    cli.matchedCommand?.checkOptionValue();
    cli.matchedCommand?.checkUnusedArgs();

    switch (command) {
      case "list":
        return await commandList(runtime);
      case "get":
        return await commandGet(runtime, options);
      case "assign":
        return await commandAssign(runtime, options);
      case "set":
        return await commandSet(runtime, options);
      case "release":
        return await commandRelease(runtime, options);
      case "doctor":
        return await commandDoctor(runtime);
      default:
        throw new PortManagerError(`unknown command: ${command}\n${usage()}`);
    }
  } catch (error) {
    if (error instanceof PortManagerError || error instanceof Error && error.constructor.name === "CACError") {
      runtime.io.stderr(`error: ${error.message}`);
      return 1;
    }
    throw error;
  }
}
