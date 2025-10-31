const conversationEl = document.getElementById("conversation");
const messageTemplate = document.getElementById("messageTemplate");
const messageInput = document.getElementById("messageInput");
const sendButton = document.getElementById("sendButton");
const clearButton = document.getElementById("clearButton");
const messageCountEl = document.getElementById("messageCount");
const uploadCountEl = document.getElementById("uploadCount");
const fileInput = document.getElementById("fileInput");
const fileTrigger = document.getElementById("fileTrigger");
const fileDropZone = document.getElementById("fileDropZone");
const attachmentListEl = document.getElementById("attachmentList");
const statusPanel = document.getElementById("statusPanel");

const CONFIG_URL = "config/app-config.json";

const DEFAULT_SETTINGS = {
  baseUrl: "",
  endpoint: "/agent/invoke",
  method: "POST",
  mock: true,
  apiKey: "",
  temperature: 0.7,
  extraHeaders: {},
  systemPrompt:
    "你是一个专业且可靠的智能助手，注意精炼回答，并在需要时引用上传的资料。",
};

const ROLE_LABELS = {
  user: "你",
  assistant: "智能体",
  system: "系统",
};

const state = {
  messages: [],
  attachments: [],
  settings: {
    ...DEFAULT_SETTINGS,
    extraHeaders: { ...DEFAULT_SETTINGS.extraHeaders },
  },
};

init();

async function init() {
  bindComposerEvents();
  await loadSettings();

  if (state.settings.systemPrompt) {
    addSystemMessage(state.settings.systemPrompt);
  }

  updateMetrics();
  updateAttachmentList();
}

function bindComposerEvents() {
  fileTrigger.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", (event) => handleFiles(event.target.files));
  setupDragAndDrop();

  sendButton.addEventListener("click", handleSendMessage);
  messageInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSendMessage();
    }
  });

  clearButton.addEventListener("click", clearConversation);
}

async function loadSettings() {
  try {
    const response = await fetch(CONFIG_URL, { cache: "no-cache" });
    if (!response.ok) {
      throw new Error(`配置文件加载失败：HTTP ${response.status}`);
    }

    const data = await response.json();
    const normalized = normalizeSettings(data);
    state.settings = {
      ...DEFAULT_SETTINGS,
      ...normalized,
      extraHeaders: normalizeExtraHeaders(normalized.extraHeaders),
    };

    if (typeof state.settings.systemPrompt !== "string") {
      state.settings.systemPrompt = DEFAULT_SETTINGS.systemPrompt;
    }

    if (typeof state.settings.temperature !== "number") {
      state.settings.temperature = DEFAULT_SETTINGS.temperature;
    }

    if (typeof state.settings.mock !== "boolean") {
      state.settings.mock = DEFAULT_SETTINGS.mock;
    }

    setStatus("idle", state.settings.mock ? "模拟模式" : "待命");
  } catch (error) {
    console.warn("配置文件读取失败，已回退到默认配置。", error);
    state.settings = {
      ...DEFAULT_SETTINGS,
      extraHeaders: { ...DEFAULT_SETTINGS.extraHeaders },
    };
    setStatus("idle", "使用默认配置");
  }
}

function normalizeSettings(config) {
  if (!config || typeof config !== "object") {
    return {};
  }

  const normalized = { ...config };

  if (typeof normalized.method === "string") {
    normalized.method = normalized.method.toUpperCase();
  }

  return normalized;
}

function normalizeExtraHeaders(value) {
  if (!value) {
    return {};
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return normalizeExtraHeaders(parsed);
    } catch (error) {
      console.warn("额外 Header 配置解析失败，将忽略该字段。", error);
      return {};
    }
  }

  if (typeof value === "object" && !Array.isArray(value)) {
    return { ...value };
  }

  return {};
}

function setupDragAndDrop() {
  const preventDefaults = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };

  ["dragenter", "dragover", "dragleave", "drop"].forEach((eventName) => {
    fileDropZone.addEventListener(eventName, preventDefaults);
  });

  ["dragenter", "dragover"].forEach((eventName) => {
    fileDropZone.addEventListener(eventName, () =>
      fileDropZone.classList.add("dragover")
    );
  });

  ["dragleave", "drop"].forEach((eventName) => {
    fileDropZone.addEventListener(eventName, () =>
      fileDropZone.classList.remove("dragover")
    );
  });

  fileDropZone.addEventListener("drop", (event) => {
    const files = event.dataTransfer?.files;
    if (files?.length) {
      handleFiles(files);
    }
  });
}

function handleFiles(fileList) {
  const newFiles = Array.from(fileList).map((file) => ({
    id: createId(),
    file,
  }));
  state.attachments.push(...newFiles);
  updateAttachmentList();
  updateMetrics();
  fileInput.value = "";
}

function updateAttachmentList() {
  attachmentListEl.innerHTML = "";
  if (!state.attachments.length) {
    const placeholder = document.createElement("div");
    placeholder.className = "attachment-placeholder";
    placeholder.textContent = "尚未选择附件";
    attachmentListEl.appendChild(placeholder);
    return;
  }

  state.attachments.forEach(({ id, file }) => {
    const chip = document.createElement("span");
    chip.className = "attachment-chip";
    chip.innerHTML = `📎 ${file.name} · ${(file.size / 1024).toFixed(
      1
    )} KB <button class="remove" aria-label="移除附件">×</button>`;
    chip.querySelector(".remove").addEventListener("click", () =>
      removeAttachment(id)
    );
    attachmentListEl.appendChild(chip);
  });
}

function removeAttachment(id) {
  state.attachments = state.attachments.filter((item) => item.id !== id);
  updateAttachmentList();
  updateMetrics();
}

function addSystemMessage(content) {
  state.messages.push({
    id: createId(),
    role: "system",
    content,
    timestamp: new Date(),
  });
  renderMessages();
}

function handleSendMessage() {
  const content = messageInput.value.trim();
  if (!content && !state.attachments.length) {
    messageInput.focus();
    return;
  }

  const rawFiles = state.attachments.map(({ file }) => file);
  const userMessage = {
    id: createId(),
    role: "user",
    content,
    attachments: rawFiles.map((file) => ({ name: file.name, size: file.size })),
    timestamp: new Date(),
  };

  state.messages.push(userMessage);
  renderMessages();
  messageInput.value = "";
  state.attachments = [];
  updateAttachmentList();
  updateMetrics();
  scrollConversationToEnd();

  const loadingId = createId();

  addAssistantPlaceholder(loadingId);
  setStatus("active", "调用中");

  sendToBackend({ ...userMessage, rawAttachments: rawFiles })
    .then((assistantMessage) => {
      replaceMessage(loadingId, assistantMessage);
      setStatus("idle", state.settings.mock ? "模拟模式" : "待命");
    })
    .catch((error) => {
      replaceMessage(loadingId, {
        id: createId(),
        role: "assistant",
        content: `⚠️ 调用失败：${error.message}`,
        isError: true,
        timestamp: new Date(),
      });
      setStatus("idle", "调用异常");
    });
}

function addAssistantPlaceholder(id) {
  state.messages.push({
    id,
    role: "assistant",
    content: "智能体正在思考...",
    timestamp: new Date(),
    loading: true,
  });
  renderMessages();
  scrollConversationToEnd();
}

function replaceMessage(id, newMessage) {
  const index = state.messages.findIndex((msg) => msg.id === id);
  if (index !== -1) {
    state.messages[index] = newMessage;
    renderMessages();
    scrollConversationToEnd();
  }
}

async function sendToBackend(userMessage) {
  const encodedAttachments = await encodeAttachments(
    userMessage.rawAttachments || []
  );
  const payload = buildPayload({ ...userMessage, attachments: encodedAttachments });

  if (state.settings.mock || !state.settings.baseUrl) {
    await delay(700);
    return {
      id: createId(),
      role: "assistant",
      content: generateMockResponse(payload),
      timestamp: new Date(),
    };
  }

  const url = composeUrl();
  const headers = buildHeaders();

  const response = await fetch(url, {
    method: state.settings.method,
    headers,
    body: state.settings.method === "GET" ? undefined : JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `HTTP ${response.status}`);
  }

  const data = await response
    .json()
    .catch(() => ({ content: "(响应解析失败)" }));
  return normalizeBackendResponse(data);
}

function buildPayload(userMessage) {
  return {
    system: state.settings.systemPrompt,
    input: userMessage.content,
    attachments: userMessage.attachments || [],
    temperature: state.settings.temperature,
    timestamp: userMessage.timestamp.toISOString(),
  };
}

async function encodeAttachments(files) {
  if (!files.length) return [];
  const encoded = await Promise.all(
    files.map(async (file) => ({
      name: file.name,
      size: file.size,
      type: file.type,
      lastModified: file.lastModified,
      base64: await readFileAsBase64(file),
    }))
  );
  return encoded;
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") {
        const [, base64 = ""] = result.split(",");
        resolve(base64);
      } else {
        reject(new Error("无法解析文件内容"));
      }
    };
    reader.onerror = () => reject(reader.error || new Error("文件读取失败"));
    reader.readAsDataURL(file);
  });
}

function generateMockResponse(payload) {
  const attachmentNote = payload.attachments.length
    ? `我已接收到 ${payload.attachments.length} 个附件，可用于辅助分析。`
    : "本次请求未附带额外资料。";

  const mood = payload.temperature > 0.6 ? "创造性" : "严谨";
  return `收到指令：\n${payload.input}\n\n${attachmentNote}\n当前工作模式：${mood}。`;
}

function composeUrl() {
  const base = state.settings.baseUrl.replace(/\/$/, "");
  const endpoint = state.settings.endpoint || "/";
  return `${base}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`;
}

function buildHeaders() {
  const headers = {
    "Content-Type": "application/json",
  };

  if (state.settings.apiKey) {
    headers.Authorization = `Bearer ${state.settings.apiKey}`;
  }

  const extras = state.settings.extraHeaders;
  if (extras && typeof extras === "object" && !Array.isArray(extras)) {
    Object.entries(extras).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        headers[key] = value;
      }
    });
  }

  return headers;
}

function normalizeBackendResponse(data) {
  if (Array.isArray(data.messages)) {
    const assistant = data.messages.find((msg) => msg.role === "assistant");
    if (assistant) {
      return {
        id: createId(),
        role: "assistant",
        content: assistant.content || "(未提供内容)",
        timestamp: new Date(),
      };
    }
  }

  if (typeof data === "string") {
    return {
      id: createId(),
      role: "assistant",
      content: data,
      timestamp: new Date(),
    };
  }

  return {
    id: createId(),
    role: "assistant",
    content: data.content || JSON.stringify(data, null, 2),
    timestamp: new Date(),
  };
}

function renderMessages() {
  conversationEl.innerHTML = "";

  state.messages.forEach((message) => {
    const fragment = messageTemplate.content.cloneNode(true);
    const container = fragment.querySelector(".message");
    const avatar = fragment.querySelector(".avatar");
    const roleEl = fragment.querySelector(".role");
    const timestampEl = fragment.querySelector(".timestamp");
    const contentEl = fragment.querySelector(".bubble-content");
    const attachmentsEl = fragment.querySelector(".bubble-attachments");

    container.classList.add(message.role);
    if (message.loading) {
      container.classList.add("loading");
    }

    avatar.textContent = ROLE_LABELS[message.role]?.[0] ?? "A";
    roleEl.textContent = ROLE_LABELS[message.role] ?? message.role;
    timestampEl.textContent = formatTime(message.timestamp);
    contentEl.textContent = message.content;

    if (message.attachments?.length) {
      message.attachments.forEach((attachment) => {
        const chip = document.createElement("span");
        chip.className = "attachment-chip";
        chip.textContent = `📁 ${attachment.name} (${(attachment.size / 1024).toFixed(
          1
        )} KB)`;
        attachmentsEl.appendChild(chip);
      });
    }

    if (message.isError) {
      container.classList.add("error");
      contentEl.style.color = "var(--danger)";
    }

    conversationEl.appendChild(fragment);
  });

  updateMetrics();
}

function scrollConversationToEnd() {
  requestAnimationFrame(() => {
    conversationEl.scrollTop = conversationEl.scrollHeight;
  });
}

function clearConversation() {
  state.messages = [];
  if (state.settings.systemPrompt) {
    addSystemMessage(state.settings.systemPrompt);
  }
  updateMetrics();
}

function updateMetrics() {
  messageCountEl.textContent = `${state.messages.length} 条消息`;
  uploadCountEl.textContent = `${state.attachments.length} 个附件`;
}

function setStatus(stateName, label) {
  const indicator = statusPanel.querySelector(".status-indicator");
  indicator.classList.remove("status-idle", "status-active");
  indicator.classList.add(stateName === "active" ? "status-active" : "status-idle");
  statusPanel.querySelector(".status-text").textContent = label;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatTime(date) {
  const d = new Date(date);
  return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

function createId() {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
