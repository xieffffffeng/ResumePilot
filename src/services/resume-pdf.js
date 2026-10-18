function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function inlineMarkdown(value) {
  return escapeHtml(value)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>");
}

function markdownToHtml(markdown) {
  const lines = String(markdown || "").split(/\r?\n/);
  const html = [];
  let listOpen = false;

  function closeList() {
    if (listOpen) {
      html.push("</ul>");
      listOpen = false;
    }
  }

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      closeList();
      continue;
    }
    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      closeList();
      const level = Math.min(heading[1].length, 3);
      html.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }
    const bullet = trimmed.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      if (!listOpen) {
        html.push("<ul>");
        listOpen = true;
      }
      html.push(`<li>${inlineMarkdown(bullet[1])}</li>`);
      continue;
    }
    closeList();
    html.push(`<p>${inlineMarkdown(trimmed)}</p>`);
  }
  closeList();
  return html.join("\n");
}

function normalizePlainText(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function prepareResumeMarkdownForPdf(markdown, basic = {}) {
  const lines = String(markdown || "").split(/\r?\n/);
  const name = normalizePlainText(basic.name);
  const email = normalizePlainText(basic.email);
  const phone = normalizePlainText(basic.phone);
  let index = 0;

  while (index < lines.length && !lines[index].trim()) index += 1;
  if (name) {
    const first = lines[index] || "";
    const firstHeading = first.trim().replace(/^#+\s*/, "");
    if (normalizePlainText(firstHeading) === name) {
      index += 1;
      while (index < lines.length && !lines[index].trim()) index += 1;
      const contactLine = normalizePlainText(lines[index] || "");
      if ((email && contactLine.includes(email)) || (phone && contactLine.includes(phone))) {
        index += 1;
      }
    }
  }

  return lines.slice(index).join("\n").trim();
}

function buildResumePdfHtml({ resumeMarkdown, profile = {}, jd = {} }) {
  const basic = profile.basic || {};
  const title = basic.name || jd.jobTitle || "Tailored Resume";
  const contact = [basic.email, basic.phone, basic.location].filter(Boolean).join(" · ");
  const subtitle = jd.jobTitle ? `求职目标：${jd.jobTitle}` : "定制简历";
  const cleanedMarkdown = prepareResumeMarkdownForPdf(resumeMarkdown, basic);
  const photoDataUrl = /^data:image\/(png|jpeg|webp);base64,/i.test(basic.photoDataUrl || "")
    ? basic.photoDataUrl
    : "";

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <style>
      @page { size: A4; margin: 14mm 14mm; }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        color: #1f2933;
        background: #ffffff;
        font-family: "Microsoft YaHei", "Segoe UI", Arial, sans-serif;
        font-size: 10.2pt;
        line-height: 1.46;
      }
      header {
        position: relative;
        display: grid;
        grid-template-columns: minmax(0, 1fr) ${photoDataUrl ? "24mm" : "0"};
        gap: 9mm;
        align-items: start;
        padding: 0 0 10px;
        margin-bottom: 10px;
        border-bottom: 1.8pt solid #147f72;
      }
      header::before {
        content: "";
        position: absolute;
        left: 0;
        bottom: -1.8pt;
        width: 34mm;
        border-bottom: 1.8pt solid #d8a042;
      }
      .header-main {
        min-width: 0;
        display: grid;
        gap: 3px;
      }
      .portrait {
        width: 24mm;
        height: 31mm;
        object-fit: cover;
        border: 1px solid #b8c3ce;
        border-radius: 2px;
      }
      .name {
        margin: 0;
        font-size: 24pt;
        line-height: 1.1;
        font-weight: 900;
        letter-spacing: 0;
      }
      .subtitle {
        display: inline-block;
        width: fit-content;
        margin-top: 2px;
        color: #147f72;
        font-size: 9.2pt;
        font-weight: 800;
      }
      .contact {
        margin-top: 2px;
        color: #52606d;
        font-size: 9pt;
      }
      h1, h2, h3 {
        break-after: avoid;
        color: #1f2933;
        margin: 9px 0 5px;
        line-height: 1.25;
      }
      h1 {
        font-size: 13pt;
        padding-bottom: 3px;
        border-bottom: 1px solid #d7dee6;
      }
      h2 {
        display: flex;
        align-items: center;
        gap: 7px;
        font-size: 11.5pt;
        font-weight: 900;
        text-transform: none;
      }
      h2::before {
        content: "";
        width: 4px;
        height: 14px;
        border-radius: 2px;
        background: #147f72;
      }
      h3 { font-size: 10.8pt; }
      p {
        margin: 3px 0;
      }
      ul {
        margin: 3px 0 7px 0;
        padding-left: 16px;
      }
      li {
        margin: 2px 0;
        break-inside: avoid;
      }
      strong { font-weight: 800; }
      em { color: #47515c; font-style: normal; }
    </style>
  </head>
  <body>
    <header>
      <div class="header-main">
        <h1 class="name">${escapeHtml(title)}</h1>
        <div class="subtitle">${escapeHtml(subtitle)}</div>
        ${contact ? `<div class="contact">${escapeHtml(contact)}</div>` : ""}
      </div>
      ${photoDataUrl ? `<img class="portrait" src="${photoDataUrl}" alt="portrait" />` : ""}
    </header>
    <main>${markdownToHtml(cleanedMarkdown)}</main>
  </body>
</html>`;
}

module.exports = {
  buildResumePdfHtml,
  escapeHtml,
  markdownToHtml,
  prepareResumeMarkdownForPdf,
};
