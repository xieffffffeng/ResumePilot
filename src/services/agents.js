const STOP_WORDS = new Set([
  "and",
  "the",
  "with",
  "for",
  "from",
  "that",
  "this",
  "have",
  "your",
  "will",
  "into",
  "work",
  "role",
  "team",
  "job",
  "requirements",
  "requirement",
  "responsibilities",
  "responsibility",
  "nice",
  "preferred",
  "experience",
  "years",
  "ability",
  "strong",
]);

const KNOWN_SKILLS = [
  "javascript",
  "typescript",
  "python",
  "java",
  "react",
  "vue",
  "angular",
  "node",
  "electron",
  "tauri",
  "sql",
  "mongodb",
  "postgresql",
  "docker",
  "kubernetes",
  "aws",
  "azure",
  "linux",
  "windows",
  "ui",
  "ux",
  "performance",
  "testing",
  "communication",
  "leadership",
  "product",
  "data",
  "machine",
  "learning",
  "llm",
  "agent",
  "resume",
  "interview",
  "recruiting",
  "platform",
];

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function tokenize(text) {
  return normalizeText(text)
    .toLowerCase()
    .replace(/[^a-z0-9#+.\u4e00-\u9fa5]+/gi, " ")
    .split(/\s+/)
    .filter((word) => word.length > 1 && !STOP_WORDS.has(word));
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function analyzeJobDescription(jdText = "") {
  const lines = String(jdText)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const title =
    lines.find((line) => !/requirement|responsibilit|nice to have/i.test(line)) ||
    "Target Role";
  const tokens = tokenize(jdText);
  const known = KNOWN_SKILLS.filter((skill) => tokens.includes(skill));
  const frequency = new Map();
  for (const token of tokens) {
    frequency.set(token, (frequency.get(token) || 0) + 1);
  }
  const frequent = [...frequency.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 16)
    .map(([token]) => token);

  const mustHave = unique([...known, ...frequent]).slice(0, 12);
  return {
    title: normalizeText(title),
    mustHave,
    keywords: unique([...mustHave, ...frequent]).slice(0, 24),
    rawText: jdText,
  };
}

function createEmptyProfile() {
  return {
    basic: {
      name: "",
      age: "",
      school: "",
      email: "",
      birthday: "",
      idNumber: "",
      phone: "",
      location: "",
      targetRole: "",
      photoDataUrl: "",
    },
    education: [],
    experiences: [],
    projects: [],
    competitions: [],
    papers: [],
    skills: "",
    selfSummary: "",
  };
}

function collectCandidateItems(profile) {
  return [
    ...(profile.experiences || []),
    ...(profile.projects || []).map((item) => ({ ...item, type: item.type || "project" })),
    ...(profile.competitions || []).map((item) => ({ ...item, type: item.type || "competition" })),
    ...(profile.papers || []).map((item) => ({ ...item, type: item.type || "paper" })),
  ].filter((item) => normalizeText(item.title || item.description || item.achievements));
}

function relevanceScore(item, keywords) {
  const haystack = tokenize(
    [
      item.title,
      item.role,
      item.organization,
      item.startDate,
      item.endDate,
      item.period,
      item.description,
      item.achievements,
      item.skills,
      item.type,
    ].join(" ")
  );
  const haystackSet = new Set(haystack);
  return keywords.reduce((score, keyword) => score + (haystackSet.has(keyword) ? 1 : 0), 0);
}

function formatPeriod(item) {
  return normalizeText(item.period) || [item.startDate, item.endDate].filter(Boolean).join(" - ") || "Date N/A";
}

function formatItemHeading(item) {
  const title = normalizeText(item.title) || "Relevant Work";
  const role = normalizeText(item.role);
  const period = formatPeriod(item);
  return role ? `${title} | ${role} | ${period}` : `${title} | ${period}`;
}

function formatBasic(profile) {
  const basic = profile.basic || {};
  const parts = [basic.email, basic.phone, basic.location, basic.school].filter(Boolean);
  return `# ${basic.name || "Unnamed Candidate"}\n${parts.join(" | ")}`;
}

function formatBullet(item, analysis) {
  const action = /lead|manage|负责|带领/i.test(item.description || "")
    ? "Led"
    : /build|develop|实现|开发/i.test(item.description || "")
      ? "Built"
      : "Delivered";
  const result = normalizeText(item.achievements) || "produced measurable project outcomes";
  const matching = analysis.keywords
    .filter((keyword) => tokenize([item.description, item.skills, item.achievements].join(" ")).includes(keyword))
    .slice(0, 4);
  const skillPhrase = matching.length ? ` using ${matching.join(", ")}` : "";
  if (item.type === "paper") {
    return `- Paper: ${normalizeText(item.description || item.title)}${skillPhrase}`;
  }
  const suffix = result && result !== "produced measurable project outcomes" ? `; ${result}` : "";
  return `- ${action} ${normalizeText(item.description || item.title)}${skillPhrase}${suffix}`;
}

function resumeAgent(profile, jdInput) {
  const analysis = analyzeJobDescription(jdInput.jdText || jdInput);
  const allItems = collectCandidateItems(profile);
  const ranked = allItems
    .map((item) => ({ item, score: relevanceScore(item, analysis.keywords) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);
  const basic = profile.basic || {};
  const skillText = normalizeText(profile.skills);
  const targetTitle = normalizeText(jdInput.jobTitle) || analysis.title;
  const summarySkills = unique([...analysis.mustHave.slice(0, 4), ...tokenize(skillText).slice(0, 4)]).slice(0, 6);

  const sections = [
    formatBasic(profile),
    "",
    "## Professional Summary",
    `${normalizeText(profile.selfSummary) || "Results-oriented candidate"} targeting ${targetTitle}, with experience aligned to ${summarySkills.join(", ") || "the role requirements"}.`,
    "",
    "## Core Skills",
    unique([...analysis.mustHave, ...skillText.split(/[,;，、\n]/).map((item) => item.trim().toLowerCase())])
      .slice(0, 14)
      .join(" | ") || "To be completed",
    "",
    "## Relevant Experience",
  ];

  if (ranked.length) {
    for (const { item } of ranked) {
      sections.push(
        "",
        `### ${formatItemHeading(item)}`,
        formatBullet(item, analysis)
      );
    }
  } else {
    sections.push("", "- Add internship, work, project, or paper experiences to generate targeted bullets.");
  }

  const education = profile.education || [];
  sections.push("", "## Education");
  if (education.length) {
    for (const edu of education) {
      const period = normalizeText(edu.period) || [edu.startDate, edu.endDate].filter(Boolean).join(" - ");
      const parts = [edu.school || edu.schoolName, edu.degree, edu.major, period].map(normalizeText).filter(Boolean);
      sections.push(`- ${parts.join(" | ")}`);
    }
  } else if (basic.school) {
    sections.push(`- ${basic.school}`);
  } else {
    sections.push("- To be completed");
  }

  return {
    analysis,
    resumeMarkdown: sections.join("\n"),
    selectedItems: ranked.map(({ item, score }) => ({ ...item, relevanceScore: score })),
  };
}

function evaluationAgent(profile, resumeMarkdown, analysis) {
  const resumeTokens = new Set(tokenize(resumeMarkdown));
  const matched = analysis.keywords.filter((keyword) => resumeTokens.has(keyword));
  const coverage = analysis.keywords.length ? matched.length / analysis.keywords.length : 0;
  const hasMetric = /\d+%|\d+\s*(users|人|次|hours|小时|projects|项目|万元|k|w)/i.test(resumeMarkdown);
  const hasEmail = Boolean(profile.basic && profile.basic.email);
  const hasExperience = collectCandidateItems(profile).length > 0;
  const score = Math.min(
    100,
    Math.round(35 + coverage * 35 + (hasMetric ? 12 : 0) + (hasEmail ? 8 : 0) + (hasExperience ? 10 : 0))
  );
  const suggestions = [];

  if (coverage < 0.5) suggestions.push("增加与 JD 关键词直接对应的技能和项目描述，避免只写泛泛职责。");
  if (!hasMetric) suggestions.push("至少为 2-3 条经历补充量化结果，例如效率提升、用户数、准确率或交付周期。");
  if (!hasEmail) suggestions.push("补充邮箱和电话，保证招聘方可以直接联系。");
  if (!hasExperience) suggestions.push("补充实习/工作经历、项目经历或论文，否则简历缺少证明材料。");
  if (suggestions.length === 0) suggestions.push("整体匹配度不错，可继续准备 STAR 面试故事和更具体的业务影响。");

  return {
    score,
    matchedKeywords: matched,
    missingKeywords: analysis.keywords.filter((keyword) => !resumeTokens.has(keyword)).slice(0, 10),
    suggestions,
  };
}

function interviewAgent(resumeMarkdown, jdInput, evaluation) {
  const analysis = analyzeJobDescription(jdInput.jdText || jdInput);
  const topics = unique([...analysis.mustHave, ...(evaluation.missingKeywords || [])]).slice(0, 8);
  const questions = [
    `请用 2 分钟介绍一下你自己，并重点说明为什么适合 ${normalizeText(jdInput.jobTitle) || analysis.title}。`,
    "挑一个与你目标岗位最相关的项目，用 STAR 结构讲清楚背景、行动和结果。",
    "简历中哪一项成果最能证明你的岗位匹配度？它的量化结果是什么？",
    "如果进入这个岗位，前 30 天你会如何熟悉业务并产出价值？",
  ];

  for (const topic of topics) {
    questions.push(`JD 提到了 ${topic}，请结合你的经历说明你怎么实际使用过它。`);
  }

  questions.push("如果面试官质疑你某项经历不够深入，你会如何补充说明？");
  questions.push("你有什么想反问面试官的问题？请给出一个业务问题和一个团队协作问题。");

  return {
    questions: questions.slice(0, 10).map((question) => ({
      question,
      referenceAnswer:
        "参考回答：先用一句话回应问题，再选择简历中最相关的一段经历，按 STAR 结构说明背景、任务、行动和结果；结尾补充与 JD 关键词的对应关系和可量化成果。",
    })),
    tips: [
      "回答项目问题时按 Situation、Task、Action、Result 组织。",
      "优先讲和 JD 关键词重合的经历，不要平均用力。",
      "对缺口问题诚实说明，同时补充学习计划或相邻经验。",
    ],
  };
}

function runWorkflow(profile, jdInput) {
  const resume = resumeAgent(profile, jdInput);
  const evaluation = evaluationAgent(profile, resume.resumeMarkdown, resume.analysis);
  const interview = interviewAgent(resume.resumeMarkdown, jdInput, evaluation);
  return {
    ...resume,
    evaluation,
    interview,
    generatedAt: new Date().toISOString(),
  };
}

module.exports = {
  analyzeJobDescription,
  createEmptyProfile,
  resumeAgent,
  evaluationAgent,
  interviewAgent,
  runWorkflow,
};
