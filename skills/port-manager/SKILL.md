---
name: port-manager
description: Assign or reuse a stable local port for any project path. Use when an agent needs to know which port a project can use, including monorepo subprojects; the main command prints an existing port or allocates one.
---

# Port Manager

Use this skill when an agent needs to output the port a project path can use.

## Install First

Before using the skill, make sure the package is installed globally:

```bash
pnpm add -g @tansui/port-manager
```

If `pnpm` global installs are not available in the environment, use an equivalent global package install method for `@tansui/port-manager`.

## What It Does

- `tansui-port assign` is the main command.
- If the project path already has a port, `assign` prints that port.
- If the project path has no port, `assign` allocates one, saves it, and prints it.
- Config keys are native absolute project paths, including monorepo subproject paths.

## Quick Start

```bash
tansui-port assign --path "$PWD"
```

Use the returned value as the port that the project path can use. This skill does not decide how the project consumes that port.

## Navigation

- Load `examples.md` when you need concrete command examples.
- Load `reference.md` when you need the full command reference, config path rules, JSON schema, environment overrides, or package/build details.
- Execute `tansui-port ...` for actual port-management operations. Do not load the bundled package code as context unless debugging the tool itself.

## Guardrails

- Do not hand-edit the config unless the CLI is unavailable.
- Do not kill a process automatically just because a port is occupied.
- For monorepos, pass the actual project or subproject directory as `--path`.
- Prefer `tansui-port assign` unless the caller explicitly needs to inspect, set, or release mappings.
