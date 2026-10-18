/**
 * Prompt construction for meeting/interview answering (pure logic, TDD).
 * R4: (a) manual — answer THIS sentence; (b) continuous — advise on recent
 * speech; (c) free — ask over the conversation; (d) translate — translate a
 * line to Chinese. Answer language (zh/en) is a runtime prompt hook.
 *
 * v2 (2026-07-10): cache-friendly three-layer layout —
 *   stable prefix  = persona + 【简历】 + 【岗位JD】 + lang directive
 *                    (BYTE-STABLE across requests → DeepSeek prefix cache)
 *   slow state     = 【面试备忘】memo (updated every few turns)
 *   fast context   = history turns + recent transcript + this question + hint
 */
import type { ChatMessage } from './adapter';
import { classifyQuestion, isLikelyQuestion, type QuestionKind } from '../../shared/textHeuristics';

export { isLikelyQuestion, classifyQuestion };

export const MAX_CONTEXT_CHARS = 2400;

export type AnswerLang = 'chinese' | 'english';

/** The prompt hook that steers DeepSeek's reply language (R: 模式选择). */
export function langDirective(lang: AnswerLang): string {
  return lang === 'english'
    ? '- 用【英文】输出我要念的话；必要时在最后附一句极简中文备注。'
    : '- 用【中文】输出。';
}

/** teleprompter persona: the output IS what the user reads aloud, verbatim */
const PERSONA = [
  '你是我的实时面试提词器。我正在参加面试，屏幕上是面试官说话的实时转录。',
  '你输出的内容就是我接下来要照着念的话，必须遵守：',
  '- 全程用第一人称「我」，口语自然，让我可以一字不改地念出来；',
  '- 第一句先给结论或直接回应，再展开 2-3 个短要点；',
  '- 全文控制在 20-60 秒内可念完（约 100字左右，要直击问题要害回答道点子上那种，不要输出和问题无关的内容）；',
  '- 不用 Markdown 标题、编号、加粗等书面格式，分点直接换行；',
  '- 行为/经历类问题按 STAR 展开：情境→任务→行动→结果；',
  '- 技术类问题先一句话讲思路，再给关键点，必要时给复杂度或对比结论；',
  '- 使用【简历】里的真实经历，不能编造简历之外的公司、项目、数字能非实际内容；如果简历当中实在是没有相应的内容，可以不依赖简历和jd，自己组织对应的回答',
  '- 没把握的问题，给出稳妥的通用说法，或一句得体的争取思考时间的话术。',
];

/** total injected background budget; keeps prompts bounded regardless of size */
export const MAX_BACKGROUND_CHARS = 8000;
/** when both slots are present the resume gets the bigger share */
export const RESUME_BUDGET = 5000;
export const JD_BUDGET = MAX_BACKGROUND_CHARS - RESUME_BUDGET;

/** resume: keep project/work-experience sections when over budget */
export const RESUME_PRIORITY =
  /(项目|经历|经验|工作|实习|成果|职责|Project|Experience|Work|Achievement)/i;
/** JD: keep responsibilities/requirements sections when over budget */
export const JD_PRIORITY =
  /(职责|要求|责任|任职|资格|技能|优先|加分|Responsibilit|Requirement|Qualification|Skill)/i;

/**
 * Deterministic budget clip that prefers paragraphs matching `priority`
 * (e.g. a resume's project experience, a JD's requirements) instead of a
 * blind head-truncation. Output order stays the original document order.
 */
export function smartClip(text: string, budget: number, priority: RegExp): string {
  const t = text.trim();
  if (t.length <= budget) return t;
  const paras = t.split(/\n{2,}/);
  const picked = new Set<number>();
  let used = 0;
  const tryTake = (i: number) => {
    if (picked.has(i)) return;
    const cost = paras[i].length + 2; // + join separator
    if (used + cost > budget) return;
    picked.add(i);
    used += cost;
  };
  for (let i = 0; i < paras.length; i++) if (priority.test(paras[i])) tryTake(i);
  for (let i = 0; i < paras.length; i++) tryTake(i);
  if (picked.size === 0) return t.slice(0, budget); // one giant paragraph
  return paras
    .map((p, i) => (picked.has(i) ? p : null))
    .filter((p): p is string => p !== null)
    .join('\n\n');
}

/**
 * The BYTE-STABLE system prompt: persona + resume + JD + language directive.
 * Same inputs MUST yield the identical string (no timestamps / randomness) —
 * the LLM prewarm request and every real request share this prefix so the
 * provider's prefix cache (DeepSeek 0.1x pricing + faster prefill) hits.
 */
export function buildStablePrefix(resume: string, jd: string, lang: AnswerLang): string {
  const parts = [...PERSONA];
  const r = resume.trim();
  const j = jd.trim();
  if (r) {
    parts.push(
      '',
      '【简历】（我的真实资料，回答只能基于此）',
      smartClip(r, j ? RESUME_BUDGET : MAX_BACKGROUND_CHARS, RESUME_PRIORITY),
      '【简历结束】',
    );
  }
  if (j) {
    parts.push(
      '',
      '【岗位JD】（本场面试针对的职位，回答向它贴合）',
      smartClip(j, r ? JD_BUDGET : MAX_BACKGROUND_CHARS, JD_PRIORITY),
      '【岗位JD结束】',
    );
  }
  parts.push('', langDirective(lang));
  return parts.join('\n');
}

/** one advisory line appended to the user message; '' when unknown */
export function questionHint(kind: QuestionKind): string {
  switch (kind) {
    case 'behavioral':
      return '（题型：行为/经历题——用 STAR 结构，讲简历里的真实经历）';
    case 'technical':
      return '（题型：技术题——先一句话思路，再关键点，必要时给复杂度）';
    case 'smalltalk':
      return '（题型：寒暄/暖场——一两句自然简短的回应即可，不用展开）';
    default:
      return '';
  }
}

// ---------- P1-5: rolling interview memo (consistency > compression) ----------

/** hard bound on the stored memo (prompt asks for ≤800, clamp defends) */
export const MAX_MEMO_CHARS = 1000;

export function clampMemo(text: string): string {
  const t = text.trim();
  return t.length > MAX_MEMO_CHARS ? t.slice(0, MAX_MEMO_CHARS) : t;
}

/**
 * Fold one finished Q&A into the rolling memo (async, off the critical path).
 * The memo keeps the interview self-consistent: what was asked, what I have
 * claimed as fact, what the interviewer cares about.
 */
export function buildMemoUpdateMessages(oldMemo: string, question: string, answer: string): ChatMessage[] {
  return [
    {
      role: 'system',
      content: [
        '你是面试会话的备忘维护器。把新一轮问答合并进备忘，输出更新后的完整备忘。',
        '备忘不超过 800 字，固定四节（无内容的节保留标题写「无」）：',
        '【已问问题】每题一行，最新在最后',
        '【我已声称的事实】数字、经历、立场——后续回答绝不能与之矛盾',
        '【面试官关注点】从提问推断',
        '【注意事项】答得不稳的点、需要圆回来的坑',
        '合并去重；超长时优先丢最旧的已问问题。只输出备忘本身，不要任何解释。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: `【当前备忘】\n${oldMemo.trim() || '（空）'}\n\n【新一轮问答】\n问：${question.trim()}\n答：${answer.trim()}`,
    },
  ];
}

// ---------- P1-6: prefix-cache prewarm ----------

/**
 * The prewarm request: system prompt byte-identical to real answer requests
 * (that's the whole point — DeepSeek caches the common token prefix), plus a
 * constant one-word user turn; max_tokens=1 upstream, reply discarded.
 */
export function buildPrewarmMessages(stablePrefix: string): ChatMessage[] {
  return [
    { role: 'system', content: stablePrefix },
    { role: 'user', content: 'ok' },
  ];
}

export interface AnswerPromptInput {
  /** the sentence to answer (segment/continuous) or the text to translate */
  question?: string;
  /** recent transcript lines, oldest first */
  recentTranscript: string[];
  mode: 'segment' | 'continuous' | 'free' | 'translate';
  /** free-form user question (mode === 'free') */
  freeQuestion?: string;
  /** reply language for segment/continuous/free (default chinese) */
  answerLang?: AnswerLang;
  /** prior Q&A turns for a coherent session (oldest first) */
  history?: ChatMessage[];
  /** resume slot (双槽资料); falls back to `background` */
  resume?: string;
  /** job-description slot (双槽资料) */
  jd?: string;
  /** legacy single-slot KB / global default — treated as resume material */
  background?: string;
  /** rolling interview memo (P1) — slow-changing block, its own message */
  memo?: string;
}

/** Keep the most recent lines within the char budget (oldest dropped first). */
export function clampTranscript(lines: string[], maxChars = MAX_CONTEXT_CHARS): string[] {
  const out: string[] = [];
  let total = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const len = lines[i].length + 1;
    if (total + len > maxChars) break;
    out.unshift(lines[i]);
    total += len;
  }
  return out;
}

/**
 * Translate a transcript line to Chinese (R: 翻译功能). Fixed target = 中文,
 * output only the translation. If the text is already Chinese the model
 * simply echoes it.
 */
export function buildTranslateMessages(text: string): ChatMessage[] {
  return [
    {
      role: 'system',
      content:
        '你是翻译引擎。把用户给的整段文本翻译成【简体中文】。只输出译文本身，不要加引号、不要解释、不要复述原文；若原文已是中文则原样返回。',
    },
    { role: 'user', content: text.trim() },
  ];
}

/** R5: screenshot Q&A — one multimodal user message for a vision model. */
export function buildVisionMessages(
  question: string,
  imageDataUrl: string | string[],
  background?: string,
): ChatMessage[] {
  const images = Array.isArray(imageDataUrl) ? imageDataUrl : [imageDataUrl];
  const bg = (background ?? '').trim();
  const sys =
    '你是严谨的测评题答题助手。截图中通常包含一道题目或者多道题目，如果没识别到题目，请提示用户重新截图识别。请完整识别题干、选项、代码、图表和限制条件，然后独立推理并作答。选择题明确给出选项字母和选项内容；判断题直接给出正确或错误；填空题直接给出应填内容；简答题给出精炼、可直接使用的答案；编程题给出正确思路、复杂度和可运行代码。不要复述整道题，不要输出无关内容，题目能直接给答案的直接给答案，不需要多余的推理步骤。若截图内容不完整或无法辨认，明确指出缺失或模糊的位置，不要猜测。回答应简洁、明确。' +
    (bg
      ? `\n\n===== 本人资料与知识库（作答时优先采用） =====\n${bg.slice(0, MAX_BACKGROUND_CHARS)}\n===== 资料结束 =====`
      : '');
  return [
    {
      role: 'system',
      content: sys,
    },
    {
      role: 'user',
      content: [
        ...(images.length > 1
          ? [{ type: 'text' as const, text: `以下 ${images.length} 张截图按顺序属于同一道题，请合并理解完整题意。` }]
          : []),
        ...images.map((url) => ({
          type: 'image_url' as const,
          image_url: { url },
        })),
        { type: 'text', text: question.trim() || '识别截图中的这些题并直接作答（如果题目中有多个题目，需要一并作答，不能只回答一道，如果没识别到题目，就直接返回未识别到题目，不要盲目瞎编）。如果是选择或者填空或者其他题型直接给出明确的最终答案，不需要多余的推理步骤；如果是编程题，请提供解题思路、复杂度和可运行代码,代码需要是python语言，需要将代码去AI味，不能AI味太浓，不能是其他语言，并且在能完整通过的情况下要求代码量最少。' },
      ],
    },
  ];
}

/** Continue one screenshot task without accumulating its intermediate images. */
export function buildVisionFollowupMessages(
  question: string,
  originalImageDataUrl: string | string[],
  currentAnswer: string,
  currentImageDataUrl: string | string[],
): ChatMessage[] {
  const originalImages = Array.isArray(originalImageDataUrl)
    ? originalImageDataUrl
    : [originalImageDataUrl];
  const currentImages = Array.isArray(currentImageDataUrl)
    ? currentImageDataUrl
    : [currentImageDataUrl];
  const instruction = [
    '你正在继续处理同一道截图题目。前一组图片是按顺序排列的原始题目截图，文字是目前已有的完整答案，后一组图片是用户本次提供的最新结果、报错或异常。',
    '尽可能原始题目的要求为准，并将后一组图片视为当前最新事实，据此检查和修正已有答案。不要把后一组图片当作一道全新的题目，当然，也有可能是让你重新审题，有些时候你读题不认真，解答和图片中题目要求不一致。',
    '只输出修正后的完整最终答案，不要描述修改了哪里，不要输出 diff，也不要复述历史答案。',
    '如果是编程题，输出完整、可运行、满足原题约束的代码和必要的简短说明；不要只给局部代码。其他题型同样输出完整、可直接使用的最终解答。',
    '若图片缺少可靠修正所必需的信息，请明确指出还缺少什么，不要猜测。',
  ].join('\n');
  const extra = question.trim();
  return [
    { role: 'system', content: instruction },
    {
      role: 'user',
      content: [
        { type: 'text', text: `【原始题目截图，共 ${originalImages.length} 张，按顺序合并理解】` },
        ...originalImages.map((url) => ({ type: 'image_url' as const, image_url: { url } })),
        { type: 'text', text: `【当前已有的完整答案】\n${currentAnswer.trim()}` },
        { type: 'text', text: `【当前续问截图，共 ${currentImages.length} 张：通常是运行结果、报错或异常】` },
        ...currentImages.map((url) => ({ type: 'image_url' as const, image_url: { url } })),
        ...(extra ? [{ type: 'text' as const, text: `【用户补充要求】\n${extra}` }] : []),
      ],
    },
  ];
}

export function buildAnswerMessages(input: AnswerPromptInput): ChatMessage[] {
  if (input.mode === 'translate') {
    return buildTranslateMessages(input.question ?? '');
  }

  const lang: AnswerLang = input.answerLang ?? 'chinese';
  const context = clampTranscript(input.recentTranscript);
  const resume = (input.resume ?? '').trim() || (input.background ?? '').trim();
  const jd = (input.jd ?? '').trim();

  // Free "随便问": raw pass-through — NO meeting-assistant persona, so identity
  // / "which model are you" questions get the model's truthful answer. The
  // transcript + KB are offered only as optional reference.
  if (input.mode === 'free') {
    const refs: string[] = [];
    if (resume) refs.push(`【本人资料（简历）】\n${resume.slice(0, MAX_BACKGROUND_CHARS)}`);
    if (jd) refs.push(`【岗位JD】\n${jd.slice(0, MAX_BACKGROUND_CHARS)}`);
    if (context.length) refs.push(`【最近的对话转录】\n${context.join('\n')}`);
    const msgs: ChatMessage[] = [];
    if (refs.length) {
      msgs.push({ role: 'system', content: `以下资料供参考（可用可不用）：\n\n${refs.join('\n\n')}` });
    }
    msgs.push(...(input.history ?? []));
    msgs.push({ role: 'user', content: (input.freeQuestion ?? '').trim() });
    return msgs;
  }

  // segment / continuous: teleprompter with the stable prefix
  const msgs: ChatMessage[] = [{ role: 'system', content: buildStablePrefix(resume, jd, lang) }];

  const memo = (input.memo ?? '').trim();
  if (memo) {
    // slow-changing block sits BETWEEN the stable prefix and the fast history,
    // so a memo refresh only invalidates the cache from this point on
    msgs.push({ role: 'user', content: `【面试进行备忘】（此前面试内容的滚动摘要，保持前后一致）\n${memo}` });
    msgs.push({ role: 'assistant', content: '收到，我会保持一致。' });
  }

  msgs.push(...(input.history ?? []));

  const contextBlock = context.length
    ? `【最近的对话转录】\n${context.join('\n')}`
    : '【最近的对话转录】（暂无）';
  const q = (input.question ?? '').trim();
  const hint = q ? questionHint(classifyQuestion(q)) : '';
  const ask = q
    ? `面试官刚才说：\n“${q}”\n${hint ? hint + '\n' : ''}请直接给出我可以照着念的回答。`
    : '基于上面最近的转录，面试官最新的话需要我回应。请直接给出我可以照着念的回答。';

  msgs.push({ role: 'user', content: `${contextBlock}\n\n${ask}` });
  return msgs;
}
