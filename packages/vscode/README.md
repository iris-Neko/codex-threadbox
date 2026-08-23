# Threadbox for Codex

Open **Threadbox: Open Manager** to manage Codex task metadata on the current VS Code host.

The extension runs in the workspace extension host, so Remote SSH, Dev Containers, and Codespaces manage the remote host's Codex tasks. It does not read full transcripts, repair desktop Recents, delete working directories, call a model, upload data, or collect telemetry.

Codex CLI 0.149.0 or newer is required. Configure `threadbox.codexBinary` or `threadbox.codexHome` when the remote CLI does not use the default environment.

This is an independent community project and is not affiliated with or endorsed by OpenAI.
