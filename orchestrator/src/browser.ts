import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

function resolveBrowseBin(): string {
  // Check vendored first, then global
  const vendored = join(process.cwd(), '.claude/skills/gstack/browse/dist/browse');
  if (existsSync(vendored)) return vendored;
  return join(homedir(), '.claude/skills/gstack/browse/dist/browse');
}

export class BrowserClient {
  private bin: string;
  private debug: boolean;

  constructor(bin?: string, debug = false) {
    this.bin = bin ?? resolveBrowseBin();
    this.debug = debug;
  }

  private run(args: string, timeoutMs = 30000): string {
    const cmd = `${this.bin} ${args}`;
    if (this.debug) console.log('[browser]', cmd.slice(0, 120));
    try {
      const stdout = execSync(cmd, {
        timeout: timeoutMs,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return stdout.trim();
    } catch (e: unknown) {
      const err = e as { stderr?: string; stdout?: string; status?: number };
      const detail = err.stderr ?? err.stdout ?? String(e);
      if (this.debug) console.error('[browser] error:', detail.slice(0, 200));
      throw new Error(`browse command failed: ${args.slice(0, 80)} — ${detail.slice(0, 200)}`);
    }
  }

  async goto(url: string): Promise<void> {
    this.run(`goto "${url}"`, 30000);
  }

  async url(): Promise<string> {
    return this.run('url', 5000);
  }

  async text(): Promise<string> {
    return this.run('text', 15000);
  }

  async html(selector?: string): Promise<string> {
    const sel = selector ? ` "${selector}"` : '';
    return this.run(`html${sel}`, 15000);
  }

  async click(selector: string): Promise<void> {
    this.run(`click "${selector.replace(/"/g, '\\"')}"`, 10000);
  }

  async fill(selector: string, value: string): Promise<void> {
    this.run(`fill "${selector}" "${value}"`, 10000);
  }

  async js<T = unknown>(script: string): Promise<T> {
    const raw = this.run(`js ${script}`, 15000);
    try {
      return JSON.parse(raw) as T;
    } catch {
      return raw as T;
    }
  }

  async eval(filePath: string): Promise<string> {
    return this.run(`eval "${filePath}"`, 15000);
  }

  async snapshot(opts: string = ''): Promise<string> {
    return this.run(`snapshot ${opts}`.trim(), 15000);
  }

  async screenshot(filePath: string, selector?: string): Promise<string> {
    const sel = selector ? ` --selector "${selector}"` : '';
    return this.run(`screenshot "${filePath}"${sel}`, 15000);
  }

  async isVisible(selector: string): Promise<boolean> {
    const out = this.run(`is visible "${selector}"`, 5000);
    return out.includes('true');
  }

  async isEnabled(selector: string): Promise<boolean> {
    const out = this.run(`is enabled "${selector}"`, 5000);
    return out.includes('true');
  }

  async isChecked(selector: string): Promise<boolean> {
    const out = this.run(`is checked "${selector}"`, 5000);
    return out.includes('true');
  }

  async waitForSelector(selector: string, timeoutMs = 15000): Promise<void> {
    this.run(`wait "${selector}"`, timeoutMs);
  }

  async status(): Promise<{ healthy: boolean }> {
    const out = this.run('status', 5000);
    return { healthy: out.includes('healthy') };
  }

  async restart(): Promise<void> {
    this.run('restart', 10000);
  }

  async scroll(selector?: string): Promise<void> {
    const sel = selector ? ` "${selector}"` : '';
    this.run(`scroll${sel}`, 5000);
  }

  async dialogAccept(text: string = 'yes'): Promise<void> {
    this.run(`dialog-accept "${text}"`, 5000);
  }

  async dialogDismiss(): Promise<void> {
    this.run('dialog-dismiss', 5000);
  }

  async reload(): Promise<void> {
    this.run('reload', 15000);
  }

  async networkErrors(): Promise<string> {
    return this.run('network', 10000);
  }
}
