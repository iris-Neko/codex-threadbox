# Threadbox for Codex

**本地运行、覆盖桌面、终端和远程服务器的跨平台 Codex 任务记录管理器。**

[English](README.md)

![Threadbox 任务列表](docs/images/threadbox-main.png)

Threadbox 将所有工作目录中的 Codex 任务记录汇总到一个可搜索列表。Electron 桌面版、无头 CLI 和 VS Code 插件共用官方 [Codex App Server](https://learn.chatgpt.com/docs/app-server) 核心。桌面版另外提供单独确认的目录回收站和 Codex 桌面端“最近任务”派生索引修复适配器。

> Threadbox for Codex 是独立社区项目，与 OpenAI 没有隶属或背书关系。

## 功能

- 跨工作目录列出活动和归档任务。
- 搜索标题、摘要、路径、来源和任务 ID。
- 桌面端聊天按 Project 聚合，VS Code/CLI 聊天按实际工作目录聚合，未加入 Project 的桌面端聊天归入独立任务。
- 可直接在 VS Code 的 Codex 侧边栏中导入当前工作区，把本机或远端任务整理为 Threadbox 项目，并支持拖放和多选操作。
- 支持分组/平铺视图，并可按项目或工作区、归档状态、来源、目录和更新时间筛选。
- 单项或批量归档、取消归档和删除；VS Code 在永久删除前提供可恢复的任务垃圾箱。
- 可逐个选择将工作目录移入系统回收站，同时保留其他任务的代码。
- 将派生子代理任务折叠在父任务下，并避免对级联删除后的子任务重复提交请求。
- 保护运行中任务，并要求明确勾选不可恢复确认。
- 检测到其他 Codex 进程时提示跨进程状态可能不完整。
- 检测并修复任务本体已删除、但仍残留在 Codex 桌面端“最近任务”中的条目。
- 打开原工作目录或复制任务 ID。
- 简体中文/英文界面，跟随系统明暗主题。

所有处理均在本机完成。Threadbox 没有遥测，不调用模型，不上传或保存聊天内容副本。

## 选择使用方式

| 能力 | 桌面版 | CLI | VS Code / Remote |
| --- | --- | --- | --- |
| 列表、搜索、分组、归档、置顶和删除任务记录 | 支持 | 支持 | 支持 |
| 管理 Remote SSH、Dev Container 或 Codespaces 所在主机 | 不支持 | 支持 | 支持 |
| 创建或导入当前主机专属的任务项目 | 不支持 | 不支持 | 支持 |
| 从内置任务垃圾箱恢复任务 | 不支持 | 不支持 | 支持 |
| 打开任务工作目录 | 支持 | 不支持 | 支持 |
| 将所选工作目录移入系统回收站 | 支持 | 不支持 | 不支持 |
| 修复 Codex 桌面端派生的“最近任务”目录 | 支持 | 不支持 | 不支持 |

CLI 和 VS Code 插件始终保留工作目录，不提供递归删目录的隐藏参数。

## 环境要求

- 系统 `PATH` 中存在 Codex CLI `0.150.0` 或更新版本。
- 桌面版：Windows 10/11、macOS 或现代 Linux 桌面。
- CLI：Node.js `22.13.0` 或更新版本。
- 插件：VS Code `1.96.0` 或更新版本；远程环境需要在远端扩展宿主安装 Codex。

### 平台验证状态

| 平台 | 当前验证情况 |
| --- | --- |
| Windows 10/11 x64 | 已完成自动化测试、打包应用冒烟测试和实机使用 |
| macOS x64/arm64 | GitHub Actions 自动测试及未签名安装包构建；尚待实机验证 |
| Linux x64 | GitHub Actions 自动测试及未签名安装包构建；尚待实机验证 |

安装或更新 Codex CLI：

```bash
npm install -g @openai/codex@latest
```

也可以在 Threadbox 设置中选择 Codex 可执行文件，或配置 `CODEX_BINARY`。

## 桌面版安装

从 [GitHub Releases](https://github.com/iris-Neko/codex-threadbox/releases) 下载对应平台的安装包。

- **Windows：**运行 NSIS 安装程序或解压 ZIP。未签名版本可能触发 SmartScreen；核对发布者和校验值后，可选择“更多信息 > 仍要运行”。
- **macOS：**打开 DMG 或 ZIP。未签名版本可能需要右键应用选择“打开”，或在“系统设置 > 隐私与安全性”中批准。
- **Linux：**安装 DEB，或者给 AppImage 增加执行权限后运行。

每个 Release 都附带 `SHA256SUMS.txt`。

## CLI 安装

无需安装直接运行：

```bash
npx codex-threadbox
```

或全局安装：

```bash
npm install -g codex-threadbox
threadbox
```

在 TTY 中直接运行 `threadbox` 会进入交互管理器。脚本化命令包括 `status`、`list`、`archive`、`unarchive`、`pin`、`unpin` 和 `delete`；修改命令只接受明确的任务 ID。非交互删除必须传 `--yes`，`--json` 使用稳定的 `schemaVersion: 1` 输出。

## VS Code 插件安装

可从 [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=irisNeko.codex-threadbox-vscode)、[Open VSX](https://open-vsx.org/extension/irisNeko/codex-threadbox-vscode) 或 Release 中的 VSIX 安装 **Threadbox for Codex**。打开官方 Codex 侧边栏并展开 **Threadbox**，可用**导入当前工作区**、拖放、多选或**移动到项目**管理项目树；将 `threadbox.sidebarLocation` 设置为 `standalone` 可恢复原来的独立活动栏入口，未检测到兼容的 Codex 侧边栏时也会自动回退。命令面板中的 **Threadbox: Open Manager** 用于打开完整管理器。

插件声明了 `extensionKind: ["workspace"]`。在 Remote SSH、Dev Container 和 Codespaces 中，Codex CLI、`CODEX_HOME`、任务数据和 App Server 进程都位于远端。需要时使用 machine-scoped 的 `threadbox.codexBinary`、`threadbox.codexHome` 和 `threadbox.language` 设置。检测到 CLI 低于最低版本时，侧边栏和完整管理器会显示**更新 Codex CLI**；点击后会在该扩展宿主运行官方 `codex update` 自更新命令，并在重新连接前校验新版本。CLI 缺失或路径无效时仍需先安装，或在设置中配置路径。未信任工作区不会启动 Codex 或执行任务修改。

Threadbox 项目名称和根任务归属保存在该扩展宿主的 VS Code 全局存储中，不修改 Codex 数据库，也不会在不同远程主机间自动同步。Codex 界面中的项目目前没有通过公开 App Server 暴露，因此 Threadbox 无法导入或同步这些项目定义；其中的任务仍会按工作目录显示，并可照常在 Codex 中打开和继续。内置**垃圾箱**支持所有任务：移入时会归档任务，恢复时会尽量回到原 Threadbox 项目，只有执行**清空垃圾箱**才会永久删除符合条件的任务记录。整个过程始终保留工作目录。

## 删除安全

永久删除使用 App Server 的 `thread/delete`，它会同时删除派生子任务。Threadbox 会在删除前重新刷新列表，排除运行中和已置顶任务，将已选择的子任务合并到已选择的父任务下，并顺序执行根任务删除。因此单项失败不会中止剩余操作。

项目文件默认保留。删除对话框列出的是表格中显示的确切任务 `cwd`，不是项目或工作区分组名称；只有明确勾选的目录才会在对应任务删除成功后移入操作系统回收站。磁盘根目录、用户主目录、Codex 数据目录、系统位置、Threadbox 自身路径，以及仍被其他 Codex 任务引用的目录会强制保留。移入回收站失败时，Threadbox 不会改用永久文件删除。

CLI 和 VS Code 插件不包含操作系统目录回收站或“最近任务”修复适配器。CLI 直接通过 App Server 删除任务记录；VS Code 的普通删除会先进入基于归档状态和本地分组实现的任务垃圾箱，只有**清空垃圾箱**才通过 App Server 永久删除其中的任务记录。两者始终保留全部工作目录。

此版本针对最新两个稳定版 Codex CLI `0.150.0` 和 `0.150.1` 完成验证，不再支持 `0.149.x` 及更旧版本。对于更新版本，Threadbox 会尽力保持向前兼容：允许未知响应字段，并继续按运行时能力启用置顶等可选功能。Threadbox 不会为了绕过缺失的任务接口而修改 Codex 任务状态文件。

运行状态属于某个 App Server 进程。独立的 Threadbox 无法保证看到另一个 Codex 桌面端或 IDE 进程中的活动任务，因此检测到其他 Codex 进程时会明确提示。

Codex 桌面端还为侧栏“最近任务”维护了独立的派生目录 `local_thread_catalog`。跨进程调用 App Server 删除任务后，这个目录可能留下孤儿行，即使任务和 rollout 已经不存在。Threadbox 会用重新分页取得的 App Server 清单与该目录对账，并在单独确认后只移除本机 host 的孤儿索引。修改前会用 SQLite 在线备份到 `~/.codex/backups_threadbox/desktop-recents`，并执行 `PRAGMA integrity_check` 校验。该修复不会修改云端 host、任务状态数据库、rollout 文件或工作目录。

## 开发

需要 Node.js 22+（CI 使用 Node.js 24）和 npm。

```bash
npm install
npm run dev
```

完整检查：

```bash
npm run lint
npm run typecheck
npm test
npm run test:cli
npm run test:vscode
npm run test:integration
npm run test:e2e
npm run package
```

真实 CLI 集成测试使用临时隔离的 `CODEX_HOME`；单元、CLI、VS Code 和 Electron 测试在需要修改操作时使用假的 stdio App Server，不会修改真实 Codex 任务。

更多信息见[架构说明](docs/ARCHITECTURE.md)和[贡献指南](CONTRIBUTING.md)。

## 范围

Threadbox 不包含完整聊天查看/导出、任务数据库修复、无人值守的 CLI 自动升级或内置 Codex CLI。VS Code 插件只会在用户点击更新操作后运行官方 `codex update` 命令。“最近任务”修复仅限上文所述的可重建侧栏派生目录。

## 许可证

[MIT](LICENSE)
