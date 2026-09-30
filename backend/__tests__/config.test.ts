import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../src/config';

/**
 * `config` throws at import time when a secret is missing or still a
 * placeholder, which is impossible to assert with a normal `expect(...).toThrow`
 * — the module is already loaded and cached. So every case runs in a real
 * child process (`tsx`, the same runner the server uses) with a temporary
 * working directory and a purpose-built .env, and we assert on the exit code
 * and stderr. This is the only way to show the refusal is real rather than
 * merely asserted in a comment.
 *
 * dotenv does not overwrite variables already present in the environment, so
 * the child also receives the values directly — the temp .env is belt and
 * braces, and it means these tests do not depend on the developer's own .env.
 */
const BACKEND_ROOT = path.resolve(__dirname, '..');
const CONFIG_SOURCE = path.join(BACKEND_ROOT, 'src', 'config.ts');
const TSX_CLI = path.join(BACKEND_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');

/**
 * A throwaway directory INSIDE the repo, laid out as
 *
 *   backend/.tmp-config-XXXX/.env          <- written by the test
 *   backend/.tmp-config-XXXX/nested/config.ts  <- a copy of src/config.ts
 *
 * so that, in the child process, `path.resolve(__dirname, '../.env')` lands on
 * the .env this test wrote, while `require('dotenv')` still resolves against
 * the real node_modules two levels up.
 *
 * Both properties matter. If the copy sat outside the repo, dotenv could not be
 * found; if it sat directly in the repo, `../.env` would resolve to the
 * developer's own backend/.env and the "access secret is unset" case would
 * silently pick up a real key and pass for the wrong reason.
 */
interface Sandbox {
  dir: string;
  configCopy: string;
}

function makeSandbox(env: Record<string, string>): Sandbox {
  const dir = fs.mkdtempSync(path.join(BACKEND_ROOT, '.tmp-config-'));
  const nested = path.join(dir, 'nested');
  fs.mkdirSync(nested);
  fs.writeFileSync(
    path.join(dir, '.env'),
    ['MONGODB_URI=mongodb://localhost:27017/clinic', ...Object.entries(env).map(([k, v]) => `${k}=${v}`)].join('\n')
  );
  const configCopy = path.join(nested, 'config.ts');
  fs.copyFileSync(CONFIG_SOURCE, configCopy);
  return { dir, configCopy };
}

interface BootResult {
  code: number;
  stderr: string;
}

/** Env for the child: no inherited JWT secrets, so nothing leaks in. */
function childEnv(overrides: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.JWT_ACCESS_SECRET;
  delete env.JWT_REFRESH_SECRET;
  for (const [k, v] of Object.entries(overrides)) env[k] = v;
  return env;
}

function bootWith(env: Record<string, string>): BootResult {
  const { dir, configCopy } = makeSandbox(env);
  try {
    try {
      const out = execFileSync(process.execPath, [TSX_CLI, configCopy], {
        cwd: dir,
        encoding: 'utf8',
        env: childEnv(env),
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 60_000,
      });
      return { code: 0, stderr: String(out) };
    } catch (err) {
      const e = err as { status?: number | null; stderr?: string; stdout?: string };
      return { code: e.status ?? 1, stderr: `${e.stderr ?? ''}${e.stdout ?? ''}` };
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const GOOD_ACCESS = 'a1b2c3d4'.repeat(8); // 64 hex chars
const GOOD_REFRESH = 'f0e9d8c7'.repeat(8);

describe('config — the process refuses to boot on a guessable signing key', () => {
  it('the shipped .env is itself valid (the control case)', () => {
    // If this stops holding, every assertion below is meaningless.
    expect(config.accessTokenSecret.length).toBeGreaterThanOrEqual(32);
    expect(config.refreshTokenSecret).not.toBe(config.accessTokenSecret);
  });

  it('a real random-looking secret pair boots', () => {
    const r = bootWith({ JWT_ACCESS_SECRET: GOOD_ACCESS, JWT_REFRESH_SECRET: GOOD_REFRESH });
    expect(r.stderr).not.toMatch(/\[config\]/);
    expect(r.code).toBe(0);
  });

  it('the literal values shipped in .env.example are rejected', () => {
    // The regression this file exists for: the example file ships
    // REPLACE_ME_..._hex_string, which is comfortably longer than the length
    // floor, so a length check alone would wave it through.
    const example = fs.readFileSync(path.join(BACKEND_ROOT, '.env.example'), 'utf8');
    const access = /JWT_ACCESS_SECRET=(.*)/.exec(example)?.[1]?.trim() ?? '';
    const refresh = /JWT_REFRESH_SECRET=(.*)/.exec(example)?.[1]?.trim() ?? '';
    expect(access).toMatch(/REPLACE_ME/);
    expect(access.length).toBeGreaterThan(32);

    const r = bootWith({ JWT_ACCESS_SECRET: access, JWT_REFRESH_SECRET: refresh });
    expect(r.code).not.toBe(0);
    expect(r.stderr).toMatch(/placeholder/i);
    expect(r.stderr).toMatch(/JWT_ACCESS_SECRET/);
  });

  it.each([
    ['empty', ''],
    ['whitespace only', '   '],
    ['a known literal', 'changeme-access'],
    ['the word secret', 'secret'],
    ['one character under the 32 minimum', 'a'.repeat(31)],
    ['long but still a placeholder', `REPLACE_ME_${'x'.repeat(40)}`],
  ])('access secret %s -> non-zero exit naming the variable', (_label, value) => {
    const r = bootWith({ JWT_ACCESS_SECRET: value, JWT_REFRESH_SECRET: GOOD_REFRESH });
    expect(r.code).not.toBe(0);
    expect(r.stderr).toMatch(/JWT_ACCESS_SECRET/);
  });

  it('an unset access secret -> non-zero exit naming the variable', () => {
    const r = bootWith({ JWT_REFRESH_SECRET: GOOD_REFRESH });
    expect(r.code).not.toBe(0);
    expect(r.stderr).toMatch(/JWT_ACCESS_SECRET/);
    expect(r.stderr).toMatch(/\.env\.example/);
  });

  it('the refresh secret is checked independently of the access secret', () => {
    const r = bootWith({ JWT_ACCESS_SECRET: GOOD_ACCESS, JWT_REFRESH_SECRET: 'changeme-refresh' });
    expect(r.code).not.toBe(0);
    expect(r.stderr).toMatch(/JWT_REFRESH_SECRET/);
  });

  it('the two secrets must differ', () => {
    // One key for both means a refresh token is also a valid access token,
    // which collapses the whole access/refresh split.
    const r = bootWith({ JWT_ACCESS_SECRET: GOOD_ACCESS, JWT_REFRESH_SECRET: GOOD_ACCESS });
    expect(r.code).not.toBe(0);
    expect(r.stderr).toMatch(/differ|must not/i);
  });
});
