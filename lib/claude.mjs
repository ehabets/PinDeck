import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
import { AgentProcess } from './agent-process.mjs';
import { normalizeModels } from './models.mjs';
/* A long-running Claude Code process in stream-json mode. One process serves the whole chat; it runs under
   the user's normal Claude login. env may be a function: the server's address is known only once it listens. */
export class ClaudeSession {
  constructor(options) { Object.assign(this, options); this.transport = null; this.sessionId = null; }
  get running() { return !!this.transport && !this.transport.closed; }
  async start(resumeId) {
    if (this.running) return;
    this.stopped = false;
    const env = typeof this.env === 'function' ? this.env() : this.env;
    /* The sign-in check: "not signed in" only when the CLI says so. A CLI without `auth status --json` (older
       than PinDeck's tested versions) or with other output starts anyway; the session then reports any problem. */
    let signedIn = null;
    try {
      const { stdout } = await exec(process.env.CLAUDE_BIN || 'claude', ['auth', 'status', '--json'],
        { env: { ...process.env, ...env }, timeout: 15000, maxBuffer: 65536 });
      signedIn = JSON.parse(stdout).loggedIn;
    } catch (e) {
      if (e.code === 'ENOENT') throw new Error('Claude CLI is not installed (or set CLAUDE_BIN).');
      if (e.killed) throw new Error('Claude did not answer its sign-in check within 15 s. Try again (Refresh models).');
      try { signedIn = JSON.parse(e.stdout).loggedIn; } catch {}   // signed out: the CLI answers, and exits 1
    }
    if (signedIn === false) throw new Error('Claude is not signed in. Run claude auth login, then refresh models.');
    if (this.stopped) throw new Error('Agent stopped.');
    const transport = new AgentProcess({ binary: process.env.CLAUDE_BIN || 'claude', cwd: this.cwd, env,
      args: ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
        ...(typeof this.args === 'function' ? this.args() : this.args || []), ...(resumeId ? ['--resume', resumeId] : [])],
      onStderr: this.onStderr,
      onMessage: ev => {
        if (this.transport !== transport) return;
        if (ev.type === 'control_request') { transport.write({ type: 'control_response', response: { subtype: 'success', request_id: ev.request_id,
          response: { behavior: 'deny', message: 'This tool is outside PinDeck permissions.' } } }); return; }
        if (ev.session_id) this.sessionId = ev.session_id;
        this.onEvent?.(ev);
      },
      onExit: error => { if (this.transport === transport) this.onExit?.(error); },
    });
    this.transport = transport;
    try { const init = await transport.request('initialize', {}, { claude: true }); this.models = normalizeModels('claude', init?.models); }
    catch (e) { this.stop(); throw e; }
  }
  async send(content) { this.transport.write({ type: 'user', message: { role: 'user', content } }); }
  async interrupt() { if (this.running) await this.transport.request('interrupt', {}, { claude: true, timeout: 5000 }); }
  /* Resolves once the process has exited, so shutdown can wait for it. */
  stop() { this.stopped = true; const t = this.transport; this.transport = null; return t ? t.stop() : Promise.resolve(); }
}
