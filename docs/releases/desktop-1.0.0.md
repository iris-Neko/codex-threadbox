# Threadbox Desktop 1.0.0

The first stable desktop release, with a task-first interface and separate project and directory navigation.

## Highlights

- Read real Codex project names and explicit membership, including older desktop assignments that have not finished migrating.
- Expand projects to main-task shortcuts. Keep working directories and independent tasks separate.
- Hide spawned agents from the main list. Parent deletion includes descendants, with running and pinned task protection.
- Keep project files by default; optional directory Trash requires a separate acknowledgement.
- Search, archive, restore, pin and batch-manage tasks in English or Simplified Chinese, with light and dark themes.

## Downloads

- **Windows x64:** installer `.exe` or portable `.zip`.
- **macOS:** `.dmg` or `.zip` for Apple Silicon (`arm64`) and Intel (`x64`).
- **Linux x64:** `.flatpak`, `.AppImage`, `.deb`, or `.rpm`.

Codex CLI 0.149.0 or newer must be installed on the host. Flatpak calls the host CLI through `flatpak-spawn`; configure its absolute path in Settings if your login shell cannot locate it.

### Flatpak installation

```sh
flatpak remote-add --user --if-not-exists flathub https://flathub.org/repo/flathub.flatpakrepo
flatpak install --user flathub org.freedesktop.Platform//25.08
flatpak install --user ./Threadbox-for-Codex-1.0.0-linux-x64.flatpak
flatpak run io.github.iris_neko.codex_threadbox
```

This is a downloadable Flatpak bundle, not a Flathub store listing. It requests host filesystem access for local task metadata and optional directory Trash, and host-command access to run the installed Codex CLI. No Codex executable is bundled.

Windows and macOS builds are unsigned; operating-system security prompts may appear. Verify downloads against `SHA256SUMS.txt`. macOS and Linux physical-device validation remains more limited than Windows.

This release changes only the desktop product. CLI and VS Code releases remain independently versioned. No telemetry, model calls, or conversation uploads are added.

## 中文

桌面端首个正式版本：主任务列表、真实项目名称与归属、项目/目录分区、主任务级联删除保护。子智能体不再单独展示，工作目录默认保留。

提供 Windows x64、macOS Intel/Apple Silicon，以及 Linux x64 Flatpak、AppImage、DEB。需要宿主机安装 Codex CLI 0.149.0 或更新版本。Flatpak 使用上方命令安装，尚未上架 Flathub。Windows/macOS 安装包未签名，请核对校验和。CLI 和 VS Code 版本独立，不随本次桌面发布升级。
