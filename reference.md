# Port Manager Reference

## Installation

Install the package globally before using the skill:

```bash
pnpm add -g @tansui/port-manager
```

The package exposes the `tansui-port` binary:

```bash
tansui-port assign --path /absolute/project/path
```

## Config Location

Default config path:

- macOS/Linux: `$HOME/.port-manager/.port-manager.config.json`
- Windows: `%USERPROFILE%\.port-manager\.port-manager.config.json`

Overrides:

- `PORT_MANAGER_HOME`: directory that contains `.port-manager.config.json`
- `PORT_MANAGER_CONFIG`: exact config file path

`PORT_MANAGER_CONFIG` takes precedence over `PORT_MANAGER_HOME`.

## Config Schema

The config file is a flat JSON object. Keys are native absolute paths, and values are port numbers.

```json
{
  "/absolute/path/to/project": 5173,
  "C:\\absolute\\path\\to\\project": 8788
}
```

For monorepos, each project or subproject that needs a port should have its own path key.

## Commands

```bash
tansui-port list
tansui-port get --path /absolute/project/path
tansui-port assign --path /absolute/project/path --start 3000 --end 9999
tansui-port set --path /absolute/project/path --port 5173
tansui-port release --path /absolute/project/path
tansui-port doctor
```

Command behavior:

- `list`: prints the full mapping as formatted JSON.
- `get`: prints the configured port for a path and exits nonzero if none exists.
- `assign`: if the path has a port, print it; otherwise assign the first unused available port in the range, save it, and print it.
- `set`: writes an explicit path-to-port mapping after validating duplicate mappings and current port availability.
- `release`: removes the mapping for a path and prints the removed port when one existed.
- `doctor`: validates config shape, duplicate ports, invalid ports, and currently occupied configured ports.

## Defaults

- `--path` defaults to the current working directory.
- `assign` defaults to `--start 3000 --end 9999`.
- Writes are atomic and guarded by `.port-manager.config.json.lock`.
- Paths are expanded and resolved before being used as config keys.

## Exit And Output Contract

- Successful `get`, `assign`, and `set` print only the port number.
- User-facing errors are printed to stderr and return exit code `1`.
- `doctor` prints status lines to stdout and returns exit code `1` when config validation fails.

## Package Build

The TypeScript source lives in `src`. The executable bundle lives in `dist`.

```bash
pnpm install
pnpm run build
```

After building and globally installing the package, use:

```bash
tansui-port help
```
