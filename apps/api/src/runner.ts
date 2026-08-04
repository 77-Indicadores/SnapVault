import { spawn } from "node:child_process";

export type CommandResult = {
  code: number;
  stdout: string;
  stderr: string;
};

// Limite de captura de stdout/stderr para evitar RangeError com saidas muito grandes
// (ex: pg_dump ou mc gerando megabytes de output em modo verbose)
const MAX_CAPTURE_BYTES = 1 * 1024 * 1024; // 1 MB

export function runCommand(command: string, args: string[], env: Record<string, string> = {}): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      env: { ...process.env, ...env },
      shell: false
    });
    let stdout = "";
    let stderr = "";
    let stdoutBytes = 0;
    let stderrBytes = 0;
    child.stdout.on("data", (chunk: Buffer) => {
      if (stdoutBytes < MAX_CAPTURE_BYTES) {
        stdout += chunk.toString();
        stdoutBytes += chunk.length;
        if (stdoutBytes >= MAX_CAPTURE_BYTES) stdout += "\n[... saida truncada ...]";
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderrBytes < MAX_CAPTURE_BYTES) {
        stderr += chunk.toString();
        stderrBytes += chunk.length;
        if (stderrBytes >= MAX_CAPTURE_BYTES) stderr += "\n[... saida truncada ...]";
      }
    });
    child.on("error", (error) => resolve({ code: 127, stdout, stderr: error.message }));
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

export async function commandExists(command: string): Promise<boolean> {
  const probe = process.platform === "win32" ? await runCommand("where.exe", [command]) : await runCommand("which", [command]);
  return probe.code === 0;
}
