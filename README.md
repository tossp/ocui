# OpenCodeUI

一个为 [OpenCode](https://github.com/anomalyco/opencode) 打造的第三方 Web 前端界面。

**本项目完全由 AI 辅助编程（Vibe Coding）完成**——从第一行代码到最终发布，所有功能均通过与 AI 对话驱动开发，累计 162 次提交。

> **免责声明**：本项目仅供学习交流使用，不对因使用本项目导致的任何问题承担责任。项目处于早期阶段，可能存在 bug 和不稳定之处。

## 快速体验

在本地运行
```bash
opencode serve --cors "https://lehhair.github.io"
```
然后访问 https://lehhair.github.io/OpenCodeUI/ 

## 特性

- **完整的 Chat 界面** — 消息流、Markdown 渲染、代码高亮（Shiki）
- **内置终端** — 基于 xterm.js 的 Web 终端，支持 WebGL 渲染
- **文件浏览与 Diff** — 查看工作区文件、多文件 diff 对比
- **主题系统** — 3 套内置主题（Eucalyptus / Claude / Breeze），支持明暗模式切换和自定义 CSS
- **PWA 支持** — 可安装为桌面/移动端应用，支持离线缓存
- **移动端适配** — 安全区域、触摸优化、响应式布局
- **浏览器通知** — AI 回复完成时推送通知
- **@ 提及与 / 斜杠命令** — 对话中快速引用文件和执行命令
- **自定义快捷键** — 可配置的键位绑定
- **Docker 部署** — 前后端分离容器化，开箱即用
- **View Transitions** — 主题切换时的圆形揭幕动画

## 技术栈

| 类别 | 技术 |
|------|------|
| 框架 | React 19 + TypeScript |
| 构建 | Vite 7 |
| 样式 | Tailwind CSS v4 |
| 代码高亮 | Shiki |
| 终端 | xterm.js (WebGL) |
| Markdown | react-markdown + remark-gfm |
| 虚拟列表 | react-virtuoso |
| 部署 | Docker (Caddy + Ubuntu) |

## 字体

- **UI 正文**：Inter（系统回退：system-ui, sans-serif）
- **衬线**：Georgia
- **代码/终端**：JetBrains Mono（项目内置 woff2），回退 Fira Code

## 设计说明

本项目的部分 UI 风格参考了 [Claude](https://claude.ai) 的界面设计。

## 预览

<img width="2298" height="1495" alt="image" src="https://github.com/user-attachments/assets/dc68837b-0560-4701-b6ab-ecb13fdc1f4f" />
<img width="2296" height="1500" alt="image" src="https://github.com/user-attachments/assets/7a8d9754-69c4-49c5-99ee-6452d94f5420" />

## 快速开始

### 前提

需要一个运行中的 [OpenCode](https://github.com/opencode-ai/opencode) 后端（`opencode serve`）。

### 本地开发

```bash
# 克隆
git clone https://github.com/lehhair/OpenCodeUI.git
cd OpenCodeUI

# 安装依赖
npm install

# 启动开发服务器
npm run dev
```

### Docker 部署

```bash
# 复制环境变量并填写 API Key
cp .env.example .env

# 启动前后端容器
docker compose up -d
```

前端默认端口 `3000`，后端 API 端口 `4096`。详见 `.env.example`。

## 项目结构

```
src/
├── api/            # API 请求封装
├── assets/         # 静态资源
├── components/     # 通用组件（Terminal、CodeBlock、DiffView 等）
├── contexts/       # React Context
├── features/       # 业务功能模块
│   ├── chat/       #   聊天界面（输入框、侧栏、消息区）
│   ├── message/    #   消息渲染（Markdown、工具调用）
│   ├── sessions/   #   会话管理
│   ├── settings/   #   设置面板
│   ├── attachment/  #   附件处理
│   ├── mention/    #   @ 提及
│   └── slash-command/ # 斜杠命令
├── hooks/          # 自定义 Hooks
├── store/          # 状态管理（主题、快捷键等）
├── themes/         # 主题预设定义
├── types/          # TypeScript 类型
├── utils/          # 工具函数
└── workers/        # Web Workers
```

## 许可证

本项目基于 [GPL-3.0](./LICENSE) 协议开源。

---

*本项目由 Vibe Coding 驱动开发，如果你也对 AI 辅助编程感兴趣，欢迎交流。*
