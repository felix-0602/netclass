#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createInitialState } from './state';
import { BrowserClient } from './browser';
import { ServerClient } from './server-client';
import { DeepSeekBrain } from './lib/deepseek-brain';
import { Dashboard } from './lib/dashboard';
import { setBrain } from './nodes/assess-task';
import { setServer } from './nodes/execute-task';
import { setServer as setVerifyServer } from './nodes/verify-result';
import { setBrain as setBlockerBrain } from './nodes/handle-blocker';

import { scanCourses } from './nodes/scan-courses';
import { enumerateTasks } from './nodes/enumerate-tasks';
import { assessTask } from './nodes/assess-task';
import { executeTask } from './nodes/execute-task';
import { verifyResult } from './nodes/verify-result';
import { handleBlocker } from './nodes/handle-blocker';
import { checkDone } from './nodes/check-done';

interface Config {
  server: string;
  adminKey: string;
  deepseekApiKey: string;
}

function loadConfig(): Config {
  const drainEnvPath = join(homedir(), '.netclass-drain.env');
  const env: Record<string, string> = {};

  if (existsSync(drainEnvPath)) {
    const content = readFileSync(drainEnvPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx > 0) {
        env[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim();
      }
    }
  }

  const server = env.NETCLASS_SERVER ?? process.env.NETCLASS_SERVER ?? 'http://localhost:8080';
  const adminKey = env.NETCLASS_ADMIN_KEY ?? process.env.NETCLASS_ADMIN_KEY ?? 'dev-admin-key-REDACTED';
  const deepseekApiKey = env.DEEPSEEK_API_KEY ?? process.env.DEEPSEEK_API_KEY ?? '';

  return { server, adminKey, deepseekApiKey };
}

function printUsage(): void {
  console.log(`
Netclass LangGraph Orchestrator v0.1

Usage:
  npx tsx src/index.ts [options]

Options:
  --headless           Use headless browser (default: headed)
  --scan-only          Only scan courses and enumerate tasks, don't execute
  --server <url>       Override server URL (default: http://localhost:8080)
  --help               Show this help

Environment:
  NETCLASS_SERVER      Server URL (from ~/.netclass-drain.env or env)
  NETCLASS_ADMIN_KEY   Admin API key
  DEEPSEEK_API_KEY     DeepSeek API key
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    printUsage();
    return;
  }

  const scanOnly = args.includes('--scan-only');
  const urlIdx = args.indexOf('--url');
  const directUrl = urlIdx >= 0 ? args[urlIdx + 1] : null;
  const courseIdx = args.indexOf('--course');
  const directCourse = courseIdx >= 0 ? args[courseIdx + 1] : null;
  const config = loadConfig();

  console.log(`[orchestrator] Server: ${config.server}`);
  console.log(`[orchestrator] DeepSeek: ${config.deepseekApiKey ? 'configured' : 'NOT configured (brain disabled)'}`);

  // Check server health
  const server = new ServerClient(config.server, config.adminKey);
  const healthy = await server.healthCheck();
  if (!healthy) {
    console.error('[orchestrator] ERROR: Server not reachable. Check:');
    console.error('  cd server && node --env-file=.env node_modules/tsx/dist/cli.mjs src/server.ts');
    process.exit(1);
  }
  console.log('[orchestrator] Server: OK');

  // Check browser
  const browser = new BrowserClient();
  const status = await browser.status();
  if (!status.healthy) {
    console.error('[orchestrator] ERROR: gstack browser not running.');
    process.exit(1);
  }
  console.log('[orchestrator] Browser: OK');

  // Wire up injected dependencies
  setServer(server);
  setVerifyServer(server);

  if (config.deepseekApiKey) {
    const brain = new DeepSeekBrain({ apiKey: config.deepseekApiKey });
    setBrain(brain);
    setBlockerBrain(brain);
    console.log('[orchestrator] DeepSeek brain: online');
  }

  const dashboard = new Dashboard();
  let state = createInitialState();

  // === Direct URL mode: skip scan, process a single task ===
  if (directUrl) {
    console.log(`\n[orchestrator] Direct URL mode: ${directUrl}`);
    const task = {
      id: 'direct',
      courseId: directCourse ?? 'unknown',
      courseName: directCourse ?? 'Direct',
      chapterName: '',
      title: directUrl.split('/').pop() ?? 'Direct Task',
      url: directUrl,
      status: 'pending' as const,
    };
    state.tasks = [task];
    state.summary.total = 1;
    state.summary.pending = 1;
    // Skip scan + enumerate phases, go straight to assess → execute
    // The loop below handles this
  } else {
    // === Normal mode: scan courses first ===
    console.log('\n--- Scan Courses ---');
  state = { ...state, ...(await scanCourses(state)), phase: 'scanning-courses' };
  dashboard.render(state);

  if (state.phase === 'error') {
    console.error('[orchestrator] Abort: scan failed');
    return;
  }

  // === Phase 2: Enumerate tasks ===
  console.log('\n--- Enumerate Tasks ---');
  state = { ...state, ...(await enumerateTasks(state)), phase: 'enumerating-tasks' };
  dashboard.render(state);

  console.log(`\nFound ${state.tasks.length} tasks across courses.`);

  if (scanOnly) {
    for (const t of state.tasks) {
      console.log(`  [${t.status}] [${t.courseName}] ${t.title}`);
      console.log(`         ${t.url}`);
    }
    return;
  }

  if (state.tasks.length === 0) {
    console.log('No pending tasks found. Nothing to do.');
    return;
  }
  } // end normal mode else

  // === Phase 3: Process tasks ===
  for (let i = 0; i < state.tasks.length; i++) {
    state = { ...state, currentTaskIndex: i };
    const task = state.tasks[i];

    if (task.status !== 'pending') continue;

    console.log(`\n[${i + 1}/${state.tasks.length}] ${task.title}`);

    // Assess
    state = { ...state, ...(await assessTask(state)) };
    dashboard.render(state);

    const assessed = state.tasks[i];
    if (assessed.status === 'skipped') {
      console.log(`  SKIP: ${assessed.skipReason}`);
      continue;
    }
    if (assessed.status === 'failed') {
      console.log(`  FAIL assess: ${assessed.skipReason}`);
      continue;
    }
    if (assessed.status !== 'doable') continue;

    // Execute
    console.log('  EXECUTING...');
    state = { ...state, ...(await executeTask(state)) };
    dashboard.render(state);

    const executed = state.tasks[i];
    if (executed.status === 'blocked') {
      console.log('  BLOCKED → analyzing popup...');
      state = { ...state, ...(await handleBlocker(state)) };
      dashboard.render(state);

      const afterBlocker = state.tasks[i];
      if (afterBlocker.status === 'doable') {
        console.log('  RETRY after blocker resolved...');
        state = { ...state, ...(await executeTask(state)) };
        dashboard.render(state);
      } else {
        console.log(`  GIVE UP: ${afterBlocker.skipReason ?? 'unresolved blocker'}`);
        continue;
      }
    }

    // Verify
    const final = state.tasks[i];
    if (final.status === 'completed' && final.result?.submitted) {
      console.log('  VERIFYING grading results...');
      state = { ...state, ...(await verifyResult(state)) };
      dashboard.render(state);
      const verified = state.tasks[i];
      if (verified.result?.correctRate !== undefined) {
        console.log(`  DONE: ${verified.result.answered}/${verified.result.total} answered, ${verified.result.correctRate}% correct`);
      }
    } else if (final.status === 'failed') {
      console.log(`  FAILED: ${final.skipReason ?? 'execution error'}`);
    }
  }

  // Finalize
  state = { ...state, ...(await checkDone(state)) };
  dashboard.done(state);
}

main().catch(e => {
  console.error('[orchestrator] Fatal:', e);
  process.exit(1);
});
