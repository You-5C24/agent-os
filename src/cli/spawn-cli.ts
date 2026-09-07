import {
  execFileSync,
  spawn,
  type ChildProcess,
  type ChildProcessByStdio,
  type SpawnOptions,
} from 'node:child_process';
import type { Readable, Writable } from 'node:stream';

function killProcessTree(pid: number, signal: NodeJS.Signals): void {
  try {
    const output = execFileSync('pgrep', ['-P', String(pid)], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    for (const line of output.split('\n')) {
      const childPid = Number(line.trim());
      if (Number.isInteger(childPid) && childPid > 0) {
        killProcessTree(childPid, signal);
      }
    }
  } catch {
    // pgrep 在没有子进程时退出码为 1
  }
  try {
    process.kill(pid, signal);
  } catch {
    // 进程可能已经退出
  }
}

/** 杀掉 CLI 进程树，避免 http.server 等孙子进程残留。Windows 走 taskkill /t。 */
export function killCli(
  child: ChildProcess,
  signal: NodeJS.Signals = 'SIGTERM'
): void {
  if (!child.pid) {
    child.kill(signal);
    return;
  }
  if (process.platform !== 'win32') {
    killProcessTree(child.pid, signal);
    return;
  }
  spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
    windowsHide: true,
    stdio: 'ignore',
  });
}

export function spawnCli(
  command: string,
  args: string[],
  options: SpawnOptions & { stdio: ['ignore', 'pipe', 'pipe'] }
): ChildProcessByStdio<null, Readable, Readable>;
export function spawnCli(
  command: string,
  args: string[],
  options: SpawnOptions & { stdio: ['pipe', 'pipe', 'pipe'] }
): ChildProcessByStdio<Writable, Readable, Readable>;
export function spawnCli(
  command: string,
  args: string[],
  options: SpawnOptions & { stdio: SpawnOptions['stdio'] }
): ChildProcessByStdio<any, any, any> {
  if (process.platform !== 'win32') {
    return spawn(command, args, options);
  }
  // Windows 下 claude/cursor/codex 常以 .cmd 批处理形式存在，必须走 shell（cmd）才能找到并启动。
  // prompt 已在适配器侧改为 stdin 传递，命令行里只剩无空格的标志参数，shell 拼接不会破坏它们。
  return spawn(command, args, {
    ...options,
    shell: true,
    windowsHide: true,
  });
}
