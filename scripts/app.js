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
const temperatureSlider = document.getElementById("temperature");
const temperatureValue = document.getElementById("temperatureValue");
const payloadPreview = document.getElementById("payloadPreview");
const testConnectionButton = document.getElementById("testConnection");
const resetSettingsButton = document.getElementById("resetSettings");

const settingsForm = document.getElementById("settingsForm");
const baseUrlInput = document.getElementById("baseUrl");
const endpointInput = document.getElementById("endpoint");
const methodInput = document.getElementById("httpMethod");
const mockToggle = document.getElementById("mockToggle");
const apiKeyInput = document.getElementById("apiKey");
const extraHeadersInput = document.getElementById("extraHeaders");
const systemPromptInput = document.getElementById("systemPrompt");

const createId = () =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const state = {
  messages: [],
  attachments: [],
  settings: {
    baseUrl: "",
    endpoint: "/agent/invoke",
    method: "POST",
    mock: true,
    apiKey: "",
    temperature: 0.7,
    extraHeaders: "",
    systemPrompt: systemPromptInput.value.trim(),
  },
};

const ROLE_LABELS = {
  user: "你",
  assistant: "智能体",
  system: "系统",
};

init();

function init() {
  temperatureSlider.addEventListener("input", handleTemperatureChange);
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
  testConnectionButton.addEventListener("click", testConnection);
  resetSettingsButton.addEventListener("click", resetSettings);
  settingsForm.addEventListener("input", syncSettingsFromForm);

  addSystemMessage(state.settings.systemPrompt);
  updateTemperatureValue();
  updateMetrics();
  updateAttachmentList();
  renderPayloadPreview();
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
    fileDropZone.addEventListener(eventName, () => fileDropZone.classList.add("dragover"));
  });

  ["dragleave", "drop"].forEach((eventName) => {
    fileDropZone.addEventListener(eventName, () => fileDropZone.classList.remove("dragover"));
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
  renderPayloadPreview();
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
    chip.innerHTML = `📎 ${file.name} · ${(file.size / 1024).toFixed(1)} KB <button class="remove" aria-label="移除附件">×</button>`;
    chip.querySelector(".remove").addEventListener("click", () => removeAttachment(id));
    attachmentListEl.appendChild(chip);
  });
}

function removeAttachment(id) {
  state.attachments = state.attachments.filter((item) => item.id !== id);
  updateAttachmentList();
  updateMetrics();
  renderPayloadPreview();
}

function handleTemperatureChange() {
  state.settings.temperature = Number(temperatureSlider.value);
  updateTemperatureValue();
  renderPayloadPreview();
}

function updateTemperatureValue() {
  temperatureValue.textContent = state.settings.temperature.toFixed(2);
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
  renderPayloadPreview();
  scrollConversationToEnd();

  const loadingId = createId();
  
  addAssistantPlaceholder(loadingId);
  setStatus("active", "调用中");

  sendToBackend({ ...userMessage, rawAttachments: rawFiles })
    .then((assistantMessage) => {
      replaceMessage(loadingId, assistantMessage);
      setStatus("idle", "待命");
    })
    .catch((error) => {
      replaceMessage(loadingId, {
        id: createId(),
        role: "assistant",
        content: `⚠️ 调用失败：${error.message}`,
        isError: true,
        timestamp: new Date(),
      });
      setStatus("idle", "待命");
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
  const encodedAttachments = await encodeAttachments(userMessage.rawAttachments || []);
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

  const data = await response.json().catch(() => ({ content: "(响应解析失败)" }));
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

  if (state.settings.extraHeaders) {
    try {
      const extra = JSON.parse(state.settings.extraHeaders);
      Object.assign(headers, extra);
    } catch (error) {
      console.warn("无法解析额外 Header:", error);
    }
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
        chip.textContent = `📁 ${attachment.name} (${(attachment.size / 1024).toFixed(1)} KB)`;
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
  addSystemMessage(state.settings.systemPrompt);
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

function syncSettingsFromForm() {
  state.settings.baseUrl = baseUrlInput.value.trim();
  state.settings.endpoint = endpointInput.value.trim();
  state.settings.method = methodInput.value;
  state.settings.mock = mockToggle.checked;
  state.settings.apiKey = apiKeyInput.value.trim();
  state.settings.extraHeaders = extraHeadersInput.value.trim();
  state.settings.systemPrompt = systemPromptInput.value.trim();
  renderPayloadPreview();
}

function renderPayloadPreview() {
  const previewHeaders = buildHeaders();
  if (previewHeaders.Authorization) {
    previewHeaders.Authorization = maskApiKey(previewHeaders.Authorization);
  }

  const preview = {
    url: state.settings.baseUrl ? composeUrl() : "(未配置)",
    method: state.settings.method,
    mock: state.settings.mock,
    headers: previewHeaders,
    body: buildPayload({
      content: messageInput.value.trim() || "<当前输入>",
      attachments: state.attachments.map(({ file }) => ({ name: file.name, size: file.size })),
      timestamp: new Date(),
    }),
  };

  if (preview.body?.attachments?.length) {
    preview.body.attachments = preview.body.attachments.map((item) => ({
      ...item,
      base64: "<发送时自动注入>",
    }));
  }

  if (state.settings.method === "GET") {
    delete preview.body;
  }

  payloadPreview.textContent = JSON.stringify(preview, null, 2);
}

function maskApiKey(value) {
  const token = value.replace(/^Bearer\s+/i, "");
  if (token.length <= 8) {
    return "Bearer ****";
  }
  const visible = `${token.slice(0, 4)}…${token.slice(-4)}`;
  return `Bearer ${visible}`;
}

async function testConnection() {
  syncSettingsFromForm();
  if (!state.settings.baseUrl) {
    alert("请先填写服务根地址。");
    return;
  }

  setStatus("active", "测试中");
  try {
    const response = await fetch(composeUrl(), {
      method: "OPTIONS",
      headers: buildHeaders(),
    });
    if (response.ok) {
      alert("连接成功，服务可用。");
    } else {
      alert(`连接失败：HTTP ${response.status}`);
    }
  } catch (error) {
    alert(`连接失败：${error.message}`);
  } finally {
    setStatus("idle", "待命");
  }
}

function resetSettings() {
  settingsForm.reset();
  state.settings.baseUrl = "";
  state.settings.endpoint = "/agent/invoke";
  state.settings.method = "POST";
  state.settings.mock = true;
  state.settings.apiKey = "";
  state.settings.temperature = 0.7;
  state.settings.extraHeaders = "";
  state.settings.systemPrompt = systemPromptInput.value.trim();
  temperatureSlider.value = state.settings.temperature.toString();
  updateTemperatureValue();
  renderPayloadPreview();
}
