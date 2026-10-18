const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const state = {
  profile: null,
  workflow: null,
  settings: null,
  managedUsers: [],
};

const basicIds = ["name", "school", "email", "birthday", "idNumber", "phone", "location"];
const educationFields = ["schoolName", "degree", "startDate", "endDate", "major"];

const providerDefaults = {
  deepseek: { model: "deepseek-chat", baseUrl: "https://api.deepseek.com/v1" },
  openai: { model: "gpt-4o-mini", baseUrl: "https://api.openai.com/v1" },
  openrouter: { model: "deepseek/deepseek-chat", baseUrl: "https://openrouter.ai/api/v1" },
  ollama: { model: "llama3.1", baseUrl: "http://localhost:11434" },
  lmstudio: { model: "local-model", baseUrl: "http://localhost:1234/v1" },
};

const viewIds = ["profile", "jd", "resume", "evaluation", "interview"];
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
    await refreshUsers();
    setStatus(`Session saved: ${result.artifactPath}`);
    showToast("流程运行完成");
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
