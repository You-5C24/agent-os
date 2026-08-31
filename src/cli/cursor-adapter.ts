import { promptInputForPlatform } from './types.js';
import type {
  CliAdapter,
  CliPromptInput,
  CliEvent,
  CliRunStats,
} from './types.js';

interface CursorEvent {
  type?: unknown;
  subtype?: unknown;
  is_error?: unknown;
  result?: unknown;
  session_id?: unknown;
  duration_ms?: unknown;
  call_id?: unknown;
  tool_call?: unknown;
  message?: unknown;
}

const TOOL_INFO: Record<
  string,
  { toolName: string; label: string }
> = {
  shellToolCall: { toolName: 'Bash', label: '运行命令' },
  readToolCall: { toolName: 'Read', label: '读取文件' },
  editToolCall: { toolName: 'Edit', label: '修改文件' },
  writeToolCall: { toolName: 'Write', label: '写入文件' },
  deleteToolCall: { toolName: 'Delete', label: '删除文件' },
  grepToolCall: { toolName: 'Grep', label: '搜索代码' },
  lsToolCall: { toolName: 'Glob', label: '列出文件' },
  globToolCall: { toolName: 'Glob', label: '查找文件' },
  todoToolCall: { toolName: 'Todo', label: '更新待办' },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function shortPath(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value) return undefined;
  const normalized = value.replaceAll('\\', '/');
  const parts = normalized.split('/').filter(Boolean);
  return parts.slice(normalized.startsWith('/') ? -2 : -3).join('/');
}

function shortText(value: unknown, maxLength = 72): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.replace(/\s+/g, ' ').trim();
  if (!text) return undefined;
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function toolKind(
  toolCall: Record<string, unknown>
): { kind: string; payload: Record<string, unknown> } | undefined {
  if (isRecord(toolCall.function) && typeof toolCall.function.name === 'string') {
    return { kind: toolCall.function.name, payload: toolCall.function };
  }
  for (const [kind, payload] of Object.entries(toolCall)) {
    if (isRecord(payload)) return { kind, payload };
  }
  return undefined;
}

function toolDetail(kind: string, args: unknown): string | undefined {
  if (!isRecord(args)) return undefined;
  if (kind === 'shellToolCall' || kind === 'Bash') {
    return shortText(args.command);
  }
  if (
    [
      'readToolCall',
      'editToolCall',
      'writeToolCall',
      'deleteToolCall',
      'lsToolCall',
      'Read',
      'Edit',
      'Write',
    ].includes(kind)
  ) {
    return shortPath(args.path);
  }
  if (kind === 'grepToolCall' || kind === 'Grep') {
    return shortText(args.pattern) ?? shortText(args.query);
  }
  if (kind === 'globToolCall' || kind === 'Glob') {
    return (
      shortText(args.globPattern) ??
      shortText(args.glob_pattern) ??
      shortText(args.pattern)
    );
  }
  return (
    shortPath(args.path) ??
    shortText(args.command) ??
    shortText(args.pattern) ??
    shortText(args.query)
  );
}

function toolInfo(toolCall: Record<string, unknown>):
  | {
      toolName: string;
      label: string;
      detail?: string;
    }
  | undefined {
  const matched = toolKind(toolCall);
  if (!matched) return undefined;
  const mapped = TOOL_INFO[matched.kind];
  const args = isRecord(matched.payload.args)
    ? matched.payload.args
    : matched.payload.arguments;
  const detail = toolDetail(matched.kind, args);
  return {
    toolName: mapped?.toolName ?? matched.kind,
    label: mapped?.label ?? `调用 ${matched.kind}`,
    ...(detail ? { detail } : {}),
  };
}

function toolFailed(payload: Record<string, unknown>): boolean {
  const result = payload.result;
  if (!isRecord(result)) return false;
  if (result.success !== undefined) return false;
  return result.error !== undefined || result.failure !== undefined;
}

function parseStats(event: CursorEvent): CliRunStats | undefined {
  const stats: CliRunStats = {
    durationMs: asNumber(event.duration_ms),
  };
  return Object.values(stats).some((value) => value !== undefined)
    ? stats
    : undefined;
}

function outputArgs(prompt: string, promptInput: CliPromptInput): string[] {
  return [
    '-p',
    // headless 下必须 --force 才会真正改文件；--trust 跳过工作区确认。
    '--force',
    '--trust',
    '--output-format',
    'stream-json',
    ...(promptInput === 'argument' ? [prompt] : []),
  ];
}

export class CursorAdapter implements CliAdapter {
  readonly id = 'cursor' as const;
  readonly command = 'agent';
  readonly displayName = 'Cursor';

  buildArgs(prompt: string, promptInput: CliPromptInput): string[] {
    return outputArgs(prompt, promptInput);
  }

  buildResumeArgs(
    prompt: string,
    sessionId: string,
    promptInput: CliPromptInput
  ): string[] {
    return ['--resume', sessionId, ...outputArgs(prompt, promptInput)];
  }

  buildCompactPlan(sessionId: string, instructions?: string) {
    const command = instructions?.trim()
      ? `/summarize ${instructions.trim()}`
      : '/summarize';
    return {
      protocol: 'claude-stream-json' as const,
      command: this.command,
      // Cursor 官方整理命令是 /summarize（/compact 仍是别名）；stdin 模式要把文本写入子进程。
      prompt: command,
      args: this.buildResumeArgs(
        command,
        sessionId,
        promptInputForPlatform(process.platform)
      ),
    };
  }

  parseEvents(line: string): CliEvent[] {
    let event: CursorEvent;
    try {
      event = JSON.parse(line) as CursorEvent;
    } catch {
      return [];
    }

    const sessionId =
      typeof event.session_id === 'string' ? event.session_id : undefined;
    if (event.type === 'system' && event.subtype === 'init' && sessionId) {
      return [{ type: 'session', sessionId }];
    }
    if (event.type === 'tool_call' && typeof event.call_id === 'string') {
      if (!isRecord(event.tool_call)) return [];
      const tool = toolInfo(event.tool_call);
      if (!tool) return [];
      if (event.subtype === 'started') {
        return [
          {
            type: 'tool_start',
            toolUseId: event.call_id,
            ...tool,
          },
        ];
      }
      if (event.subtype === 'completed') {
        const matched = toolKind(event.tool_call);
        return [
          {
            type: 'tool_end',
            toolUseId: event.call_id,
            failed: matched ? toolFailed(matched.payload) : false,
          },
        ];
      }
      return [];
    }
    if (event.type !== 'result') return [];
    if (event.is_error || event.subtype === 'error') {
      return [
        {
          type: 'error',
          message:
            typeof event.result === 'string' ? event.result : 'Cursor 执行失败',
          ...(sessionId ? { sessionId } : {}),
        },
      ];
    }
    if (typeof event.result !== 'string') return [];
    const stats = parseStats(event);
    return [
      {
        type: 'result',
        answer: event.result,
        ...(sessionId ? { sessionId } : {}),
        ...(stats ? { stats } : {}),
      },
    ];
  }
}
