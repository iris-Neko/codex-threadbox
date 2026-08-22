# Security Policy

## Supported versions

Security fixes are provided for the latest released version.

## Reporting a vulnerability

Please use GitHub's **Report a vulnerability** private security advisory flow for `iris-Neko/codex-threadbox`. Do not open a public issue for vulnerabilities involving command execution, IPC boundary bypasses, unsafe path handling, or unintended task deletion.

Include the affected version, operating system, reproduction steps, and impact. Do not include real conversation content or authentication material.

## Security design

- The renderer runs with context isolation, Node integration disabled, and Chromium sandboxing enabled.
- IPC inputs are validated and constrained to known task IDs and working directories.
- Codex commands are spawned with argument arrays rather than user-built shell strings.
- Task mutations use official App Server methods.
- Threadbox has no telemetry and does not store conversation content.
