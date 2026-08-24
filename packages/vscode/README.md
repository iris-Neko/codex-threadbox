# Threadbox for Codex

Open the Threadbox icon in the Activity Bar to organize tasks into host-local projects. The sidebar supports project creation, drag-and-drop assignment, multi-select archive/pin/delete actions, working-directory access, and collapsible spawned tasks. Select **Open Threadbox Manager**, or run **Threadbox: Open Manager**, for search, filters, and batch operations.

The extension runs in the workspace extension host, so Remote SSH, Dev Containers, and Codespaces manage the remote host's Codex tasks. It does not read full transcripts, repair desktop Recents, delete working directories, call a model, upload data, or collect telemetry.

Threadbox projects are stored in the extension host's VS Code global storage. They do not change official Codex project assignments and do not automatically sync between servers. A local Threadbox assignment can temporarily override an official project in the Threadbox UI; removing it restores the official grouping.

Codex CLI 0.149.0 or newer is required. Configure `threadbox.codexBinary` or `threadbox.codexHome` when the remote CLI does not use the default environment.

This is an independent community project and is not affiliated with or endorsed by OpenAI.
