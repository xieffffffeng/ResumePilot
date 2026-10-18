const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildResumePdfHtml,
  escapeHtml,
  markdownToHtml,
  prepareResumeMarkdownForPdf,
} = require("../src/services/resume-pdf");

test("escapeHtml escapes unsafe characters", () => {
  assert.equal(escapeHtml(`<script>alert("x")</script>`), "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
});

test("markdownToHtml renders headings and bullets", () => {
  const html = markdownToHtml(`# Alice\n\n## 项目\n- 负责 React 开发\n- **性能优化**`);

  assert.match(html, /<h1>Alice<\/h1>/);
  assert.match(html, /<h2>项目<\/h2>/);
  assert.match(html, /<li>负责 React 开发<\/li>/);
  assert.match(html, /<strong>性能优化<\/strong>/);
});

test("buildResumePdfHtml includes profile contact and target role", () => {
  const html = buildResumePdfHtml({
    resumeMarkdown: "## 经历\n- React 项目",
    profile: { basic: { name: "Alice", email: "a@example.com", phone: "123", school: "Example University" } },
    jd: { jobTitle: "前端工程师" },
  });

  assert.match(html, /Alice/);
  assert.match(html, /a@example\.com · 123/);
  assert.doesNotMatch(html, /a@example\.com · 123 · Example University/);
  assert.match(html, /求职目标：前端工程师/);
  assert.match(html, /@page \{ size: A4/);
});

test("buildResumePdfHtml renders certificate photo when available", () => {
  const photo = "data:image/png;base64,iVBORw0KGgo=";
  const html = buildResumePdfHtml({
    resumeMarkdown: "## 教育背景\n- Example University",
    profile: { basic: { name: "Alice", photoDataUrl: photo } },
    jd: {},
  });

  assert.match(html, /class="portrait"/);
  assert.match(html, new RegExp(photo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("prepareResumeMarkdownForPdf removes duplicate name and contact block", () => {
  const cleaned = prepareResumeMarkdownForPdf(
    "# Alice\nalice@example.com | 123 | Example University\n\n## 教育背景\n- Example University",
    { name: "Alice", email: "alice@example.com", phone: "123" }
  );

  assert.equal(cleaned, "## 教育背景\n- Example University");
});

test("buildResumePdfHtml avoids duplicate header identity", () => {
  const html = buildResumePdfHtml({
    resumeMarkdown: "# Alice\nalice@example.com | 123 | Example University\n\n## 教育背景\n- Example University",
    profile: { basic: { name: "Alice", email: "alice@example.com", phone: "123", school: "Example University" } },
    jd: {},
  });

  assert.equal((html.match(/Alice/g) || []).length, 1);
  assert.equal((html.match(/Example University/g) || []).length, 1);
});
