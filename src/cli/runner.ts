import { killCli, spawnCli } from './spawn-cli.js';
import { promptInputForPlatform } from './types.js';
import { createInterface } from 'node:readline';
import type { CliAdapter, CliEvent, CliRunResult } from './types.js';
import { ensureCursorAppTools } from './app-tools.js';
import { readClaudeSessionAnswer } from './native-sessions.js';

const DEFAULT_TIMEOUT_MS = Number(process.env.CLI_TIMEOUT_MS) || 10 * 60 * 1000;
const DEFAULT_IDLE_TIMEOUT_MS =
  Number(process.env.CLI_IDLE_TIMEOUT_MS) || 2 * 60 * 1000;

export interface RunCliOptions {
  adapter: CliAdapter;
  prompt: string;
  cwd: string;
  sessionId?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  stopToolNames?: string[];
  idleTimeoutMs?: number;
  env?: Record<string, string>;
  onEvent?: (event: CliEvent) => void;
}

export function runCli(options: RunCliOptions): Promise<CliRunResult> {
  const {
    adapter,
    prompt,
    cwd,
    sessionId,
    signal,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    stopToolNames = [],
    idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS,
    env,
    onEvent,
  } = options;
  // Windows 下 prompt 走 stdin（规避 cmd 转义/乱码），其他平台直接作为命令行参数。
  const promptInput = promptInputForPlatform(process.platform);
  const useStdin = promptInput === 'stdin';
  if (adapter.id === 'cursor') ensureCursorAppTools(cwd);
  const args = sessionId
    ? adapter.buildResumeArgs(prompt, sessionId, promptInput)
    : adapter.buildArgs(prompt, promptInput);

  return new Promise((resolve, reject) => {
    // 固定用 `['pipe','pipe','pipe']`，让 stdin 始终可写（spawnCli 返回类型按字面量收窄）。
    const child = spawnCli(adapter.command, args, {
      cwd,
      signal,
      env: env ? { ...process.env, ...env } : undefined,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    // stdin 模式下把 prompt 写入子进程；否则 prompt 已在命令行参数里，stdin 直接收口。
    if (child.stdin) {
      if (useStdin) child.stdin.end(prompt, 'utf8');
      else child.stdin.end();
    }
    // spawn 的 signal 选项只杀直接子进程（cmd 外壳），Windows 下 claude.exe/cursor.exe/codex.exe 会变孤儿；
    // 额外监听 abort 用 killCli 连进程树一起清。
    signal?.addEventListener('abort', () => killCli(child), { once: true });
    const lines = createInterface({ input: child.stdout });
    let observedSessionId = sessionId;
    let observedAnswer: string | undefined;
    let observedStats: CliRunResult['stats'];
    const observedToolCalls = new Map<
      string,
      NonNullable<CliRunResult['toolCalls']>[number]
    >();
    let finalResult: CliRunResult | undefined;
    let stoppedByToolCall:
      | NonNullable<CliRunResult['toolCalls']>[number]
      | undefined;
    let resultError: Error | undefined;
    let stderr = '';
    let settled = false;
    let timedOut = false;
    let idleTimedOut = false;
    let draftAnswer: string | undefined;

    const timer = setTimeout(() => {
      timedOut = true;
      killCli(child);
    }, timeoutMs);

    // stdout 任意一行都重置；与 CLI_TIMEOUT_MS 独立，专门抓 stream-json 静默挂死。
    let idleTimer: NodeJS.Timeout | undefined;
    const resetIdleTimer = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        idleTimedOut = true;
        killCli(child);
      }, idleTimeoutMs);
    };
    resetIdleTimer();

    const finish = () => {
      clearTimeout(timer);
      if (idleTimer) clearTimeout(idleTimer);
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      finish();
      reject(error);
    };
    const succeed = (result: CliRunResult) => {
      if (settled) return;
      settled = true;
      finish();
      resolve(result);
    };

    const salvageAnswer = async (): Promise<string | undefined> => {
      const draft = draftAnswer?.trim();
      if (draft) return draft;
      if (adapter.id !== 'claude' || !observedSessionId) return undefined;
      try {
        return await readClaudeSessionAnswer(cwd, observedSessionId);
      } catch {
        return undefined;
      }
    };

    lines.on('line', (line) => {
      resetIdleTimer();
      for (const event of adapter.parseEvents(line)) {
        onEvent?.(event);
        if ('sessionId' in event && event.sessionId) {
          observedSessionId = event.sessionId;
        }
        if (event.type === 'draft') {
          draftAnswer = event.answer;
          continue;
        }
        if (event.type === 'tool_start') {
          draftAnswer = undefined;
          continue;
        }
        if (event.type === 'error') {
          resultError = new Error(event.message);
          continue;
        }
        if (event.type === 'tool_call') {
          observedToolCalls.set(event.toolUseId, event);
          if (!stoppedByToolCall && stopToolNames.includes(event.toolName)) {
            stoppedByToolCall = {
              toolUseId: event.toolUseId,
              toolName: event.toolName,
              input: event.input,
            };
            killCli(child);
          }
          continue;
        }
        if (event.type === 'tool_end' && event.failed) {
          observedToolCalls.delete(event.toolUseId);
          continue;
        }
        if (event.type === 'result') {
          if (event.answer) observedAnswer = event.answer;
          if (event.stats) observedStats = event.stats;
          if (!observedAnswer) continue;
          finalResult = {
            answer: observedAnswer,
            sessionId: event.sessionId ?? observedSessionId,
            ...(observedStats ? { stats: observedStats } : {}),
          };
        }
      }
    });

    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });
    child.once('error', (error) => {
      if (timedOut) {
        fail(new Error(`${adapter.displayName} 执行超时`));
        return;
      }
      if (idleTimedOut) {
        fail(
          new Error(
            `${adapter.displayName} 无输出超时（已静默 ${Math.round(
              idleTimeoutMs / 1000
            )} 秒）`
          )
        );
        return;
      }
      if (signal?.aborted) {
        fail(new Error(`${adapter.displayName} 执行已取消`));
        return;
      }
      fail(error);
    });
    child.once('close', (code) => {
      void (async () => {
        if (settled) return;
        if (stoppedByToolCall) {
          settled = true;
          finish();
          resolve({
            answer: observedAnswer ?? '',
            sessionId: observedSessionId,
            toolCalls: [stoppedByToolCall],
          });
          return;
        }
        if (signal?.aborted) {
          return fail(new Error(`${adapter.displayName} 执行已取消`));
        }
        if (idleTimedOut) {
          if (finalResult) {
            if (observedToolCalls.size > 0) {
              finalResult.toolCalls = [...observedToolCalls.values()].map(
                (call) => ({
                  toolUseId: call.toolUseId,
                  toolName: call.toolName,
                  input: call.input,
                })
              );
            }
            return succeed(finalResult);
          }
          const salvaged = await salvageAnswer();
          if (salvaged) {
            console.log(`[CLI] ${adapter.id} 无输出超时，已从会话恢复最终回答`);
            return succeed({
              answer: salvaged,
              sessionId: observedSessionId,
            });
          }
          return fail(
            new Error(
              `${adapter.displayName} 无输出超时（已静默 ${Math.round(
                idleTimeoutMs / 1000
              )} 秒）`
            )
          );
        }
        if (timedOut) {
          return fail(new Error(`${adapter.displayName} 执行超时`));
        }
        if (resultError) return fail(resultError);
        if (code !== 0) {
          return fail(
            new Error(
              stderr.trim() || `${adapter.displayName} 退出，状态码 ${code}`
            )
          );
        }
        if (!finalResult) {
          return fail(new Error(`${adapter.displayName} 没有返回最终结果`));
        }
        if (observedToolCalls.size > 0) {
          finalResult.toolCalls = [...observedToolCalls.values()].map(
            (call) => ({
              toolUseId: call.toolUseId,
              toolName: call.toolName,
              input: call.input,
            })
          );
        }
        succeed(finalResult);
      })();
    });
  });
}
