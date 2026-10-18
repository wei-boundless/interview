/**
 * Vision (R5) transport — MAIN PROCESS ONLY (imports electron).
 *
 * DeepSeek has no image input (verified: official API rejects image_url on
 * all models), so screenshot Q&A needs a separate vision provider. Gemini is
 * multimodal but blocked in China, so this path routes through a proxied
 * Electron session (net.request) while the latency-critical DeepSeek answer
 * path stays on direct global fetch. The response is streamed when the
 * provider exposes OpenAI-compatible SSE deltas.
 */
import { net, session, type Session } from 'electron';
import { extractDelta, SseParser, toProxyRules, type ChatMessage } from './adapter';

/** message.content, falling back to reasoning_content (MiMo/thinking models). */
function extractVisionText(jsonBody: string): string {
  try {
    const j = JSON.parse(jsonBody);
    const m = j?.choices?.[0]?.message ?? {};
    return (m.content ?? '').trim() || (m.reasoning_content ?? '').trim();
  } catch {
    return '';
  }
}

export interface VisionConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
  /** e.g. '127.0.0.1:7897'; empty => direct */
  proxyUrl?: string;
}

export interface VisionChatCallbacks {
  onDelta(text: string): void;
}

let proxiedSession: Session | null = null;

// A stalled vision request gets one invisible retry; ordinary HTTP errors are
// surfaced immediately so they do not consume another provider slot.
const VISION_MAX_RETRIES = 1;
const VISION_ATTEMPT_TIMEOUT_MS = 180_000;

/**
 * Direct calls (MiMo etc.) use the proven defaultSession. Only when a proxy is
 * configured (Gemini) do we use a dedicated partitioned session with proxy
 * rules — keeping the proxy off every other network call.
 */
async function pickSession(rules: string): Promise<Session> {
  if (!rules) return session.defaultSession;
  if (!proxiedSession) proxiedSession = session.fromPartition('vision-proxy');
  await proxiedSession.setProxy({ proxyRules: rules });
  return proxiedSession;
}

export async function visionChat(
  config: VisionConfig,
  messages: ChatMessage[],
  signal?: AbortSignal,
  callbacks?: VisionChatCallbacks,
): Promise<string> {
  const url = `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const body = JSON.stringify({ model: config.model, messages, stream: true });
  const rules = toProxyRules(config.proxyUrl);
  const ses = await pickSession(rules);
  let deliveredDelta = false;
  const onDelta = (text: string) => {
    deliveredDelta = true;
    callbacks?.onDelta(text);
  };

  const requestOnce = () =>
    new Promise<{ status: number; body: string; streamedText: string }>((resolve, reject) => {
      const req = net.request({ method: 'POST', url, session: ses });
      req.setHeader('Content-Type', 'application/json');
      req.setHeader('Authorization', `Bearer ${config.apiKey}`);
      let settled = false;
      let timer: NodeJS.Timeout | null = null;
      const cleanup = () => {
        if (timer) clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      };
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };
      const armTimeout = () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          const error = Object.assign(
            new Error(`vision request timed out after ${VISION_ATTEMPT_TIMEOUT_MS / 1000}s without output`),
            { code: 'VISION_TIMEOUT' },
          );
          fail(error);
          req.abort();
        }, VISION_ATTEMPT_TIMEOUT_MS);
      };
      const onAbort = () => {
        req.abort();
        fail(new Error('vision request aborted'));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      armTimeout();
      req.on('response', (res) => {
        let data = '';
        let streamedText = '';
        const parser = new SseParser();
        const decoder = new TextDecoder();
        res.on('data', (c) => {
          const chunk = decoder.decode(c, { stream: true });
          data += chunk;
          for (const payload of parser.push(chunk)) {
            const delta = extractDelta(payload);
            if (delta) {
              streamedText += delta;
              onDelta(delta);
              armTimeout();
            }
          }
        });
        res.on('end', () => {
          if (settled) return;
          const tail = decoder.decode();
          if (tail) {
            data += tail;
            for (const payload of parser.push(tail)) {
              const delta = extractDelta(payload);
              if (delta) {
                streamedText += delta;
                onDelta(delta);
              }
            }
          }
          settled = true;
          cleanup();
          resolve({ status: res.statusCode ?? 0, body: data, streamedText });
        });
        res.on('error', (e) => fail(e));
        res.on('aborted', () => fail(new Error('vision response aborted')));
      });
      req.on('error', (e) => fail(e));
      req.write(body);
      req.end();
    });

  let raw: { status: number; body: string; streamedText: string } | undefined;
  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= VISION_MAX_RETRIES; attempt += 1) {
    if (signal?.aborted) throw new Error('vision request aborted');
    try {
      const result = await requestOnce();
      if (result.status >= 200 && result.status < 300) {
        raw = result;
        break;
      }
      throw new Error(`Vision HTTP ${result.status}: ${result.body.slice(0, 300)}`);
    } catch (e) {
      if (signal?.aborted) throw e;
      if (deliveredDelta) throw e;
      lastError = e as Error;
      if (attempt >= VISION_MAX_RETRIES || (lastError as Error & { code?: string }).code !== 'VISION_TIMEOUT') {
        throw e;
      }
    }
    if (attempt < VISION_MAX_RETRIES) {
      console.warn(`[vision] attempt ${attempt + 1} timed out; retrying (${attempt + 2}/${VISION_MAX_RETRIES + 1})`);
      await new Promise<void>((resolve, reject) => {
        const retryTimer = setTimeout(resolve, 0);
        signal?.addEventListener('abort', () => {
          clearTimeout(retryTimer);
          reject(new Error('vision request aborted'));
        }, { once: true });
      });
    }
  }
  if (!raw) throw lastError ?? new Error('vision request failed');

  if (raw.status < 200 || raw.status >= 300) {
    throw new Error(`Vision HTTP ${raw.status}: ${raw.body.slice(0, 300)}`);
  }
  if (raw.streamedText) return raw.streamedText;
  const text = extractVisionText(raw.body);
  if (text) callbacks?.onDelta(text);
  if (!text) throw new Error(`the vision model returned an empty result: ${raw.body.slice(0, 200)}`);
  return text;
}
