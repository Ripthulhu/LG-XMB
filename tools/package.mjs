// lg-xmb web application, 2026. SPDX-License-Identifier: GPL-3.0-only
// Local build/inspection only. This script has no device or deployment commands.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stageHelper } from './stage-helper.mjs';

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appDir = path.join(projectDir, 'app');
const outputDir = path.join(projectDir, 'dist');
const cliStateDir = path.join(projectDir, '.build', 'cli-state');
const cliDir = path.join(projectDir, 'node_modules', '@webos-tools', 'cli');
const cli = path.join(cliDir, 'bin', 'ares-package.js');
const expectedId = 'org.local.openxmb.c5';
const expectedVersion = '0.1.18';
const packagePath = path.join(outputDir, `${expectedId}_${expectedVersion}_all.ipk`);
const verifyOnly = process.argv.includes('--verify-only');

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}
function runCli(args) {
  // Scope the CLI's own configuration directory to this child process.
  // This does not edit the user's environment or existing device registrations.
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: projectDir,
    env: { ...process.env, APPDATA: cliStateDir },
    encoding: 'utf8',
    timeout: 120000,
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true
  });
  if (result.error) throw result.error;
  const transcript = [result.stdout, result.stderr].filter(Boolean).join('\n');
  requireCondition(result.status === 0, `ares-package failed (${result.status}):\n${transcript}`);
  return transcript;
}

function runPython(script, args) {
  const result = spawnSync(process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3'),
    [path.join(projectDir, 'tools', script), ...args],
    {encoding: 'utf8', timeout: 30000, windowsHide: true});
  if (result.error) throw new Error(`Packaging requires Python 3.10 or newer: ${result.error.message}`);
  requireCondition(result.status === 0, `${script} failed:\n${result.stderr}`);
  process.stdout.write(result.stdout);
}

try {
  requireCondition(fs.existsSync(cli), 'Install local dependencies first: npm ci --ignore-scripts --no-audit --no-fund');
  const cliPackage = JSON.parse(fs.readFileSync(path.join(cliDir, 'package.json'), 'utf8'));
  requireCondition(cliPackage.version === '3.2.6', 'Expected pinned @webos-tools/cli 3.2.6. Run npm ci.');
  const appinfo = JSON.parse(fs.readFileSync(path.join(appDir, 'appinfo.json'), 'utf8'));
  requireCondition(appinfo.id === expectedId, `App ID must be ${expectedId}`);
  requireCondition(appinfo.version === expectedVersion, `App version must be ${expectedVersion}`);
  requireCondition(appinfo.type === 'web', 'Expected a web app, without a native service.');
  if (!verifyOnly) {
    const licenseDir = path.join(appDir, 'licenses');
    fs.mkdirSync(licenseDir, { recursive: true });
    for (const name of ['LICENSE', 'THIRD-PARTY-NOTICES.md', 'WAVE-PROVENANCE.md']) {
      const sourcePath = path.join(projectDir, name);
      if (fs.existsSync(sourcePath)) fs.copyFileSync(sourcePath, path.join(licenseDir, name));
    }
  }
  for (const relativeName of [appinfo.main, appinfo.icon, 'licenses/LICENSE', 'licenses/THIRD-PARTY-NOTICES.md', 'licenses/UPSTREAM-original.frag', 'licenses/UPSTREAM-config.json', 'licenses/PS3-XMB-MIT.txt']) {
    requireCondition(typeof relativeName === 'string' && relativeName.length > 0, 'App entry and icon paths are required.');
    const resolved = path.resolve(appDir, relativeName);
    requireCondition(resolved.startsWith(appDir + path.sep), `App file leaves package directory: ${relativeName}`);
    requireCondition(fs.statSync(resolved).isFile(), `Missing app file: ${relativeName}`);
  }
  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(cliStateDir, { recursive: true });
  if (!verifyOnly) {
    const stagedApp = path.join(projectDir, '.build', 'package', 'app');
    fs.rmSync(path.dirname(stagedApp), {recursive: true, force: true});
    fs.cpSync(appDir, stagedApp, {recursive: true});
    stageHelper(projectDir, stagedApp);
    process.stdout.write(runCli(['--no-minify', '--outdir', outputDir, stagedApp]));
    // The pinned CLI recreates directories with mode 0777. Normalize the IPK,
    // not just the staging folder, without changing shared TV ancestor entries.
    runPython('ipk_archive.py', [packagePath]);
  }
  requireCondition(fs.existsSync(packagePath), `Package was not produced: ${packagePath}`);
  const packageBytes = fs.readFileSync(packagePath);
  requireCondition(packageBytes.subarray(0, 8).toString('ascii') === '!<arch>\n', 'IPK is not an ar archive.');
  runPython('verify-helper-package.py', [packagePath]);
  const info = runCli(['--info-detail', packagePath]);
  requireCondition(info.includes(expectedId), 'IPK inspection did not report the expected app ID.');
  fs.writeFileSync(path.join(outputDir, 'package-info.txt'), info, 'utf8');
  const hash = createHash('sha256').update(packageBytes).digest('hex');
  fs.writeFileSync(path.join(outputDir, 'SHA256SUMS'), `${hash}  ${path.basename(packagePath)}\n`, 'utf8');
  console.log(`Verified ${path.basename(packagePath)} (${packageBytes.length} bytes)`);
  console.log(`SHA-256 ${hash}`);
  console.log('Created locally; installation and TV behavior have not been tested by this build command.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
