# Agent Portal

一个用于对接自定义 AI Agent 服务的前端入口，同时提供：

- 📄 静态版单页应用（`index.html` + 原生 JavaScript），适合零依赖部署；
- 🧱 基于 Streamlit 的交互式 Web 应用（`streamlit_app.py`），便于扩展用户管理、鉴权等后台能力。

## 功能亮点

- 🎨 **沉浸式界面**：静态版延续深色霓虹配色、玻璃拟态卡片。
- 💬 **对话交互**：两种实现均支持系统提示词管理、消息历史与请求状态提示。
- 📎 **文件上传**：支持拖拽/多选文件，发送时自动转为 Base64 数据。
- ⚙️ **灵活接入**：通过 `config/app-config.json` 配置服务地址、请求方法、Header 及温度等参数。
- 🧩 **可扩展架构**：Streamlit 版本预留了侧边栏配置、模拟响应与错误提示，便于后续叠加登录、审计等功能。

## 使用方式

### Streamlit 应用

1. 安装依赖：

   ```bash
   pip install -r requirements.txt
   ```

2. 根据实际环境编辑 `config/app-config.json`，配置服务根地址、接口路径、请求方法等信息。
3. 运行应用：

   ```bash
   streamlit run streamlit_app.py
   ```

4. 在浏览器中使用侧边栏管理 API 配置、上传附件并与智能体对话。

> 默认启用模拟响应模式，可通过侧边栏、配置文件中的 `mock` 字段或环境变量 `AGENT_PORTAL_USE_MOCK` 进行切换。

### 静态单页应用

1. 将项目部署在任意静态站点（如 Vercel、Netlify 或 Nginx 静态目录）。
2. 根据实际环境编辑 `config/app-config.json`，配置服务根地址、接口路径、请求方法等信息。
3. 启动 Streamlit：

   ```bash
   streamlit run streamlit_app.py
   ```

4. 在浏览器中使用侧边栏管理 API 配置、上传附件并与智能体对话。

> 默认启用模拟响应模式，可通过侧边栏、配置文件中的 `mock` 字段或环境变量 `AGENT_PORTAL_USE_MOCK` 进行切换。

## 自定义集成

Streamlit 应用本身即可作为嵌入式微前端部署在更大的系统中，亦可在侧边栏追加登录控件、租户选择等企业场景所需模块。

## 本地开发

### 环境变量覆盖

Streamlit 版本支持以下环境变量，可在容器或 Kubernetes 中重写默认配置：

| 环境变量 | 对应字段 | 示例 |
| --- | --- | --- |
| `AGENT_PORTAL_BASE_URL` | API 根地址 | `https://agent-backend.example.com` |
| `AGENT_PORTAL_ENDPOINT` | 请求路径 | `/agent/invoke` |
| `AGENT_PORTAL_METHOD` | HTTP 方法 | `POST` |
| `AGENT_PORTAL_USE_MOCK` | 是否启用模拟响应 | `false` |
| `AGENT_PORTAL_API_KEY` | 鉴权令牌 | `sk-***` |
| `AGENT_PORTAL_TEMPERATURE` | 温度参数 | `0.7` |
| `AGENT_PORTAL_EXTRA_HEADERS` | 额外请求头（JSON） | `{ "X-Tenant": "demo" }` |
| `AGENT_PORTAL_SYSTEM_PROMPT` | 系统提示词 | `你是一个企业助手` |

### Docker 镜像

使用项目自带的 `Dockerfile` 构建并运行容器：

```bash
docker build -t agent-portal:latest .
docker run -it --rm -p 8501:8501 \
  -e AGENT_PORTAL_BASE_URL="https://agent-backend.example.com" \
  -e AGENT_PORTAL_USE_MOCK=false \
  agent-portal:latest
```

容器默认在 `8501` 端口暴露 Streamlit 服务，可通过 `STREAMLIT_SERVER_PORT` 环境变量覆盖。

### Kubernetes 示例

`deploy/k8s/agent-portal.yaml` 提供了一个最小化的 `Deployment` + `Service` 样例，执行以下命令即可部署到集群：

```bash
kubectl apply -f deploy/k8s/agent-portal.yaml
```

欢迎根据业务需求继续扩展 UI、状态管理或引入框架。

## 部署指南

### 环境变量覆盖

Streamlit 版本支持以下环境变量，可在容器或 Kubernetes 中重写默认配置：

| 环境变量 | 对应字段 | 示例 |
| --- | --- | --- |
| `AGENT_PORTAL_BASE_URL` | API 根地址 | `https://agent-backend.example.com` |
| `AGENT_PORTAL_ENDPOINT` | 请求路径 | `/agent/invoke` |
| `AGENT_PORTAL_METHOD` | HTTP 方法 | `POST` |
| `AGENT_PORTAL_USE_MOCK` | 是否启用模拟响应 | `false` |
| `AGENT_PORTAL_API_KEY` | 鉴权令牌 | `sk-***` |
| `AGENT_PORTAL_TEMPERATURE` | 温度参数 | `0.7` |
| `AGENT_PORTAL_EXTRA_HEADERS` | 额外请求头（JSON） | `{ "X-Tenant": "demo" }` |
| `AGENT_PORTAL_SYSTEM_PROMPT` | 系统提示词 | `你是一个企业助手` |

### Docker 镜像

使用项目自带的 `Dockerfile` 构建并运行容器：

```bash
docker build -t agent-portal:latest .
docker run -it --rm -p 8501:8501 \
  -e AGENT_PORTAL_BASE_URL="https://agent-backend.example.com" \
  -e AGENT_PORTAL_USE_MOCK=false \
  agent-portal:latest
```

容器默认在 `8501` 端口暴露 Streamlit 服务，可通过 `STREAMLIT_SERVER_PORT` 环境变量覆盖。

### Kubernetes 示例

`deploy/k8s/agent-portal.yaml` 提供了一个最小化的 `Deployment` + `Service` 样例，执行以下命令即可部署到集群：

```bash
kubectl apply -f deploy/k8s/agent-portal.yaml
```

根据实际情况替换镜像地址、环境变量及资源配置即可完成接入。
