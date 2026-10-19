const { compactProfile, parseJsonObject } = require("./llm-workflow");

function truncateText(value, maxLength) {
  const text = String(value || "");
  return text.length > maxLength ? `${text.slice(0, maxLength)}……（截断）` : text;
}

function buildReviewPrompt({ profile, jd, workflowResult }) {
  const profileJson = JSON.stringify(compactProfile(profile), null, 2);
  const interview = workflowResult.interview || {};
  const payload = {
    resumeMarkdown: truncateText(workflowResult.resumeMarkdown, 6000),
    selectedItems: workflowResult.selectedItems || [],
    evaluation: workflowResult.evaluation || {},
    interview: {
      questions: (interview.questions || []).slice(0, 8),
      tips: interview.tips || [],
    },
  };

  return `
你是求职工作流的审核员 Agent，负责审核"简历整理 / 评估 / 面试官"三个 Agent 的生成结果是否合理。你只审核打分，不重新生成内容。

审核维度（逐项检查）：
1. 事实准确性（权重最高）：简历中的姓名、学校、公司、时间、数字、奖项是否与候选人资料库一致，有无编造或篡改事实。
2. JD 匹配合理性：selectedItems 的选中理由是否成立，命中/缺失关键词判断是否准确，有无明显漏判或误判。
3. 内容质量：简历描述是否具体、有量化成果；建议是否可操作（缺口+改法）；面试题是否结合候选人真实经历，参考答案是否结构化（STAR 等）。
4. 格式合规：resumeMarkdown 结构完整（姓名、教育、经历、技能齐全），输出字段无缺失。

评分标准：
- 90-100：事实零编造，匹配准确，内容具体可执行。
- 75-89：事实无误，个别建议或面试题不够具体。
- 60-74：事实无误，但匹配或质量有明显短板。
- 低于 60：存在编造事实、严重不匹配或内容空洞，必须打回重写。

注意：只要发现任何一处编造事实（资料库中不存在的学校、公司、时间、数字），fabrication 必须为 true，总分不得超过 59。

候选人资料库：
${profileJson}

岗位 JD：
${JSON.stringify(jd || {}, null, 2)}

待审核的工作流结果：
${JSON.stringify(payload, null, 2)}

只输出一个可被 JSON.parse 解析的 JSON 对象，不要 Markdown 围栏，不要解释过程：
{
  "score": 0,
  "fabrication": false,
  "issues": [{"aspect": "维度名", "problem": "具体问题", "severity": "major|minor"}],
  "comment": "一句话总评"
}
`.trim();
}

function normalizeReviewResult(rawResult) {
  const result = typeof rawResult === "string" ? parseJsonObject(rawResult) : rawResult || {};
  const score = Number.parseInt(result.score, 10);
  const issues = Array.isArray(result.issues) ? result.issues : [];
  return {
    score: Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : 0,
    fabrication: result.fabrication === true,
    issues: issues
      .map((item) => ({
        aspect: String((item && item.aspect) || "").trim(),
        problem: String((item && item.problem) || "").trim(),
        severity: item && item.severity === "minor" ? "minor" : "major",
      }))
      .filter((item) => item.problem),
    comment: String(result.comment || "").trim(),
  };
}

module.exports = {
  buildReviewPrompt,
  normalizeReviewResult,
  truncateText,
};
