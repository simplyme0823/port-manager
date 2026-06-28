# port-manager

A repository-local agent skill for outputting the port a project path can use.

The config file lives in the user-level global config directory:

- macOS/Linux: `$HOME/.port-manager/.port-manager.config.json`
- Windows: `%USERPROFILE%\.port-manager\.port-manager.config.json`

It is a flat JSON object:

```json
{
  "/absolute/path/to/project": 5173,
  "C:\\absolute\\path\\to\\monorepo\\apps\\api": 8788
}
```

For monorepos, record each project or subproject path separately. Let the CLI write path keys so they use the current operating system's native absolute path format.

## Usage

```bash
tansui-port assign --path /absolute/project/path
tansui-port get --path /absolute/project/path
tansui-port set --path /absolute/project/path --port 5173
tansui-port release --path /absolute/project/path
tansui-port list
tansui-port doctor
```

Defaults:

- `--path` defaults to the current working directory.
- Paths are expanded and resolved before being used as keys.
- `assign` prints the existing port for a path, or allocates and prints a new one.
- New assignments use the first free unused port in `3000-9999` unless `--start` and `--end` are provided.
- `set --port` lets the caller explicitly assign a port and reports a conflict if that port is already mapped or unavailable.
- Writes are atomic and guarded by `.port-manager.config.json.lock` in the same global config directory.
- No command kills existing processes.
- `PORT_MANAGER_HOME` can point at a different config directory.
- `PORT_MANAGER_CONFIG` can point at a specific config file.

## Install As A Skill

Install the package globally before using the skill:

```bash
pnpm add -g @tansui/port-manager
```

After installation, an agent can run `tansui-port assign --path ...` whenever it needs to know which port a project path can use.

## Development

Source lives in `src`. The bundled CLI output lives in `dist`.

Build:

```bash
pnpm run build
```

Manual publish:

```bash
pnpm publish --access public
```

Run tests:

```bash
pnpm test
```

In non-interactive environments, use:

```bash
CI=true pnpm test
```
