const fs = require("node:fs");
const path = require("node:path");

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function parseJsonObject(text) {
  const cleaned = String(text || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");

  try {
    return JSON.parse(cleaned);
  } catch (initialError) {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch (slicedError) {
        const error = new Error(`模型返回内容不是合法 JSON：${slicedError.message}`);
        error.code = "LLM_INVALID_JSON";
        error.rawText = cleaned;
        throw error;
      }
    }
    const error = new Error(`模型返回内容不是合法 JSON：${initialError.message}`);
    error.code = "LLM_INVALID_JSON";
    error.rawText = cleaned;
    throw error;
  }
}

function compactProfile(profile = {}) {
  const basic = { ...(profile.basic || {}) };
  if (basic.photoDataUrl) {
    basic.hasPhoto = true;
    delete basic.photoDataUrl;
  }
  return {
    basic,
    education: profile.education || [],
    experiences: profile.experiences || [],
    projects: profile.projects || [],
    competitions: profile.competitions || [],
    papers: profile.papers || [],
    skills: profile.skills || "",
    selfSummary: profile.selfSummary || "",
  };
}

function loadSkillContexts(skillPaths = []) {
  return skillPaths
    .filter(Boolean)
    .map((rawPath) => {
      try {
        const content = fs.readFileSync(rawPath, "utf8");
        const name = normalizeText((content.match(/^name:\s*(.+)$/m) || [])[1] || path.basename(path.dirname(rawPath)));
        const description = normalizeText((content.match(/^description:\s*(.+)$/m) || [])[1] || "");
        const excerpt = content.split(/\r?\n/).slice(0, 90).join("\n").slice(0, 3600);
        return [`Skill: ${name}`, `Description: ${description}`, "Excerpt:", excerpt].join("\n");
      } catch {
        return "";
      }
    })
    .filter(Boolean)
    .join("\n\n---\n\n");
}

const DIFFICULTY_SKILL_NAMES = {
  easy: "interview-easy",
  normal: "interview-normal",
  hard: "interview-hard",
};

function normalizeDifficulty(value) {
  return Object.prototype.hasOwnProperty.call(DIFFICULTY_SKILL_NAMES, value) ? value : "normal";
}

function getDifficultySkillName(value) {
  return DIFFICULTY_SKILL_NAMES[normalizeDifficulty(value)];
}

function buildWorkflowPrompt({ profile, jd, skillPaths, reviewFeedback = [] }) {
  const profileJson = JSON.stringify(compactProfile(profile), null, 2);
  const jdJson = JSON.stringify(jd || {}, null, 2);
  const difficulty = normalizeDifficulty(jd && jd.difficulty);
  const skillContext = loadSkillContexts(skillPaths);
  const skillNote = skillContext
    ? `\n\n已注入的 Agent skill 摘要如下，请用于角色边界、任务拆解、输出质量检查：\n${skillContext}`
    : "";
  const feedbackNote = reviewFeedback.length
    ? `\n\n上次生成结果被审核员打回（审核意见如下）。请逐条修正后重新生成，修正后仍须满足上述全部硬性要求：\n${reviewFeedback
        .map((item, index) => `${index + 1}. [${item.severity || "major"}] ${item.problem}`)
        .join("\n")}`
    : "";

  return `
你是 Windows 简历应用后端中的求职工作流模型。请模拟三个顺序协作的 agent：
1. 简历整理 Agent：按照 JD 从候选人长期资料库中抽取最相关信息，生成中文定制简历。
2. 简历评估 Agent：对生成简历按 JD 匹配度评分，并给出具体改进建议。
3. 面试官 Agent：根据 JD、简历和评估结果生成模拟面试问题，并为每个问题给出参考答案。面试题难度画像由已注入的面试难度 skill（当前：${difficulty}）约束，必须严格按该画像的配比与风格出题。

硬性要求：
- 只使用候选人资料和岗位 JD，不编造学校、公司、时间、奖项、成绩、身份证等事实。
- 实习/工作经历中的“岗位”字段要参与匹配判断。
- 教育背景字段要进入简历，不要重复姓名和联系方式。
- 输出必须是一个 JSON 对象，不要 Markdown 代码围栏，不要解释过程。
- 简历正文可以是 Markdown 字符串，但整个回复仍必须是 JSON。
- JSON 必须可被 JSON.parse 直接解析：全部字符串使用双引号，数组元素之间必须有逗号，不要尾随逗号。
- resumeMarkdown 必须是一个 JSON 字符串；其中的换行必须写成 \\n，不要在字符串内部直接换行。

候选人资料：
${profileJson}

岗位 JD：
${jdJson}
${skillNote}${feedbackNote}

JSON 结构必须完全包含：
{
  "analysis": {
    "title": "岗位名称",
    "mustHave": ["核心要求关键词"],
    "keywords": ["JD 关键词"],
    "rawText": "JD 原文"
  },
  "resumeMarkdown": "中文 Markdown 简历",
  "selectedItems": [
    {"type": "work/project/paper", "title": "经历名", "reason": "为什么被选中", "relevanceScore": 0}
  ],
  "evaluation": {
    "score": 0,
    "matchedKeywords": ["已覆盖关键词"],
    "missingKeywords": ["缺失关键词"],
    "suggestions": ["具体修改建议"]
  },
  "interview": {
    "questions": [
      {"question": "面试问题", "referenceAnswer": "可展开查看的参考答案，结合候选人简历和 JD，用 STAR 或结构化方式回答"}
    ],
    "tips": ["3-5 条答题提示"]
  }
}
`.trim();
}

function buildJsonRepairPrompt({ rawText }) {
  return `
你是 JSON 格式修复 Agent。下面是一段模型上一步生成的工作流结果，但它不是合法 JSON。

请只修复 JSON 语法错误，不要新增、删除、改写任何简历事实、评分、建议、面试问题或参考答案。

修复要求：
1. 输出必须是一个可以被 JSON.parse 直接解析的 JSON 对象。
2. 不要 Markdown 代码围栏，不要解释过程。
3. 保留这些顶层字段：analysis、resumeMarkdown、selectedItems、evaluation、interview。
4. interview.questions 必须是对象数组，每项包含 question 和 referenceAnswer。
5. 字符串必须使用双引号，字符串内部换行改成 \\n。
6. 数组元素之间补齐逗号，删除尾随逗号，修复未闭合的引号/括号。

待修复内容：
${String(rawText || "").slice(0, 50000)}
`.trim();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeInterviewQuestions(value) {
  return asArray(value)
    .map((item) => {
      if (typeof item === "string") {
        return { question: item, referenceAnswer: "请结合简历中最相关的经历，用 STAR 结构回答，并补充量化结果。" };
      }
      return {
        question: String((item && (item.question || item.title)) || "").trim(),
        referenceAnswer: String((item && (item.referenceAnswer || item.answer || item.suggestedAnswer)) || "").trim(),
      };
    })
    .filter((item) => item.question);
}

function normalizeWorkflowResult(rawResult) {
  const result = typeof rawResult === "string" ? parseJsonObject(rawResult) : rawResult || {};
  const evaluation = result.evaluation || {};
  const interview = result.interview || {};
  const score = Number.parseInt(evaluation.score, 10);

  return {
    analysis: result.analysis || {},
    resumeMarkdown: String(result.resumeMarkdown || ""),
    selectedItems: asArray(result.selectedItems),
    evaluation: {
      score: Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : 0,
      matchedKeywords: asArray(evaluation.matchedKeywords),
      missingKeywords: asArray(evaluation.missingKeywords),
      suggestions: asArray(evaluation.suggestions),
    },
    interview: {
      questions: normalizeInterviewQuestions(interview.questions),
      tips: asArray(interview.tips),
    },
    generatedAt: new Date().toISOString(),
  };
}

module.exports = {
  buildJsonRepairPrompt,
  buildWorkflowPrompt,
  compactProfile,
  getDifficultySkillName,
  loadSkillContexts,
  normalizeDifficulty,
  normalizeInterviewQuestions,
  normalizeWorkflowResult,
  parseJsonObject,
};
