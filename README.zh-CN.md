# Threadbox for Codex

**本地运行、跨平台的 Codex 任务记录管理器。**

[English](README.md)

![Threadbox 任务列表](docs/images/threadbox-main.png)

Threadbox 将所有工作目录中的 Codex CLI 和桌面端任务记录汇总到一个可搜索列表。所有任务操作都通过官方 [Codex App Server](https://learn.chatgpt.com/docs/app-server) 执行。另有一个需要单独确认的修复工具，会先备份并校验数据库，再清理 Codex 桌面端“最近任务”的孤儿派生索引；它不会修改任务状态、JSONL 对话文件或项目文件。

> Threadbox for Codex 是独立社区项目，与 OpenAI 没有隶属或背书关系。

## 功能

- 跨工作目录列出活动和归档任务。
- 搜索标题、摘要、路径、来源和任务 ID。
- 桌面端聊天按 Project 聚合，VS Code/CLI 聊天按实际工作目录聚合，未加入 Project 的桌面端聊天归入独立任务。
- 支持分组/平铺视图，并可按项目或工作区、归档状态、来源、目录和更新时间筛选。
- 单项或批量归档、取消归档和永久删除。
- 可逐个选择将工作目录移入系统回收站，同时保留其他任务的代码。
- 将派生子代理任务折叠在父任务下，并避免对级联删除后的子任务重复提交请求。
- 保护运行中任务，并要求明确勾选不可恢复确认。
- 检测到其他 Codex 进程时提示跨进程状态可能不完整。
- 检测并修复任务本体已删除、但仍残留在 Codex 桌面端“最近任务”中的条目。
- 打开原工作目录或复制任务 ID。
- 简体中文/英文界面，跟随系统明暗主题。

所有处理均在本机完成。Threadbox 没有遥测，不调用模型，不上传或保存聊天内容副本。

## 环境要求

- Windows 10/11、macOS 或现代 Linux 桌面。
- 系统 `PATH` 中存在 Codex CLI `0.149.0` 或更新版本。

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

## 安装

从 [GitHub Releases](https://github.com/iris-Neko/codex-threadbox/releases) 下载对应平台的安装包。

- **Windows：**运行 NSIS 安装程序或解压 ZIP。未签名版本可能触发 SmartScreen；核对发布者和校验值后，可选择“更多信息 > 仍要运行”。
- **macOS：**打开 DMG 或 ZIP。未签名版本可能需要右键应用选择“打开”，或在“系统设置 > 隐私与安全性”中批准。
- **Linux：**安装 DEB，或者给 AppImage 增加执行权限后运行。

每个 Release 都附带 `SHA256SUMS.txt`。

## 删除安全

永久删除使用 App Server 的 `thread/delete`，它会同时删除派生子任务。Threadbox 会在删除前重新刷新列表，排除运行中和已置顶任务，将已选择的子任务合并到已选择的父任务下，并顺序执行根任务删除。因此单项失败不会中止剩余操作。

项目文件默认保留。删除对话框列出的是表格中显示的确切任务 `cwd`，不是项目或工作区分组名称；只有明确勾选的目录才会在对应任务删除成功后移入操作系统回收站。磁盘根目录、用户主目录、Codex 数据目录、系统位置、Threadbox 自身路径，以及仍被其他 Codex 任务引用的目录会强制保留。移入回收站失败时，Threadbox 不会改用永久文件删除。

Codex `0.149.0` 的稳定 App Server 协议还没有公开置顶元数据。Threadbox 会按运行时能力启用置顶按钮，不会为了绕过缺失的任务接口而修改 Codex 任务状态文件。

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
npm run test:integration
npm run test:e2e
npm run package
```

真实 CLI 集成测试使用临时隔离的 `CODEX_HOME`；单元测试和 Electron 测试使用假的 stdio App Server，不会修改真实 Codex 任务。

更多信息见[架构说明](docs/ARCHITECTURE.md)和[贡献指南](CONTRIBUTING.md)。

## 范围

Threadbox 不包含完整聊天查看/导出、任务数据库修复、自动升级 CLI 或内置 Codex CLI。“最近任务”修复仅限上文所述的可重建侧栏派生目录。

## 许可证

[MIT](LICENSE)
