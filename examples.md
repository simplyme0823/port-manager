# Port Manager Examples

## Install The CLI

Install the package globally before using the skill:

```bash
pnpm add -g @tansui/port-manager
```

Confirm the command is available:

```bash
tansui-port help
```

## Get A Port For The Current Project

Use `assign` when an agent needs the port for a project path. If the path already has a port, it prints it. If not, it assigns one and prints it.

```bash
PORT="$(tansui-port assign --path "$PWD")"
printf '%s\n' "$PORT"
```

Expected agent behavior:

- Treat stdout as the port for that project path.
- Return or pass that port to the caller.
- Do not infer any startup or runtime behavior from this skill.

## Get A Port For A Specific Project Path

Pass the project path explicitly when the agent is working outside the target directory.

```bash
tansui-port assign --path /absolute/path/to/project
```

The command prints only the port number on success. Repeating it for the same path prints the same port.

## Assign Separate Ports In A Monorepo

Use each subproject path as its own key. Do not use nested JSON.

```bash
ROOT="/absolute/path/to/monorepo"
APP_A_PORT="$(tansui-port assign --path "$ROOT/apps/app-a")"
APP_B_PORT="$(tansui-port assign --path "$ROOT/apps/app-b")"

printf 'app-a=%s\napp-b=%s\n' "$APP_A_PORT" "$APP_B_PORT"
```

The two paths are independent mappings, even though they share the same monorepo root.

## Repeated Calls

Agents do not need to check first. Call `assign`; it handles both cases.

```bash
tansui-port assign --path /absolute/path/to/project
tansui-port assign --path /absolute/path/to/project
```

Both commands print the same port unless the mapping was released or changed.

## Explicitly Pin A Known Port

Use `set` when a project path must map to a specific port.

```bash
tansui-port set --path /absolute/path/to/project --port 5173
```

If another project path already owns the port, or the port is currently unavailable, the command exits nonzero and reports the conflict.

## Inspect Or Repair Conflicts

Run `doctor` when a selected port appears to be unavailable or the mapping may be stale.

```bash
tansui-port doctor
```

Agent response pattern:

- If `doctor` reports an occupied configured port, report the path and port.
- Do not stop any process automatically.
- If the caller wants a fresh assignment, release the mapping and assign again.

```bash
tansui-port release --path /absolute/path/to/project
tansui-port assign --path /absolute/path/to/project
```

## Use A Temporary Config For Tests

Set `PORT_MANAGER_HOME` to isolate test runs from the real global config.

```bash
PORT_MANAGER_HOME="$(mktemp -d)" tansui-port assign --path /tmp/example
```

Use `PORT_MANAGER_CONFIG` when a test needs to point at an exact config file.

```bash
PORT_MANAGER_CONFIG="/tmp/port-manager-test.json" tansui-port list
```

## Windows Path Example

Pass the native Windows path to `--path`; the CLI writes the normalized absolute key.

```powershell
$port = tansui-port assign --path C:\work\monorepo\apps\web
$port
```

The config key will use the platform's native path format.
