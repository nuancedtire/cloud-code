# Cloud Code (Cloudflare + OpenCode)

**Cloud Code** 是一个结合了 Cloudflare 强大基础设施与 OpenCode 智能能力的容器化 Agent 解决方案。

这是一个基于 Cloudflare Workers 和 Cloudflare Containers 的 TypeScript 项目。它利用 Cloudflare 的基础设施来运行和管理容器化工作负载。

[English](README.md) | 简体中文

## 🚀 快速开始

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/miantiao-me/cloud-code)

### 前置要求

- pnpm (推荐)
- Node.js (推荐 v20+)
- Wrangler CLI (`pnpm add -g wrangler`)

### 安装依赖

```bash
pnpm install
```

### 本地开发

启动本地开发服务器：

```bash
pnpm dev
# 或者
pnpm start
```

该命令会启动 `wrangler dev`，模拟 Cloudflare Workers 环境。

### 生成类型定义

如果你修改了 `wrangler.jsonc` 中的 bindings，需要重新生成类型文件：

```bash
pnpm cf-typegen
```

## 📦 部署

部署代码到 Cloudflare 全球网络：

```bash
pnpm deploy
```

## 📂 项目结构

```
.
├── src/
│   ├── index.ts        # Workers 入口文件 (ExportedHandler)
│   ├── container.ts    # AgentContainer 类定义 (继承自 Container)
│   └── sse.ts          # SSE (Server-Sent Events) 流处理逻辑
├── worker-configuration.d.ts # 自动生成的环境绑定类型
├── wrangler.jsonc      # Wrangler 配置文件
├── tsconfig.json       # TypeScript 配置
└── package.json
```

## 🔐 安全访问 (Basic Auth)

为了保护你的 Agent 不被未经授权的访问，本项目支持标准的 HTTP Basic Auth 认证。

### 配置方式

在 `wrangler.jsonc` 或 Cloudflare Dashboard 的环境变量中设置以下变量：

| 变量名            | 描述                                         | 默认值 |
| ----------------- | -------------------------------------------- | ------ |
| `SERVER_PASSWORD` | 访问密码。如果未设置，则**不启用**认证保护。 | (空)   |
| `SERVER_USERNAME` | 访问用户名。                                 | (空)   |

### 验证逻辑

1. 只有当 `SERVER_PASSWORD` 环境变量被设置时，认证功能才会启用。
2. 客户端请求必须包含 `Authorization: Basic <credentials>` 头。
3. 如果认证失败，Server 会返回 `401 Unauthorized` 状态码。

## 💾 数据持久化 (S3/R2)

Cloud Code 容器内置了对 S3 兼容存储（如 Cloudflare R2, AWS S3）的支持，通过 `TigrisFS` 将对象存储挂载为本地文件系统，实现数据的持久化保存。

### 环境变量配置

要启用数据持久化，需要在容器运行环境中配置以下环境变量：

| 变量名                 | 描述                           | 是否必须 | 默认值   |
| ---------------------- | ------------------------------ | -------- | -------- |
| `S3_ENDPOINT`          | S3 API 端点地址                | ✅ 是    | -        |
| `S3_BUCKET`            | 存储桶名称                     | ✅ 是    | -        |
| `S3_ACCESS_KEY_ID`     | 访问密钥 ID                    | ✅ 是    | -        |
| `S3_SECRET_ACCESS_KEY` | 访问密钥 Secret                | ✅ 是    | -        |
| `S3_REGION`            | 存储区域                       | ❌ 否    | `auto`   |
| `S3_PATH_STYLE`        | 是否使用 Path Style 访问       | ❌ 否    | `false`  |
| `S3_PREFIX`            | 存储桶内的路径前缀（子目录）   | ❌ 否    | (根目录) |
| `TIGRISFS_ARGS`        | 传递给 TigrisFS 的额外挂载参数 | ❌ 否    | -        |

### 工作原理

1. **挂载点**: 容器启动时，会将 S3 存储桶挂载到 `/root/s3`。
2. **工作目录**: 实际的工作空间位于 `/root/s3/workspace`。
3. **OpenCode 配置**: OpenCode 的配置文件（XDG 目录）也会存储在 `/root/s3/.opencode` 中，确保编辑器状态持久化。
4. **初始化**:
   - 如果 S3 存储桶（或指定的前缀路径）为空，容器会自动将预置的 `workspace` 目录内容复制进去。
   - 如果 S3 配置缺失，容器将回退到非持久化的本地目录模式。

## 🌐 隧道穿透 (Cloudflared)

容器内预装了 `cloudflared` CLI，可用于将容器内运行的服务（如开发服务器、Web 应用）通过 Cloudflare Tunnel 暴露到公网。

这在以下场景非常有用：

- 调试容器内运行的 Web 服务
- 临时共享开发环境
- 配置 SSH 访问

使用示例（在容器终端中）：

```bash
# 将容器内的 8080 端口暴露到公网
cloudflared tunnel --url http://localhost:8080
```

## 🛠 技术栈

- **Runtime**: Cloudflare Workers
- **语言**: TypeScript
- **核心库**:
  - `cloudflare:workers`: Workers 标准库
  - `@cloudflare/containers`: 容器管理与交互
- **工具**: Wrangler
- **容器环境**:
  - `nikolaik/python-nodejs`: Python 3.12 + Node.js 22
  - `tigrisfs`: S3 文件系统挂载
  - `cloudflared`: Cloudflare Tunnel 客户端
  - `opencode`: 智能编码 Agent

## 📝 开发规范

本项目官方语言为**英文**（代码、注释、提交信息均使用英文）。本 README 文件为中文翻译版本。
详细的开发规范、代码风格和 Agent 行为准则，请参考 [AGENTS.md](./AGENTS.md)。
