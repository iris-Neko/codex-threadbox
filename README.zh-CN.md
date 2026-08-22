# Threadbox for Codex

**本地运行、跨平台的 Codex 任务记录管理器。**

[English](README.md)

![Threadbox 任务列表](docs/images/threadbox-main.png)

Threadbox 将所有工作目录中的 Codex CLI 和桌面端任务记录汇总到一个可搜索列表。它只通过官方 [Codex App Server](https://learn.chatgpt.com/docs/app-server) 执行任务操作，不直接修改 Codex SQLite 数据库或 JSONL 对话文件。

> Threadbox for Codex 是独立社区项目，与 OpenAI 没有隶属或背书关系。

## 功能

- 跨工作目录列出活动和归档任务。
- 搜索标题、摘要、路径、来源和任务 ID。
- 按归档状态、来源、目录和更新时间筛选。
- 单项或批量归档、取消归档和永久删除。
- 识别父子任务，避免对级联删除后的子任务重复提交请求。
- 保护运行中任务，并要求明确勾选不可恢复确认。
- 检测到其他 Codex 进程时提示跨进程状态可能不完整。
- 打开原工作目录或复制任务 ID。
- 默认隐藏内部子代理任务。
- 简体中文/英文界面，跟随系统明暗主题。

所有处理均在本机完成。Threadbox 没有遥测，不调用模型，不上传或保存聊天内容副本。

## 环境要求

- Windows 10/11、macOS 或现代 Linux 桌面。
- 系统 `PATH` 中存在 Codex CLI `0.149.0` 或更新版本。

安装或更新 Codex CLI：

```bash
npm install -g @openai/codex@latest
```

也可以在 Threadbox 设置中选择 Codex 可执行文件，或配置 `CODEX_BINARY`。

## 安装

从 [GitHub Releases](https://github.com/iris-Neko/codex-threadbox/releases) 下载对应平台的安装包。

- **Windows：**运行 NSIS 安装程序或解压 ZIP。v0.1 尚未签名，SmartScreen 可能弹出提示；核对发布者和校验值后，可选择“更多信息 > 仍要运行”。
- **macOS：**打开 DMG 或 ZIP。v0.1 尚未签名，可能需要右键应用选择“打开”，或在“系统设置 > 隐私与安全性”中批准。
- **Linux：**安装 DEB，或者给 AppImage 增加执行权限后运行。

每个 Release 都附带 `SHA256SUMS.txt`。

## 删除安全

永久删除使用 App Server 的 `thread/delete`，它会同时删除派生子任务。Threadbox 会在删除前重新刷新列表，排除运行中和已置顶任务，将已选择的子任务合并到已选择的父任务下，并顺序执行根任务删除。因此单项失败不会中止剩余操作。

Codex `0.149.0` 的稳定 App Server 协议还没有公开置顶元数据。Threadbox 会按运行时能力启用置顶按钮，不会为了绕过缺失接口而修改 Codex 状态文件。

运行状态属于某个 App Server 进程。独立的 Threadbox 无法保证看到另一个 Codex 桌面端或 IDE 进程中的活动任务，因此检测到其他 Codex 进程时会额外显示警告。

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

## v0.1 范围

首版不包含完整聊天查看/导出、备份恢复、数据库修复、自动升级 CLI 或内置 Codex CLI。

## 许可证

[MIT](LICENSE)
