/* JSON-line subprocess transport. Requests and notifications never outlive their process. */
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import readline from 'node:readline';
export class AgentProcess {
  constructor({ binary, args, cwd, env, onMessage = () => {}, onExit = () => {}, onStderr = () => {} }) {
    Object.assign(this, { onMessage, onExit });
    this.pending = new Map(); this.seq = 0; this.closed = false; this.stderr = '';
    this.proc = spawn(binary, args, { cwd, env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
    this.exited = new Promise(resolve => this.proc.once('close', resolve).once('error', () => this.proc.pid === undefined && resolve()));
    readline.createInterface({ input: this.proc.stdout }).on('line', line => {
      if (this.closed) return;
      let m; try { m = JSON.parse(line); } catch { return; }
      const id = m.type === 'control_response' ? m.response?.request_id : m.id;
      const pending = this.pending.get(id);
      if (pending && (m.type === 'control_response' || !m.method)) {
        this.pending.delete(id); clearTimeout(pending.timer);
        const err = m.error || (m.response?.subtype === 'error' && m.response.error);
        if (err) pending.reject(new Error(err.message || String(err)));
        else pending.resolve(m.type === 'control_response' ? m.response.response : m.result);
      } else this.onMessage(m);
    });
    this.proc.stderr.on('data', d => { this.stderr = (this.stderr + d).slice(-2000); onStderr(String(d)); });
    this.proc.stdin.on('error', e => this.end(e));
    // spawn reports a missing working folder as the binary's ENOENT: name the folder instead
    this.proc.on('error', e => this.end(e.code === 'ENOENT' && cwd && !fs.existsSync(cwd)
      ? new Error(`The deck folder ${cwd} is not there any more (moved or deleted).`) : e));
    this.proc.on('exit', (code, signal) => this.end(new Error(`Agent stopped (${signal || code}). ${this.stderr.trim()}`)));
  }
  write(value) { if (this.closed) throw new Error('Agent is not running.'); this.proc.stdin.write(JSON.stringify(value) + '\n'); }
  request(method, params, { claude = false, timeout = 30000 } = {}) {
    const id = claude ? `pindeck-${++this.seq}` : ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Agent timed out: ${method}`)); }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      try { this.write(claude ? { type: 'control_request', request_id: id, request: { subtype: method, ...params } } : { id, method, params }); }
      catch (e) { clearTimeout(timer); this.pending.delete(id); reject(e); }
    });
  }
  end(error) {
    if (this.closed) return;
    this.closed = true;
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(error); }
    this.pending.clear(); this.onExit(error);
  }
  /* End of input first (the CLI finishes and exits), SIGTERM after 1.5 s, SIGKILL after 4 s.
     Resolves once the process has exited, so shutdown can wait for it. */
  stop() {
    this.end(new Error('Agent stopped.'));
    const proc = this.proc;
    if (proc.exitCode !== null || proc.signalCode !== null || proc.pid === undefined) return Promise.resolve();
    proc.stdin.end();
    const term = setTimeout(() => proc.kill('SIGTERM'), 1500), kill = setTimeout(() => proc.kill('SIGKILL'), 4000);
    return this.exited.finally(() => { clearTimeout(term); clearTimeout(kill); });
  }
}
