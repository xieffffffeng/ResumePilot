const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const state = {
  profile: null,
  workflow: null,
  settings: null,
  managedUsers: [],
  chatMessages: [],
  chatTranscript: [],
  archivedMessages: [],
  resumeVersions: [],
  currentSession: null,
  sessions: [],
};

let messageSeq = 0;
const AUTO_ARCHIVE_KEEP = 10; // 活跃层保留的非 system 消息条数，超出的旧消息自动归档（被 pin 的除外）

function nextMessageId() {
  messageSeq += 1;
  return `m${Date.now().toString(36)}-${messageSeq}`;
}

const basicIds = ["name", "school", "email", "birthday", "idNumber", "phone", "location"];
const educationFields = ["schoolName", "degree", "startDate", "endDate", "major"];

const providerDefaults = {
  deepseek: { model: "deepseek-chat", baseUrl: "https://api.deepseek.com/v1", contextLimit: 65536 },
  openai: { model: "gpt-4o-mini", baseUrl: "https://api.openai.com/v1", contextLimit: 128000 },
  openrouter: { model: "deepseek/deepseek-chat", baseUrl: "https://openrouter.ai/api/v1", contextLimit: 65536 },
  ollama: { model: "llama3.1", baseUrl: "http://localhost:11434", contextLimit: 8192 },
  lmstudio: { model: "local-model", baseUrl: "http://localhost:1234/v1", contextLimit: 8192 },
  kimi: { model: "kimi-k2.0905-preview", baseUrl: "https://api.kimi.com/coding", contextLimit: 1048576 },
};

const viewIds = ["profile", "jd", "resume", "evaluation", "interview", "chat"];

const MAX_CHAT_MESSAGES = 20;
const CONTEXT_BUDGET_RATIO = 0.9;
const CHAT_KEEP_RECENT = 4;

// 保底预算：达到上下文上限的 90% 就触发摘要压缩，给估算误差留出余量
function getChatTokenBudget(settings = state.settings || {}) {
  const limit = Number(settings.contextLimit) || 8000;
  return Math.floor(limit * CONTEXT_BUDGET_RATIO);
}

function appendChatMessage(message) {
  const withId = { ...message, id: message.id || nextMessageId() };
  state.chatMessages.push(withId);
  state.chatTranscript.push(withId);
  return withId;
}

function archiveMessages(ids) {
  const idSet = new Set(Array.isArray(ids) ? ids : [ids]);
  const moving = state.chatMessages.filter(
    (message) => idSet.has(message.id) && message.role !== "system"
  );
  if (!moving.length) return 0;
  state.chatMessages = state.chatMessages.filter((message) => !idSet.has(message.id));
  for (const message of moving) {
    const { pinned, ...rest } = message;
    state.archivedMessages.push({ ...rest, archivedAt: new Date().toISOString() });
  }
  renderChat();
  renderArchiveList();
  return moving.length;
}

function restoreArchivedMessages(ids) {
  const idSet = ids
    ? new Set(Array.isArray(ids) ? ids : [ids])
    : new Set(state.archivedMessages.map((message) => message.id));
  const movingBack = state.archivedMessages.filter((message) => idSet.has(message.id));
  if (!movingBack.length) return 0;
  state.archivedMessages = state.archivedMessages.filter((message) => !idSet.has(message.id));
  for (const message of movingBack) {
    const { archivedAt, ...rest } = message;
    state.chatMessages.push({
      ...rest,
      id: nextMessageId(),
      content: rest.content.startsWith("【归档恢复】") ? rest.content : `【归档恢复】${rest.content}`,
    });
  }
  renderChat();
  renderArchiveList();
  return movingBack.length;
}

function togglePinMessage(id) {
  const message = state.chatMessages.find((item) => item.id === id);
  if (!message) return;
  message.pinned = !message.pinned;
  renderChat();
}

// 自动归档：活跃层非 system 消息超过保留条数时，最旧的未 pin 消息移入归档层
function autoArchiveOldMessages() {
  const active = state.chatMessages.filter((message) => message.role !== "system");
  const overflow = active.length - AUTO_ARCHIVE_KEEP;
  if (overflow <= 0) return;
  const toArchive = active
    .filter((message) => !message.pinned)
    .slice(0, overflow)
    .map((message) => message.id);
  if (toArchive.length) archiveMessages(toArchive);
}

function createSessionFromText(text) {
  const now = new Date().toISOString();
  state.currentSession = {
    id: `${now.replace(/[:.]/g, "-").slice(0, 19)}-${Math.random().toString(36).slice(2, 6)}`,
    title: String(text || "新会话").replace(/\s+/g, " ").trim().slice(0, 40) || "新会话",
    jobTitle: readJd().jobTitle || "",
    createdAt: now,
  };
}

async function persistSession() {
  if (!state.currentSession) return;
  const summaryMessage = state.chatMessages.find(
    (message) => message.role === "system" && message.content.startsWith("【早前对话纪要】")
  );
  try {
    await window.resumeApp.sessionSave(getUsername(), {
      ...state.currentSession,
      jobTitle: readJd().jobTitle || state.currentSession.jobTitle || "",
      summary: summaryMessage ? summaryMessage.content.replace("【早前对话纪要】\n", "") : "",
      messages: state.chatMessages,
      transcript: state.chatTranscript,
      archivedMessages: state.archivedMessages,
      resumeVersions: state.resumeVersions,
    });
    await refreshSessions();
  } catch (error) {
    setStatus(`会话保存失败：${error.message || String(error)}`);
  }
}

async function refreshSessions() {
  try {
    const sessions = await window.resumeApp.sessionList(getUsername());
    state.sessions = sessions;
    const currentId = state.currentSession && state.currentSession.id;
    $("#sessionSelect").innerHTML =
      `<option value="">选择历史会话…</option>` +
      sessions
        .map(
          (session) =>
            `<option value="${escapeHtml(session.id)}"${session.id === currentId ? " selected" : ""}>` +
            `${escapeHtml(session.title)}（${escapeHtml(String(session.updatedAt || "").slice(0, 10))}）</option>`
        )
        .join("");
  } catch {
    // 用户尚未初始化时静默失败
  }
}

async function openSelectedSession() {
  const id = $("#sessionSelect").value;
  if (!id) {
    setStatus("请先在列表里选择一个会话");
    return;
  }
  const session = await window.resumeApp.sessionLoad(getUsername(), id);
  if (!session) {
    setStatus("会话加载失败");
    return;
  }
  state.currentSession = session;
  state.chatMessages = Array.isArray(session.messages) ? session.messages : [];
  state.chatTranscript = Array.isArray(session.transcript) ? session.transcript : state.chatMessages.slice();
  state.archivedMessages = Array.isArray(session.archivedMessages) ? session.archivedMessages : [];
  state.resumeVersions = Array.isArray(session.resumeVersions) ? session.resumeVersions : [];
  renderChat();
  renderArchiveList();
  setStatus(`已打开会话：${session.title}`);
}

async function deleteSelectedSession() {
  const id = $("#sessionSelect").value;
  if (!id) {
    setStatus("请先在列表里选择一个会话");
    return;
  }
  const session = state.sessions.find((item) => item.id === id);
  const ok = window.confirm(`确定删除会话“${session ? session.title : id}”吗？此操作不可撤销。`);
  if (!ok) return;
  await window.resumeApp.sessionDelete(getUsername(), id);
  if (state.currentSession && state.currentSession.id === id) {
    startNewSession();
  }
  await refreshSessions();
  showToast("会话已删除");
}

function startNewSession() {
  state.chatMessages = [];
  state.chatTranscript = [];
  state.archivedMessages = [];
  state.resumeVersions = [];
  state.currentSession = null;
  $("#sessionSelect").value = "";
  renderChat();
  renderArchiveList();
  setStatus("已开启新会话，首次发送时会注入个人事实层");
}

// 粗略估算 token 数：中文约 1.5 字符/token，上限取保守值
function estimateChatTokens(messages) {
  return messages.reduce((sum, message) => sum + Math.ceil(String(message.content).length / 1.5), 0);
}

function buildChatContextMessage() {
  // 新会话的事实层：个人事实 + 当前岗位 + 当前简历快照
  const profile = readProfileFromForm();
  const jd = readJd();
  const basic = profile.basic || {};
  const lines = [
    "你是 ResumePilot 的简历对话助手。基于候选人资料、目标岗位 JD 和当前简历回答用户问题，并给出具体的简历修改建议。",
    `候选人：${basic.name || "未填写"} / ${basic.school || "未填写学校"} / ${basic.email || ""} ${basic.phone || ""}`,
    `技能：${profile.skills || "未填写"}`,
    `目标岗位：${jd.jobTitle || "未填写"}${jd.source ? `（${jd.source}）` : ""}`,
  ];
  if (jd.jdText) lines.push(`JD 原文：\n${jd.jdText.slice(0, 2000)}`);
  if (state.workflow && state.workflow.resumeMarkdown) {
    lines.push(`当前简历（第 ${state.resumeVersions.length} 版）：\n${state.workflow.resumeMarkdown.slice(0, 3000)}`);
  } else {
    lines.push("当前还没有生成简历，可以先引导用户运行流程或描述经历。");
  }
  return { role: "system", content: lines.join("\n") };
}

function renderChat() {
  const box = $("#chatMessages");
  box.innerHTML = state.chatMessages
    .filter((message) => message.role !== "system")
    .map(
      (message) => `
        <div class="chat-msg ${message.role}${message.pinned ? " pinned" : ""}" data-mid="${escapeHtml(message.id || "")}">
          <span class="chat-role">${message.role === "user" ? "我" : "助手"}${message.pinned ? " 📌已保留" : ""}</span>
          <p>${escapeHtml(message.content).replaceAll("\n", "<br>")}</p>
          <div class="msg-actions">
            <button data-action="pin" title="${message.pinned ? "取消保留" : "保留：不被自动归档"}">${message.pinned ? "📌" : "☆ 保留"}</button>
            <button data-action="archive" title="归档：移出模型上下文，可随时恢复">📦 归档</button>
          </div>
        </div>
      `
    )
    .join("");
  box.scrollTop = box.scrollHeight;
  const visibleCount = state.chatMessages.filter((message) => message.role !== "system").length;
  const compressed = state.chatMessages.some((message) => message.role === "system" && message.content.startsWith("【早前对话纪要】"));
  const sessionLabel = state.currentSession ? ` · 会话：${state.currentSession.title}` : " · 未保存会话";
  $("#chatMeta").textContent =
    `已生成 ${state.resumeVersions.length} 个简历版本 · 对话 ${visibleCount} 条 · 已归档 ${state.archivedMessages.length} 条` +
    (compressed ? " · 早期对话已压缩为摘要" : "") +
    sessionLabel;
  const archiveCount = $("#archiveCount");
  if (archiveCount) archiveCount.textContent = String(state.archivedMessages.length);
}

function renderArchiveList() {
  const list = $("#archiveList");
  if (!list) return;
  const filter = ($("#archiveFilter") && $("#archiveFilter").value.trim().toLowerCase()) || "";
  const filtered = state.archivedMessages.filter(
    (message) => !filter || message.content.toLowerCase().includes(filter)
  );
  if (!filtered.length) {
    list.innerHTML = `<p class="empty-note">${state.archivedMessages.length ? "没有匹配的归档消息" : "暂无归档消息"}</p>`;
  } else {
    list.innerHTML = filtered
      .map(
        (message) => `
          <div class="archive-item" data-mid="${escapeHtml(message.id)}">
            <label class="archive-check">
              <input type="checkbox" data-mid="${escapeHtml(message.id)}" />
            </label>
            <div class="archive-body">
              <span class="chat-role">${message.role === "user" ? "我" : "助手"} · ${escapeHtml(String(message.archivedAt || "").slice(5, 16).replace("T", " "))}</span>
              <p>${escapeHtml(message.content.slice(0, 80))}${message.content.length > 80 ? "…" : ""}</p>
            </div>
            <button data-action="restore" data-mid="${escapeHtml(message.id)}">恢复</button>
          </div>
        `
      )
      .join("");
  }
  const archiveCount = $("#archiveCount");
  if (archiveCount) archiveCount.textContent = String(state.archivedMessages.length);
}

function handleChatMessageAction(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const container = event.target.closest("[data-mid]");
  const id = container && container.dataset.mid;
  if (!id) return;
  if (button.dataset.action === "pin") togglePinMessage(id);
  if (button.dataset.action === "archive") {
    archiveMessages([id]);
    showToast("已归档，模型将不再看到这条消息");
  }
}

async function maybeCompactChatHistory() {
  const budget = getChatTokenBudget();
  const overCount = state.chatMessages.length > MAX_CHAT_MESSAGES;
  const overTokens = estimateChatTokens(state.chatMessages) > budget;
  if (!overCount && !overTokens) return;
  const recent = state.chatMessages.slice(-CHAT_KEEP_RECENT);
  const oldMessages = state.chatMessages.slice(0, -CHAT_KEEP_RECENT);
  setStatus(
    overTokens
      ? `上下文已接近上限（估算 ${estimateChatTokens(state.chatMessages)} / 预算 ${budget} tokens），正在压缩为摘要...`
      : "对话历史较长，正在压缩为摘要..."
  );
  const { reply } = await window.resumeApp.chatSend(
    [
      {
        role: "system",
        content:
          "你是对话纪要助手。请把下面的多轮对话压缩成不超过 300 字的中文纪要，保留：用户明确要求修改的内容、未完成的待办、已确认的结论。不要添加新内容。",
      },
      {
        role: "user",
        content: oldMessages.map((message) => `${message.role === "user" ? "用户" : "助手"}：${message.content}`).join("\n\n"),
      },
    ],
    readSettingsFromForm()
  );
  // 保留事实层等 system 消息（不含旧纪要），只替换对话历史
  const keptSystemMessages = state.chatMessages.filter(
    (message) => message.role === "system" && !message.content.startsWith("【早前对话纪要】")
  );
  state.chatMessages = [
    ...keptSystemMessages,
    { role: "system", content: `【早前对话纪要】\n${reply}` },
    ...recent,
  ];
  showToast("对话历史已压缩为摘要");
  await persistSession();
}

async function sendChatMessage() {
  const input = $("#chatInput");
  const text = input.value.trim();
  if (!text) return;
  const settings = readSettingsFromForm();
  input.value = "";
  if (!state.chatMessages.length) {
    appendChatMessage(buildChatContextMessage());
  }
  appendChatMessage({ role: "user", content: text });
  if (!state.currentSession) {
    createSessionFromText(text);
  }
  renderChat();
  setStatus("助手正在回复...");
  $("#sendChatBtn").disabled = true;
  try {
    await maybeCompactChatHistory();
    const { reply } = await window.resumeApp.chatSend(state.chatMessages, settings);
    appendChatMessage({ role: "assistant", content: reply });
    renderChat();
    setStatus("回复完成");
    autoArchiveOldMessages();
    await persistSession();
  } catch (error) {
    setStatus(`对话失败：${error.message || String(error)}`);
    showToast("对话请求失败", "error");
  } finally {
    $("#sendChatBtn").disabled = false;
  }
}

const defaultPreferences = {
  defaultStartView: "profile",
  toastSeconds: 3,
  autoOpenResumeAfterRun: true,
  compactUi: false,
};
let toastTimer;

function calculateAge(birthday) {
  if (!birthday) return "";
  const birthDate = new Date(`${birthday}T00:00:00`);
  if (Number.isNaN(birthDate.getTime())) return "";
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDelta = today.getMonth() - birthDate.getMonth();
  const dayDelta = today.getDate() - birthDate.getDate();
  if (monthDelta < 0 || (monthDelta === 0 && dayDelta < 0)) age -= 1;
  return age >= 0 ? String(age) : "";
}

function syncAgeFromBirthday() {
  $("#age").value = calculateAge($("#birthday").value);
}

function setStatus(message) {
  $("#statusBar").textContent = message;
}

function getPreferences(settings = state.settings || {}) {
  const preferences = { ...defaultPreferences, ...(settings.preferences || {}) };
  preferences.defaultStartView = viewIds.includes(preferences.defaultStartView)
    ? preferences.defaultStartView
    : defaultPreferences.defaultStartView;
  preferences.toastSeconds = Math.min(8, Math.max(1, Number(preferences.toastSeconds) || defaultPreferences.toastSeconds));
  preferences.autoOpenResumeAfterRun = preferences.autoOpenResumeAfterRun !== false;
  preferences.compactUi = preferences.compactUi === true;
  return preferences;
}

function applyPreferences(settings = state.settings || {}) {
  document.body.classList.toggle("compact-ui", getPreferences(settings).compactUi);
}

function showToast(message, type = "success") {
  const stack = $("#toastStack");
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span class="toast-dot" aria-hidden="true"></span>
    <div>
      <strong>${escapeHtml(message)}</strong>
    </div>
  `;
  stack.innerHTML = "";
  stack.appendChild(toast);
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast.classList.add("leaving");
    window.setTimeout(() => toast.remove(), 180);
  }, getPreferences().toastSeconds * 1000);
}

function setWorkflowLoading(isLoading, title = "Agent 正在整理材料", detail = "正在生成简历、评分和模拟面试问题") {
  $("#workflowOverlayTitle").textContent = title;
  $("#workflowOverlayDetail").textContent = detail;
  $("#workflowOverlay").classList.toggle("active", isLoading);
  $("#workflowOverlay").setAttribute("aria-hidden", String(!isLoading));
  $("#runWorkflowBtn").disabled = isLoading;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function setBackendBadge(settings) {
  const providerLabel = settings.provider || "默认 provider";
  const modelLabel = settings.model || "默认模型";
  $("#backendBadge").textContent = "LLM";
  $("#agentSummary").textContent = `${providerLabel} / ${modelLabel}`;
  $("#backendStatus").textContent =
    `LLM API 工作流 / ${providerLabel} / ${modelLabel}，skills ${settings.skillInjection ? "已注入" : "未注入"}`;
}

function openSettings() {
  $("#settingsModal").classList.add("active");
  $("#settingsModal").setAttribute("aria-hidden", "false");
  $("#provider").focus();
}

function closeSettings() {
  $("#settingsModal").classList.remove("active");
  $("#settingsModal").setAttribute("aria-hidden", "true");
}

function switchView(id) {
  $$(".view").forEach((view) => view.classList.toggle("active", view.id === id));
  $$(".step-btn").forEach((button) => button.classList.toggle("active", button.dataset.step === id));
  $("#screenTitle").textContent = document.querySelector(`[data-step="${id}"]`).textContent;
}

function getUsername() {
  return $("#username").value.trim() || "default_user";
}

function ensureProfile() {
  if (!state.profile) {
    state.profile = {
      basic: {},
      education: [],
      experiences: [],
      projects: [],
      competitions: [],
      papers: [],
      skills: "",
      selfSummary: "",
    };
  }
  return state.profile;
}

function updatePhotoPreview(dataUrl = "") {
  const preview = $("#photoPreview");
  preview.innerHTML = "";
  if (dataUrl) {
    const image = document.createElement("img");
    image.src = dataUrl;
    image.alt = "个人证件照预览";
    preview.appendChild(image);
    preview.classList.add("has-photo");
  } else {
    preview.textContent = "证件照";
    preview.classList.remove("has-photo");
  }
}

function readTimelineItems(selector, options = {}) {
  return $$(selector)
    .map((item) => {
      const startDate = item.querySelector("[data-field='startDate']").value.trim();
      const endDate = item.querySelector("[data-field='endDate']").value.trim();
      const value = {
        title: item.querySelector("[data-field='title']").value.trim(),
        startDate,
        endDate,
        period: [startDate, endDate].filter(Boolean).join(" - "),
        description: item.querySelector("[data-field='description']").value.trim(),
      };
      if (options.includeRole) {
        value.role = item.querySelector("[data-field='role']").value.trim();
      }
      return value;
    })
    .filter((item) => item.title || item.role || item.description);
}

function readPaperItems() {
  return $$("#paperList .paper-item")
    .map((item) => ({
      title: item.querySelector("[data-field='title']").value.trim(),
      description: item.querySelector("[data-field='description']").value.trim(),
    }))
    .filter((item) => item.title || item.description);
}

function readEducationItems() {
  return $$("#educationList .education-item")
    .map((item) => {
      const value = {};
      for (const field of educationFields) {
        value[field] = item.querySelector(`[data-field='${field}']`).value.trim();
      }
      value.school = value.schoolName;
      value.period = [value.startDate, value.endDate].filter(Boolean).join(" - ");
      return value;
    })
    .filter((item) => item.schoolName || item.degree || item.major || item.startDate || item.endDate);
}

function readProfileFromForm() {
  const profile = ensureProfile();
  profile.basic = profile.basic || {};
  for (const id of basicIds) profile.basic[id] = $(`#${id}`).value.trim();
  profile.basic.age = calculateAge(profile.basic.birthday);
  profile.basic.photoDataUrl = profile.basic.photoDataUrl || "";
  profile.skills = $("#skills").value.trim();
  profile.selfSummary = $("#selfSummary").value.trim();
  profile.education = readEducationItems();
  profile.experiences = [];
  profile.projects = [];
  profile.competitions = [];
  profile.papers = [];
  profile.experiences = readTimelineItems("#experienceList .timeline-item", { includeRole: true });
  profile.projects = readTimelineItems("#projectList .timeline-item");
  profile.papers = readPaperItems();

  return profile;
}

function splitPeriod(period = "") {
  const normalized = String(period || "").trim();
  if (!normalized) return ["", ""];
  const parts = normalized.split(/\s+(?:-|—|–|至|到)\s+/).map((part) => part.trim());
  return parts.length >= 2 ? [parts[0], parts.slice(1).join(" - ")] : [normalized, ""];
}

function normalizeExperienceForForm(value = {}) {
  const [periodStart, periodEnd] = splitPeriod(value.period);
  const descriptionParts = [value.description];
  if (value.achievements) descriptionParts.push(`成果/补充：${value.achievements}`);
  if (value.skills) descriptionParts.push(`相关技能：${value.skills}`);
  if (value.organization) descriptionParts.push(`组织：${value.organization}`);

  return {
    title: value.title || "",
    role: value.role || value.position || "",
    startDate: value.startDate || periodStart,
    endDate: value.endDate || periodEnd,
    description: descriptionParts.filter(Boolean).join("\n"),
  };
}

function writeProfileToForm(profile) {
  state.profile = profile;
  const basic = profile.basic || {};
  for (const id of basicIds) $(`#${id}`).value = basic[id] || "";
  $("#age").value = calculateAge(basic.birthday || "") || basic.age || "";
  $("#skills").value = profile.skills || "";
  $("#selfSummary").value = profile.selfSummary || "";
  $("#experienceList").innerHTML = "";
  $("#educationList").innerHTML = "";
  $("#projectList").innerHTML = "";
  $("#paperList").innerHTML = "";
  updatePhotoPreview(basic.photoDataUrl || "");

  const experienceItems = (profile.experiences || []).map(normalizeExperienceForForm);
  const educationItems = (profile.education || []).map((item) => ({
    schoolName: item.schoolName || item.school || "",
    degree: item.degree || "",
    startDate: item.startDate || splitPeriod(item.period)[0],
    endDate: item.endDate || splitPeriod(item.period)[1],
    major: item.major || "",
  }));
  const projectItems = [...(profile.projects || []), ...(profile.competitions || [])].map(normalizeExperienceForForm);
  const paperItems = (profile.papers || []).map((item) => ({
    title: item.title || item.name || "",
    description: item.description || item.summary || item.introduction || "",
  }));

  if (educationItems.length) educationItems.forEach(addEducationItem);
  else addEducationItem();
  if (experienceItems.length) {
    experienceItems.forEach((item) => addTimelineItem("#experienceList", item, "工作内容", { includeRole: true }));
  }
  else addExperienceItem();
  if (projectItems.length) projectItems.forEach((item) => addTimelineItem("#projectList", item, "工作内容"));
  else addProjectItem();
  if (paperItems.length) paperItems.forEach(addPaperItem);
  else addPaperItem();
}

function addEducationItem(value = {}) {
  const container = document.createElement("div");
  container.className = "experience-item education-item";
  container.innerHTML = `
    <div class="education-row">
      <label class="field"><span>学校名称</span><input data-field="schoolName" /></label>
      <label class="field"><span>学历</span><input data-field="degree" placeholder="本科 / 硕士 / 博士" /></label>
      <label class="field"><span>开始时间</span><input data-field="startDate" placeholder="2021-09" /></label>
      <label class="field"><span>结束时间</span><input data-field="endDate" placeholder="2025-06 / 至今" /></label>
      <label class="field"><span>专业</span><input data-field="major" /></label>
      <button class="icon-btn" data-action="remove" title="删除">×</button>
    </div>
  `;
  for (const [key, fieldValue] of Object.entries(value)) {
    const input = container.querySelector(`[data-field='${key}']`);
    if (input) input.value = fieldValue || "";
  }
  container.querySelector("[data-action='remove']").addEventListener("click", () => container.remove());
  $("#educationList").appendChild(container);
}

function addTimelineItem(listSelector, value = {}, contentLabel = "工作内容", options = {}) {
  const container = document.createElement("div");
  container.className = "experience-item timeline-item";
  const roleField = options.includeRole
    ? '<label class="field"><span>岗位</span><input data-field="role" /></label>'
    : "";
  container.innerHTML = `
    <div class="experience-row">
      <label class="field"><span>名称</span><input data-field="title" /></label>
      ${roleField}
      <label class="field"><span>开始时间</span><input data-field="startDate" placeholder="2024-06" /></label>
      <label class="field"><span>结束时间</span><input data-field="endDate" placeholder="2025-09 / 至今" /></label>
      <button class="icon-btn" data-action="remove" title="删除">×</button>
    </div>
    <label class="field"><span>${contentLabel}</span><textarea data-field="description" rows="3"></textarea></label>
  `;
  for (const [key, fieldValue] of Object.entries(value)) {
    const input = container.querySelector(`[data-field='${key}']`);
    if (input) input.value = fieldValue || "";
  }
  container.querySelector("[data-action='remove']").addEventListener("click", () => container.remove());
  $(listSelector).appendChild(container);
}

function addExperienceItem(value = {}) {
  addTimelineItem("#experienceList", value, "工作内容", { includeRole: true });
}

function addProjectItem(value = {}) {
  addTimelineItem("#projectList", value, "工作内容");
}

function addPaperItem(value = {}) {
  const container = document.createElement("div");
  container.className = "experience-item paper-item";
  container.innerHTML = `
    <div class="paper-row">
      <label class="field"><span>名称</span><input data-field="title" /></label>
      <button class="icon-btn" data-action="remove" title="删除">×</button>
    </div>
    <label class="field"><span>简介</span><textarea data-field="description" rows="3"></textarea></label>
  `;
  for (const [key, fieldValue] of Object.entries(value)) {
    const input = container.querySelector(`[data-field='${key}']`);
    if (input) input.value = fieldValue || "";
  }
  container.querySelector("[data-action='remove']").addEventListener("click", () => container.remove());
  $("#paperList").appendChild(container);
}

function readJd() {
  return {
    jobTitle: $("#jobTitle").value.trim(),
    source: $("#jobSource").value.trim(),
    jdText: $("#jdText").value.trim(),
    difficulty: $("#interviewDifficulty").value,
  };
}

function readSettingsFromForm() {
  return {
    backendMode: $("#backendMode").value,
    provider: $("#provider").value,
    model: $("#modelName").value.trim(),
    baseUrl: $("#baseUrl").value.trim(),
    apiKey: $("#apiKey").value.trim(),
    skillInjection: $("#skillInjection").checked,
    timeoutSeconds: Number($("#timeoutSeconds").value) || 120,
    contextLimit: Number($("#contextLimit").value) || 0,
    preferences: {
      defaultStartView: $("#defaultStartView").value,
      toastSeconds: Number($("#toastSeconds").value) || defaultPreferences.toastSeconds,
      autoOpenResumeAfterRun: $("#autoOpenResumeAfterRun").checked,
      compactUi: $("#compactUi").checked,
    },
  };
}

function writeSettingsToForm(settings) {
  state.settings = settings;
  const preferences = getPreferences(settings);
  $("#backendMode").value = settings.backendMode || "llm";
  const providerValues = [...$("#provider").options].map((option) => option.value);
  $("#provider").value = providerValues.includes(settings.provider) ? settings.provider : "deepseek";
  $("#modelName").value = settings.model || "";
  $("#baseUrl").value = settings.baseUrl || "";
  $("#apiKey").value = settings.apiKey || "";
  $("#timeoutSeconds").value = settings.timeoutSeconds || 120;
  $("#contextLimit").value = settings.contextLimit || "";
  $("#skillInjection").checked = settings.skillInjection !== false;
  $("#defaultStartView").value = preferences.defaultStartView;
  $("#toastSeconds").value = preferences.toastSeconds;
  $("#autoOpenResumeAfterRun").checked = preferences.autoOpenResumeAfterRun;
  $("#compactUi").checked = preferences.compactUi;
  applyPreferences(settings);
  setBackendBadge(readSettingsFromForm());
}

function applyProviderDefaults() {
  const defaults = providerDefaults[$("#provider").value];
  if (!defaults) return;
  if (!$("#modelName").value.trim()) $("#modelName").value = defaults.model;
  if (!$("#baseUrl").value.trim()) $("#baseUrl").value = defaults.baseUrl;
  if (!$("#contextLimit").value.trim()) $("#contextLimit").value = defaults.contextLimit || "";
  setBackendBadge(readSettingsFromForm());
}

function renderWorkflow(result) {
  state.workflow = result;
  $("#resumeOutput").textContent = result.resumeMarkdown || "";
  $("#scoreNumber").textContent = result.evaluation.score;
  $("#keywordCoverage").textContent = `命中关键词：${result.evaluation.matchedKeywords.join(", ") || "暂无"}`;
  $("#suggestions").innerHTML = result.evaluation.suggestions.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  $("#missingKeywords").innerHTML = result.evaluation.missingKeywords
    .map((item) => `<span class="chip">${escapeHtml(item)}</span>`)
    .join("");
  $("#questionList").innerHTML = result.interview.questions
    .map(
      (item) => `
        <li>
          <div class="question-text">${escapeHtml(item.question || item)}</div>
          <details class="answer-panel">
            <summary>参考答案</summary>
            <p>${escapeHtml(item.referenceAnswer || "建议结合简历中最相关的经历，用 STAR 结构回答。")}</p>
          </details>
        </li>
      `
    )
    .join("");
  $("#interviewTips").innerHTML = `<h4>答题提示</h4><ul>${result.interview.tips
    .map((tip) => `<li>${escapeHtml(tip)}</li>`)
    .join("")}</ul>`;
  if (result.backend) {
    $("#backendStatus").textContent = `本次运行：${result.backend.mode}${result.backend.model ? ` / ${result.backend.model}` : ""}`;
  }
  if (result.review) {
    const review = result.review;
    const reviewLabel =
      `审核 ${review.score}/100` +
      (review.attempts && review.attempts.length > 1 ? ` · 第 ${review.attempts.length} 次生成通过` : "") +
      (review.circuitBroken ? ` · ⚠️ 已熔断，展示历史最高分的版本（${review.bestScore}/100）` : "");
    $("#backendStatus").textContent += ` / ${reviewLabel}`;
    renderReviewCard(review);
  } else {
    $("#reviewCard").hidden = true;
  }
}

function renderReviewCard(review) {
  const card = $("#reviewCard");
  card.hidden = false;
  const verdict = $("#reviewVerdict");
  if (review.reviewError) {
    verdict.textContent = "⚠️ 审核调用失败，本次未实际审核";
    verdict.className = "review-verdict bad";
  } else if (review.circuitBroken) {
    verdict.textContent = `⚠️ 已熔断 · 历史最高分 ${review.bestScore}/100`;
    verdict.className = "review-verdict bad";
  } else {
    verdict.textContent = `${review.score}/100 通过` + (review.fabrication ? " · 发现编造" : "");
    verdict.className = review.fabrication ? "review-verdict bad" : "review-verdict good";
  }
  const passScore = Number(review.passScore) || 60;
  $("#reviewAttempts").innerHTML = (review.attempts || [])
    .map(
      (attempt) => `
        <li>
          <div class="attempt-head">
            <strong>第 ${attempt.attempt} 次生成：${attempt.score}/100</strong>
            <span class="attempt-status ${attempt.score >= passScore ? "pass" : "fail"}">
              ${attempt.score >= passScore ? "通过" : "打回"}
            </span>
          </div>
          <p>${escapeHtml(attempt.comment || "（无评语）")}</p>
        </li>
      `
    )
    .join("");
  $("#reviewSummary").textContent = review.comment ? `审核员评语：${review.comment}` : "";
}

async function refreshUsers() {
  const users = await window.resumeApp.listUsers();
  $("#userSelect").innerHTML =
    `<option value="">选择用户</option>` + users.map((user) => `<option value="${user}">${user}</option>`).join("");
  state.managedUsers = users;
  renderManagedUsers(users);
}

async function loadUser(username = getUsername()) {
  $("#username").value = username;
  const profile = await window.resumeApp.loadUser(username);
  writeProfileToForm(profile);
  startNewSession();
  await refreshSessions();
  setStatus(`Loaded ${username}`);
}

async function saveProfile() {
  const username = getUsername();
  const profile = readProfileFromForm();
  await window.resumeApp.saveUser(username, profile);
  await refreshUsers();
  setStatus(`Saved ${username}`);
  showToast("保存成功");
}

async function saveSettings() {
  const settings = readSettingsFromForm();
  await window.resumeApp.saveSettings(settings);
  state.settings = settings;
  applyPreferences(settings);
  setBackendBadge(settings);
  setStatus("Agent 设置已保存");
  showToast("设置已保存");
}

async function renderSkillList() {
  const skills = await window.resumeApp.listSkills();
  const agentNames = [...new Set(skills.flatMap((skill) => skill.agents))];
  $("#skillList").innerHTML = agentNames
    .map(
      (agentName) => `
        <section class="skill-agent-group">
          <h4>${agentName}</h4>
          ${skills
            .filter((skill) => skill.agents.includes(agentName))
            .map(
              (skill) => `
                <article class="skill-item">
                  <div>
                    <strong>${skill.name}</strong>
                    <span>${skill.available ? "已安装" : "未找到"}</span>
                  </div>
                  <p>${skill.purpose}</p>
                </article>
              `
            )
            .join("")}
        </section>
      `
    )
    .join("");
}

function renderManagedUsers(users = state.managedUsers || []) {
  const list = $("#managedUserList");
  if (!list) return;
  if (!users.length) {
    list.innerHTML = `<p class="empty-note">还没有保存过的用户。</p>`;
    return;
  }
  list.innerHTML = users
    .map(
      (user) => `
        <article class="managed-user-item">
          <div>
            <strong>${escapeHtml(user)}</strong>
            <span>本地资料库</span>
          </div>
          <div class="managed-user-actions">
            <button data-action="load-user" data-user="${escapeHtml(user)}">加载</button>
            <button class="danger" data-action="delete-user" data-user="${escapeHtml(user)}">删除</button>
          </div>
        </article>
      `
    )
    .join("");
}

async function refreshManagedUsers() {
  await refreshUsers();
  showToast("用户列表已刷新");
}

async function handleManagedUserAction(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const username = button.dataset.user || "";
  if (!username) return;
  if (button.dataset.action === "load-user") {
    await loadUser(username);
    closeSettings();
    showToast(`已加载用户：${username}`);
    return;
  }
  if (button.dataset.action === "delete-user") {
    const ok = window.confirm(`确定删除用户“${username}”及其本地资料和导出文件吗？此操作不可撤销。`);
    if (!ok) return;
    await window.resumeApp.deleteUser(username);
    if (getUsername() === username) {
      writeProfileToForm(await window.resumeApp.createEmptyProfile());
      $("#username").value = "";
    }
    await refreshUsers();
    showToast(`已删除用户：${username}`);
  }
}

async function testModelConnection() {
  const settings = readSettingsFromForm();
  await window.resumeApp.saveSettings(settings);
  state.settings = settings;
  setBackendBadge(settings);
  setStatus("正在测试模型连接...");
  $("#testModelBtn").disabled = true;
  setWorkflowLoading(true, "正在测试模型连接", "正在向当前 Provider 发送一次轻量请求");
  try {
    const result = await window.resumeApp.testModel(settings);
    $("#backendStatus").textContent = result.message;
    setStatus(result.ok ? result.message : `模型测试失败：${result.message}`);
    showToast(result.ok ? "模型连接正常" : "模型测试失败", result.ok ? "success" : "error");
  } catch (error) {
    const message = error.message || String(error);
    $("#backendStatus").textContent = message;
    setStatus(`模型测试失败：${message}`);
    showToast("模型测试失败", "error");
  } finally {
    $("#testModelBtn").disabled = false;
    setWorkflowLoading(false);
  }
}

async function runWorkflow() {
  const username = getUsername();
  const profile = readProfileFromForm();
  const jd = readJd();
  if (!jd.jdText) {
    switchView("jd");
    setStatus("请先粘贴岗位 JD");
    return;
  }
  const settings = readSettingsFromForm();
  await window.resumeApp.saveSettings(settings);
  state.settings = settings;
  applyPreferences(settings);
  setBackendBadge(settings);
  setStatus("正在运行 LLM 工作流...");
  setWorkflowLoading(true, "Agent 正在整理材料", "正在生成简历、评分和模拟面试问题");
  try {
    const result = await window.resumeApp.runWorkflow(username, profile, jd, settings);
    renderWorkflow(result);
    state.resumeVersions.push({
      at: new Date().toISOString(),
      source: "workflow",
      resumeMarkdown: result.resumeMarkdown,
      evaluation: result.evaluation,
      interview: result.interview,
    });
    appendChatMessage({
      role: "assistant",
      content: `已根据岗位「${jd.jobTitle || "未命名岗位"}」生成第 ${state.resumeVersions.length} 版简历` +
        `（评分 ${result.evaluation.score}/100）。可以继续在对话里提修改要求。`,
    });
    renderChat();
    await persistSession();
    await refreshUsers();
    setStatus(`Session saved: ${result.artifactPath}`);
    if (result.review && result.review.reviewError) {
      showToast("⚠️ 审核调用失败，结果未判定", "error");
    } else if (result.review && result.review.circuitBroken) {
      showToast(`⚠️ 审核连续 ${result.review.attempts.length} 次未达 60 分已熔断，展示最高分版本（${result.review.bestScore}/100）`, "error");
    } else if (result.review && result.review.attempts && result.review.attempts.length > 1) {
      showToast(`流程运行完成 · 审核 ${result.review.score}/100（第 ${result.review.attempts.length} 次通过）`);
    } else {
      showToast("流程运行完成");
    }
    if (getPreferences(settings).autoOpenResumeAfterRun) switchView("resume");
  } catch (error) {
    const message = error.message || String(error);
    $("#backendStatus").textContent = message;
    setStatus(`工作流运行失败：${message}`);
    showToast("工作流运行失败", "error");
  } finally {
    setWorkflowLoading(false);
  }
}

async function exportContent(kind, content, extension = "md") {
  if (!content) {
    setStatus("没有可导出的内容");
    return;
  }
  const filePath = await window.resumeApp.saveArtifact(getUsername(), kind, content, extension);
  setStatus(`Exported: ${filePath}`);
}

async function exportResumePdf() {
  const resumeMarkdown = state.workflow && state.workflow.resumeMarkdown;
  if (!resumeMarkdown) {
    setStatus("没有可导出的简历内容");
    return;
  }
  $("#exportResumePdfBtn").disabled = true;
  setStatus("正在生成 PDF...");
  try {
    const filePath = await window.resumeApp.saveResumePdf(
      getUsername(),
      resumeMarkdown,
      readProfileFromForm(),
      readJd()
    );
    setStatus(`PDF 已导出：${filePath}`);
  } catch (error) {
    setStatus(`PDF 导出失败：${error.message || String(error)}`);
  } finally {
    $("#exportResumePdfBtn").disabled = false;
  }
}

function handlePhotoUpload(event) {
  const profile = ensureProfile();
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
    setStatus("请选择 PNG、JPG 或 WebP 图片");
    event.target.value = "";
    return;
  }
  if (file.size > 2 * 1024 * 1024) {
    setStatus("证件照不能超过 2MB");
    event.target.value = "";
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    profile.basic = profile.basic || {};
    profile.basic.photoDataUrl = String(reader.result || "");
    updatePhotoPreview(profile.basic.photoDataUrl);
    setStatus("证件照已添加，保存资料后会进入用户资料库");
  };
  reader.onerror = () => setStatus("证件照读取失败，请重新选择图片");
  reader.readAsDataURL(file);
}

function removePhoto() {
  const profile = ensureProfile();
  profile.basic = profile.basic || {};
  profile.basic.photoDataUrl = "";
  $("#photoInput").value = "";
  updatePhotoPreview("");
  setStatus("证件照已移除");
}

async function init() {
  const meta = await window.resumeApp.getMeta();
  $("#dataRoot").textContent = meta.dataRoot;
  writeSettingsToForm(await window.resumeApp.loadSettings());
  await renderSkillList();
  await refreshUsers();
  writeProfileToForm(await window.resumeApp.createEmptyProfile());
  switchView(getPreferences().defaultStartView);

  $$(".step-btn").forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.step));
  });
  $("#userSelect").addEventListener("change", (event) => {
    if (event.target.value) loadUser(event.target.value);
  });
  $("#loadUserBtn").addEventListener("click", () => loadUser());
  $("#newProfileBtn").addEventListener("click", async () => {
    state.workflow = null;
    startNewSession();
    writeProfileToForm(await window.resumeApp.createEmptyProfile());
    setStatus("New profile");
  });
  $("#saveProfileBtn").addEventListener("click", saveProfile);
  $("#saveSettingsBtn").addEventListener("click", saveSettings);
  $("#testModelBtn").addEventListener("click", testModelConnection);
  $("#openSettingsBtn").addEventListener("click", openSettings);
  $("#openSettingsTopBtn").addEventListener("click", openSettings);
  $("#closeSettingsBtn").addEventListener("click", closeSettings);
  $("#refreshSkillsBtn").addEventListener("click", renderSkillList);
  $("#refreshManagedUsersBtn").addEventListener("click", refreshManagedUsers);
  $("#managedUserList").addEventListener("click", handleManagedUserAction);
  $("#settingsModal").addEventListener("click", (event) => {
    if (event.target.id === "settingsModal") closeSettings();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && $("#settingsModal").classList.contains("active")) closeSettings();
  });
  $("#provider").addEventListener("change", applyProviderDefaults);
  [
    "backendMode",
    "provider",
    "modelName",
    "baseUrl",
    "apiKey",
    "timeoutSeconds",
    "contextLimit",
    "skillInjection",
    "defaultStartView",
    "toastSeconds",
    "autoOpenResumeAfterRun",
    "compactUi",
  ].forEach((id) => {
    $(`#${id}`).addEventListener("change", () => setBackendBadge(readSettingsFromForm()));
    $(`#${id}`).addEventListener("input", () => setBackendBadge(readSettingsFromForm()));
  });
  $("#runWorkflowBtn").addEventListener("click", runWorkflow);
  $("#sendChatBtn").addEventListener("click", sendChatMessage);
  $("#clearChatBtn").addEventListener("click", startNewSession);
  $("#openSessionBtn").addEventListener("click", openSelectedSession);
  $("#deleteSessionBtn").addEventListener("click", deleteSelectedSession);
  $("#newSessionBtn").addEventListener("click", startNewSession);
  $("#chatInput").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendChatMessage();
    }
  });
  $("#chatMessages").addEventListener("click", handleChatMessageAction);
  $("#archiveFilter").addEventListener("input", renderArchiveList);
  $("#archiveList").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action='restore']");
    if (!button) return;
    restoreArchivedMessages([button.dataset.mid]);
    showToast("已恢复到对话，模型重新可见");
  });
  $("#restoreSelectedBtn").addEventListener("click", () => {
    const ids = $$("#archiveList input[type='checkbox']:checked").map((box) => box.dataset.mid);
    if (!ids.length) {
      setStatus("请先勾选要恢复的归档消息");
      return;
    }
    restoreArchivedMessages(ids);
    showToast(`已恢复 ${ids.length} 条消息`);
  });
  $("#restoreAllBtn").addEventListener("click", () => {
    if (!state.archivedMessages.length) {
      setStatus("归档层是空的");
      return;
    }
    restoreArchivedMessages(null);
    showToast("已恢复全部归档消息");
  });
  $("#birthday").addEventListener("change", syncAgeFromBirthday);
  $("#birthday").addEventListener("input", syncAgeFromBirthday);
  $("#photoInput").addEventListener("change", handlePhotoUpload);
  $("#removePhotoBtn").addEventListener("click", removePhoto);
  $("#addEducationBtn").addEventListener("click", () => addEducationItem());
  $("#addExperienceBtn").addEventListener("click", () => addExperienceItem());
  $("#addProjectBtn").addEventListener("click", () => addProjectItem());
  $("#addPaperBtn").addEventListener("click", () => addPaperItem());
  $("#exportResumeBtn").addEventListener("click", () =>
    exportContent("tailored-resume", state.workflow && state.workflow.resumeMarkdown)
  );
  $("#exportResumePdfBtn").addEventListener("click", exportResumePdf);
  $("#exportInterviewBtn").addEventListener("click", () =>
    exportContent(
      "mock-interview",
      state.workflow && state.workflow.interview.questions
        .map((q, i) => `${i + 1}. ${q.question || q}\n参考答案：${q.referenceAnswer || ""}`)
        .join("\n\n")
    )
  );
}

init().catch((error) => {
  console.error(error);
  setStatus(error.message || String(error));
});
