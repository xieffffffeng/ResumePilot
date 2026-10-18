const path = require("node:path");
const fs = require("node:fs");
const { app, BrowserWindow, ipcMain } = require("electron");
const { createStorage } = require("./src/services/storage");
const { createEmptyProfile } = require("./src/services/agents");
const { buildResumePdfHtml } = require("./src/services/resume-pdf");
const {
  buildJsonRepairPrompt,
  buildWorkflowPrompt,
  normalizeWorkflowResult,
  parseJsonObject,
} = require("./src/services/llm-workflow");

let mainWindow;
let storage;

const DEFAULT_SETTINGS = {
  backendMode: "llm",
  provider: "deepseek",
  model: "",
  baseUrl: "",
  apiKey: "",
  skillInjection: true,
  timeoutSeconds: 120,
  preferences: {
    defaultStartView: "profile",
    toastSeconds: 3,
    autoOpenResumeAfterRun: true,
    compactUi: false,
  },
};

const LLM_PROVIDER_DEFAULTS = {
  openai: { model: "gpt-4o-mini", baseUrl: "https://api.openai.com/v1", apiStyle: "openai" },
  deepseek: { model: "deepseek-chat", baseUrl: "https://api.deepseek.com/v1", apiStyle: "openai" },
  openrouter: { model: "deepseek/deepseek-chat", baseUrl: "https://openrouter.ai/api/v1", apiStyle: "openai" },
  lmstudio: { model: "local-model", baseUrl: "http://localhost:1234/v1", apiStyle: "openai" },
  ollama: { model: "llama3.1", baseUrl: "http://localhost:11434", apiStyle: "ollama" },
};

function getDataRoot() {
  const baseDir = app && app.getPath ? app.getPath("userData") : __dirname;
  return path.join(baseDir, "ResumePilotData");
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 900,
    minWidth: 1060,
    minHeight: 720,
    backgroundColor: "#f5f7fb",
    title: "ResumePilot",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "src", "renderer", "index.html"));
}

function getInstalledSkillPaths() {
  const home = app && app.getPath ? app.getPath("home") : process.env.USERPROFILE || "";
  const skillRoot = path.join(home, ".codex", "skills");
  return [
    path.join(skillRoot, "getting-started", "SKILL.md"),
    path.join(skillRoot, "design-agent", "SKILL.md"),
    path.join(skillRoot, "design-task", "SKILL.md"),
    path.join(skillRoot, "frontend-design", "SKILL.md"),
  ];
}

function getAgentSkillList() {
  const baseSkills = [
    {
      name: "getting-started",
      path: getInstalledSkillPaths()[0],
      agents: ["简历整理 Agent", "评估 Agent", "面试官 Agent"],
      purpose: "统一输出格式、任务边界和基础工作流约束",
    },
    {
      name: "design-agent",
      path: getInstalledSkillPaths()[1],
      agents: ["简历整理 Agent"],
      purpose: "用于结构化组织简历内容和候选人信息表达",
    },
    {
      name: "design-task",
      path: getInstalledSkillPaths()[2],
      agents: ["评估 Agent", "面试官 Agent"],
      purpose: "用于拆解评分维度、建议和面试问题生成任务",
    },
    {
      name: "frontend-design",
      path: getInstalledSkillPaths()[3],
      agents: ["简历整理 Agent"],
      purpose: "用于提升最终简历版式、层级和可读性",
    },
  ];

  return baseSkills.map((skill) => ({
    ...skill,
    available: fs.existsSync(skill.path),
  }));
}

function normalizeSettings(settings = {}) {
  const merged = { ...DEFAULT_SETTINGS, ...settings };
  merged.preferences = { ...DEFAULT_SETTINGS.preferences, ...(settings.preferences || {}) };
  merged.backendMode = "llm";
  merged.timeoutSeconds = Number(merged.timeoutSeconds) || DEFAULT_SETTINGS.timeoutSeconds;
  merged.skillInjection = merged.skillInjection !== false;
  if (merged.provider === "local") merged.provider = "lmstudio";
  if (merged.provider === "ollama-cloud") merged.provider = "ollama";
  if (!merged.provider) merged.provider = DEFAULT_SETTINGS.provider;
  const providerDefault = LLM_PROVIDER_DEFAULTS[merged.provider];
  if (providerDefault) {
    if (!String(merged.model || "").trim()) merged.model = providerDefault.model;
    if (!String(merged.baseUrl || "").trim()) merged.baseUrl = providerDefault.baseUrl;
  }
  return merged;
}

function getLlmProviderConfig(settings) {
  const provider = settings.provider || DEFAULT_SETTINGS.provider;
  const defaults = LLM_PROVIDER_DEFAULTS[provider] || LLM_PROVIDER_DEFAULTS.deepseek;
  return {
    provider,
    model: String(settings.model || defaults.model).trim(),
    baseUrl: String(settings.baseUrl || defaults.baseUrl).trim().replace(/\/+$/, ""),
    apiKey: String(settings.apiKey || "").trim(),
    apiStyle: defaults.apiStyle,
  };
}

function requiresApiKey(provider) {
  return !["ollama", "lmstudio"].includes(provider);
}

function formatLlmConnectionError(error, config) {
  const message = String((error && error.message) || error || "");
  const cause = error && error.cause ? String(error.cause.message || error.cause) : "";
  const detail = [message, cause].filter(Boolean).join(" ");
  if (/fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|certificate|self[- ]signed|TLS/i.test(detail)) {
    if (config.apiStyle === "ollama") {
      return `无法连接 Ollama：请确认 Ollama 已启动，Base URL 为 ${config.baseUrl}，模型 ${config.model} 已安装。原始错误：${detail}`;
    }
    if (config.provider === "lmstudio") {
      return `无法连接本地 OpenAI-compatible 服务：请确认 LM Studio/本地模型服务已启动，Base URL 为 ${config.baseUrl}。原始错误：${detail}`;
    }
    return `无法连接 ${config.provider} API：请检查网络、代理、防火墙和 Base URL（${config.baseUrl}）。原始错误：${detail}`;
  }
  return message || "LLM API 调用失败";
}

async function runLlmPrompt({ prompt, settings, responseFormat = "json_object" }) {
  const config = getLlmProviderConfig(settings);
  if (requiresApiKey(config.provider) && !config.apiKey) {
    throw new Error(`请先在设置中填写 ${config.provider} 的 API Key，或切换到 Ollama / LM Studio 本地模型。`);
  }
  const controller = new AbortController();
  const timeoutMs = Math.max(30, settings.timeoutSeconds) * 1000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    if (config.apiStyle === "ollama") {
      const response = await fetch(`${config.baseUrl}/api/chat`, {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: config.model,
          stream: false,
          messages: [
            { role: "system", content: "你是一个严格遵守输出格式的中文求职助手。" },
            { role: "user", content: prompt },
          ],
        }),
      });
      if (!response.ok) throw new Error(`Ollama 返回 HTTP ${response.status}`);
      const body = await response.json();
      return String((body.message && body.message.content) || body.response || "").trim();
    }

    const headers = { "Content-Type": "application/json" };
    if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
    const payload = {
      model: config.model,
      temperature: 0.2,
      messages: [
        { role: "system", content: "你是一个严格遵守 JSON 输出格式的中文求职助手。只输出最终结果，不解释过程。" },
        { role: "user", content: prompt },
      ],
    };
    if (responseFormat) payload.response_format = { type: responseFormat };
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers,
      body: JSON.stringify(payload),
    });
    const bodyText = await response.text();
    if (!response.ok) {
      throw new Error(`${config.provider} 返回 HTTP ${response.status}：${bodyText.slice(0, 500)}`);
    }
    let body;
    try {
      body = JSON.parse(bodyText);
    } catch {
      throw new Error(`${config.provider} 返回内容不是合法 JSON：${bodyText.slice(0, 500)}`);
    }
    return String(body.choices && body.choices[0] && body.choices[0].message && body.choices[0].message.content || "").trim();
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`LLM 调用超时（${settings.timeoutSeconds} 秒）`);
    }
    throw new Error(formatLlmConnectionError(error, config));
  } finally {
    clearTimeout(timer);
  }
}

async function renderHtmlToPdfBuffer(html) {
  const pdfWindow = new BrowserWindow({
    show: false,
    width: 794,
    height: 1123,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  try {
    await pdfWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    return await pdfWindow.webContents.printToPDF({
      printBackground: true,
      pageSize: "A4",
      margins: {
        marginType: "none",
      },
    });
  } finally {
    if (!pdfWindow.isDestroyed()) pdfWindow.close();
  }
}

async function parseLlmJsonWithRepair({ rawResult, settings }) {
  try {
    return { parsed: parseJsonObject(rawResult), repairedInvalidJson: false, jsonRepairError: "" };
  } catch (error) {
    if (error.code !== "LLM_INVALID_JSON") throw error;
    const repairPrompt = buildJsonRepairPrompt({ rawText: error.rawText || rawResult });
    const repairedResult = await runLlmPrompt({ prompt: repairPrompt, settings });
    return {
      parsed: parseJsonObject(repairedResult),
      repairedInvalidJson: true,
      jsonRepairError: String(error.message || error).slice(0, 800),
    };
  }
}

async function runLlmBackend({ profile, jd, settings }) {
  const skillPaths = settings.skillInjection ? getInstalledSkillPaths() : [];
  const prompt = buildWorkflowPrompt({ profile, jd, skillPaths });
  const rawResult = await runLlmPrompt({ prompt, settings });
  const { parsed, repairedInvalidJson, jsonRepairError } = await parseLlmJsonWithRepair({ rawResult, settings });
  return {
    ...normalizeWorkflowResult(parsed),
    ...(repairedInvalidJson ? { repairedInvalidJson, jsonRepairError } : {}),
  };
}

async function testModelConnection(settings) {
  const normalized = normalizeSettings(settings);
  try {
    const response = await runLlmPrompt({
      prompt: "请只回复 OK，用于测试当前 LLM API 是否连通。",
      settings: normalized,
      responseFormat: "",
    });
    return {
      ok: true,
      mode: "llm",
      message: `LLM API 连通成功：${response || "OK"}`,
      result: {
        provider: normalized.provider || "默认 provider",
        model: normalized.model || "默认模型",
        response,
        testedAt: new Date().toISOString(),
      },
    };
  } catch (error) {
    return {
      ok: false,
      mode: "llm",
      message: error.message || String(error),
    };
  }
}

async function runConfiguredWorkflow({ profile, jd, settings }) {
  const normalized = normalizeSettings(settings);
  const result = await runLlmBackend({ profile, jd, settings: normalized });
  return {
    ...result,
    backend: {
      mode: "llm",
      provider: normalized.provider,
      model: normalized.model || "默认模型",
      skillInjection: normalized.skillInjection,
    },
  };
}

function registerIpcHandlers() {
  ipcMain.handle("app:getMeta", async () => ({
    dataRoot: getDataRoot(),
    version: app.getVersion(),
  }));

  ipcMain.handle("settings:load", async () => {
    const settings = await storage.loadSettings(DEFAULT_SETTINGS);
    return normalizeSettings(settings);
  });

  ipcMain.handle("settings:save", async (_event, settings) => {
    return storage.saveSettings(normalizeSettings(settings));
  });

  ipcMain.handle("settings:testModel", async (_event, settings) => {
    const effectiveSettings = normalizeSettings(settings || (await storage.loadSettings(DEFAULT_SETTINGS)));
    await storage.saveSettings(effectiveSettings);
    return testModelConnection(effectiveSettings);
  });

  ipcMain.handle("settings:listSkills", async () => getAgentSkillList());

  ipcMain.handle("user:list", async () => storage.listUsers());

  ipcMain.handle("user:createEmptyProfile", async () => createEmptyProfile());

  ipcMain.handle("user:load", async (_event, username) => {
    const profile = await storage.loadUser(username);
    return profile || createEmptyProfile();
  });

  ipcMain.handle("user:save", async (_event, { username, profile }) => {
    return storage.saveUser(username, profile);
  });

  ipcMain.handle("user:delete", async (_event, username) => {
    return storage.deleteUser(username);
  });

  ipcMain.handle("workflow:run", async (_event, { username, profile, jd, settings }) => {
    const effectiveSettings = normalizeSettings(settings || (await storage.loadSettings(DEFAULT_SETTINGS)));
    await storage.saveSettings(effectiveSettings);
    const result = await runConfiguredWorkflow({ profile, jd, settings: effectiveSettings });
    await storage.saveUser(username, profile);
    const bundle = [
      "# ResumePilot Session",
      "",
      `Generated: ${result.generatedAt}`,
      `Agent Backend: ${result.backend.mode}`,
      `Job Title: ${jd.jobTitle || result.analysis.title}`,
      "",
      "## Tailored Resume",
      result.resumeMarkdown,
      "",
      "## Evaluation",
      `Score: ${result.evaluation.score}/100`,
      "",
      "Matched Keywords:",
      result.evaluation.matchedKeywords.join(", ") || "None",
      "",
      "Suggestions:",
      ...result.evaluation.suggestions.map((item) => `- ${item}`),
      "",
      "## Mock Interview",
      ...result.interview.questions.flatMap((item, index) => [
        `${index + 1}. ${item.question}`,
        `参考答案：${item.referenceAnswer || ""}`,
      ]),
    ].join("\n");
    const artifactPath = await storage.saveArtifact(username, "session", bundle, "md");
    return { ...result, artifactPath };
  });

  ipcMain.handle("artifact:save", async (_event, { username, kind, content, extension }) => {
    return storage.saveArtifact(username, kind, content, extension);
  });

  ipcMain.handle("artifact:saveResumePdf", async (_event, { username, resumeMarkdown, profile, jd }) => {
    if (!String(resumeMarkdown || "").trim()) {
      throw new Error("没有可导出的简历内容");
    }
    const html = buildResumePdfHtml({ resumeMarkdown, profile, jd });
    const pdfBuffer = await renderHtmlToPdfBuffer(html);
    return storage.saveArtifactBuffer(username, "tailored-resume", pdfBuffer, "pdf");
  });
}

function startApp() {
  app.whenReady().then(() => {
    storage = createStorage(getDataRoot());
    registerIpcHandlers();
    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}

// Electron's app loader may leave require.main pointing at its own bootstrap.
const isElectronAppEntry = process.type === "browser" && app && app.getAppPath() === __dirname;
if (require.main === module || isElectronAppEntry) {
  startApp();
}

module.exports = {
  getAgentSkillList,
  formatLlmConnectionError,
  getLlmProviderConfig,
  requiresApiKey,
  renderHtmlToPdfBuffer,
  normalizeSettings,
  runLlmPrompt,
};
