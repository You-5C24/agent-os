import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CLARIFICATION_TOOL_NAME = 'request_clarification';
export const CLAUDE_CLARIFICATION_TOOL_NAME = `mcp__agent_os__${CLARIFICATION_TOOL_NAME}`;

function serverInvocation(): { command: string; args: string[] } {
  const runningFromTypeScript = import.meta.url.endsWith('.ts');
  const server = fileURLToPath(
    new URL(
      runningFromTypeScript
        ? '../mcp/clarification-server.ts'
        : '../mcp/clarification-server.js',
      import.meta.url
    )
  );
  if (!runningFromTypeScript) {
    return { command: process.execPath, args: [server] };
  }
  const tsxCli = fileURLToPath(
    new URL('../../node_modules/tsx/dist/cli.mjs', import.meta.url)
  );
  return { command: process.execPath, args: [tsxCli, server] };
}

export function claudeAppToolArgs(): string[] {
  const invocation = serverInvocation();
  return [
    '--mcp-config',
    JSON.stringify({
      mcpServers: {
        agent_os: {
          type: 'stdio',
          command: invocation.command,
          args: invocation.args,
        },
      },
    }),
  ];
}

export function codexAppToolArgs(): string[] {
  const invocation = serverInvocation();
  return [
    '-c',
    `mcp_servers.agent_os.command=${JSON.stringify(invocation.command)}`,
    '-c',
    `mcp_servers.agent_os.args=${JSON.stringify(invocation.args)}`,
  ];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Cursor CLI 没有 --mcp-config，只能把 MCP 写进工作区 .cursor/mcp.json。 */
export function ensureCursorAppTools(cwd: string): void {
  const invocation = serverInvocation();
  const configDir = join(cwd, '.cursor');
  const configPath = join(configDir, 'mcp.json');
  let existing: Record<string, unknown> = {};
  try {
    existing = JSON.parse(readFileSync(configPath, 'utf8')) as Record<
      string,
      unknown
    >;
    if (!isRecord(existing)) existing = {};
  } catch {
    existing = {};
  }
  const mcpServers = isRecord(existing.mcpServers) ? existing.mcpServers : {};
  const current = mcpServers.agent_os;
  if (
    isRecord(current) &&
    current.command === invocation.command &&
    JSON.stringify(current.args) === JSON.stringify(invocation.args)
  ) {
    return;
  }
  mkdirSync(configDir, { recursive: true });
  writeFileSync(
    configPath,
    `${JSON.stringify(
      {
        ...existing,
        mcpServers: {
          ...mcpServers,
          agent_os: {
            command: invocation.command,
            args: invocation.args,
          },
        },
      },
      null,
      2
    )}\n`,
    'utf8'
  );
}

export function cursorAppToolArgs(): string[] {
  return ['--approve-mcps'];
}
