# Threadbox for Codex

Open the official Codex sidebar and expand **Threadbox** to organize tasks into host-local projects. The view supports live metadata search, project creation, creating blank tasks directly inside Threadbox or official Codex projects, drag-and-drop assignment, multi-select archive/pin/Trash actions, working-directory access, and collapsible spawned tasks. Set `threadbox.sidebarLocation` to `standalone` to restore a separate Activity Bar container; Threadbox also falls back there when a compatible Codex sidebar is unavailable. Select **Open Threadbox Manager**, or run **Threadbox: Open Manager**, for the full table and advanced filters.

The extension runs in the workspace extension host, so Remote SSH, Dev Containers, and Codespaces manage the remote host's Codex tasks. It does not read full transcripts, repair desktop Recents, delete working directories, call a model, upload data, or collect telemetry.

Threadbox projects are stored in the extension host's VS Code global storage and do not automatically sync between servers. Their assignments are local overlays: moving an existing task into a Threadbox project does not change its official Codex project assignment, and removing the overlay restores the official grouping. When the experimental Codex project API is available, official projects can be created, renamed, and deleted through App Server; deleting one preserves its tasks and working directories and makes those tasks unassigned. If that API is unavailable, existing official tasks can still be opened and continued while official project management is disabled.

The built-in **Trash** project works for tasks from both Threadbox and official Codex projects. Moving a task to Trash archives it and remembers its previous Threadbox project; restoring it returns there when that project still exists, or leaves it without a Threadbox assignment otherwise. **Empty Trash** permanently deletes eligible task records through App Server. Running and pinned tasks remain protected, and working directories are always preserved. An existing host-local project named `trash` is upgraded in place so its assignments are not lost.

Codex CLI 0.149.0 or newer is required. Configure `threadbox.codexBinary` or `threadbox.codexHome` when the remote CLI does not use the default environment.

This is an independent community project and is not affiliated with or endorsed by OpenAI.
