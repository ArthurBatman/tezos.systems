#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SCHEDULED_REFRESH_LANES, scheduledRefreshTargets } from '../scripts/lib/scheduled-refresh-lanes.mjs';
import { assertSafeTarget, executeNodeStep, pathMatchesTarget, runRefreshLanes, validateLaneDefinitions } from '../scripts/lib/scheduled-refresh-runner.mjs';

const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'scheduled-refresh-test-'));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspace = path.join(temporary, 'workspace');
const publish = path.join(temporary, 'publish');
const backups = path.join(temporary, 'backups');

try {
  await fs.mkdir(workspace, { recursive: true });
  await fs.mkdir(publish, { recursive: true });

  assert.equal(validateLaneDefinitions(SCHEDULED_REFRESH_LANES), true);
  const ids = new Set(SCHEDULED_REFRESH_LANES.map((lane) => lane.id));
  for (const required of ['governance', 'maxis-season', 'capital', 'minerals', 'uranium', 'metals', 'ecosystem', 'whales', 'launcher-projections']) {
    assert(ids.has(required), `scheduled refresh is missing the ${required} lane`);
  }
  const productionTargets = scheduledRefreshTargets();
  for (const required of ['data/ecosystem-stats.json', 'data/ecosystem-entry-summary.json', 'data/whale-watch.json', 'data/maxis-leaders.json']) {
    assert(productionTargets.includes(required), `scheduled target inventory is missing ${required}`);
  }
  const maxisSeasonRefresh = SCHEDULED_REFRESH_LANES.find((lane) => lane.id === 'maxis-season')?.refresh?.[0];
  assert.deepEqual(
    { attempts: maxisSeasonRefresh?.attempts, retryBaseMs: maxisSeasonRefresh?.retryBaseMs, retryCapMs: maxisSeasonRefresh?.retryCapMs },
    { attempts: 3, retryBaseMs: 60_000, retryCapMs: 120_000 },
    'scheduled Maxis refresh must retry a transient source failure outside the frozen evaluator implementation'
  );
  assert.equal(pathMatchesTarget('data/maxis/seasons/example/summary.json', 'data/maxis/seasons'), true);
  assert.equal(pathMatchesTarget('data/maxis-season.json', 'data/maxis/seasons'), false);
  assert.throws(() => assertSafeTarget('../outside'), /Unsafe/);
  assert.throws(() => validateLaneDefinitions([
    { id: 'one', targets: ['data/shared'], refresh: [], validate: [] },
    { id: 'two', targets: ['data/shared/file.json'], refresh: [], validate: [] }
  ]), /overlaps/);
  assert.throws(() => validateLaneDefinitions([
    { id: 'bad-retry', targets: ['data/retry.json'], refresh: [{ script: 'scripts/retry.mjs', args: [], attempts: 1, retryBaseMs: 1_000 }], validate: [] }
  ]), /retry timing requires multiple attempts/);

  const write = async (root, relative, value) => {
    await fs.mkdir(path.dirname(path.join(root, relative)), { recursive: true });
    await fs.writeFile(path.join(root, relative), value);
  };
  const read = (root, relative) => fs.readFile(path.join(root, relative), 'utf8');
  for (const relative of ['data/one.json', 'data/two.json', 'data/three.json', 'data/four.json']) {
    await write(workspace, relative, `old:${relative}`);
    await write(publish, relative, `old:${relative}`);
  }

  const fixtureLanes = [
    { id: 'one', targets: ['data/one.json'], refresh: [{ script: 'scripts/fixture.mjs', args: ['write', 'data/one.json', 'new-one'] }], validate: [] },
    { id: 'two', targets: ['data/two.json'], refresh: [{ script: 'scripts/fixture.mjs', args: ['fail', 'data/two.json', 'broken-two'] }], validate: [] },
    { id: 'three', targets: ['data/three.json'], refresh: [{ script: 'scripts/fixture.mjs', args: ['write', 'data/three.json', 'new-three'] }], validate: [{ script: 'scripts/fixture.mjs', args: ['fail-check'] }] },
    { id: 'four', targets: ['data/four.json'], refresh: [{ script: 'scripts/fixture.mjs', args: ['write', 'data/four.json', 'new-four'] }], validate: [] }
  ];
  const executeStep = async (step, { cwd }) => {
    const [action, relative, value] = step.args;
    if (relative) await write(cwd, relative, value || action);
    if (action.startsWith('fail')) throw new Error(`injected ${action}`);
  };
  const report = await runRefreshLanes({
    lanes: fixtureLanes,
    workspaceRoot: workspace,
    publishRoot: publish,
    backupRoot: backups,
    executeStep
  });
  assert.deepEqual(report.summary, { total: 4, attempted: 4, succeeded: 2, failed: 2, skipped: 0 });
  assert.equal(await read(publish, 'data/one.json'), 'new-one');
  assert.equal(await read(publish, 'data/two.json'), 'old:data/two.json');
  assert.equal(await read(publish, 'data/three.json'), 'old:data/three.json');
  assert.equal(await read(publish, 'data/four.json'), 'new-four');
  assert.equal(await read(workspace, 'data/two.json'), 'old:data/two.json', 'failed refresh must restore last-good workspace data');
  assert.equal(await read(workspace, 'data/three.json'), 'old:data/three.json', 'failed validation must restore last-good workspace data');

  const retryScript = path.join(temporary, 'retry-step.mjs');
  const retryCounter = path.join(temporary, 'retry-count.txt');
  await fs.writeFile(retryScript, `
    import fs from 'node:fs';
    const file = process.argv[2];
    const count = fs.existsSync(file) ? Number(fs.readFileSync(file, 'utf8')) + 1 : 1;
    fs.writeFileSync(file, String(count));
    if (count < 3) process.exit(1);
  `);
  const retryDelays = [];
  await executeNodeStep({
    script: retryScript,
    args: [retryCounter],
    attempts: 3,
    retryBaseMs: 7,
    retryCapMs: 10
  }, {
    cwd: root,
    forwardOutput: false,
    waitForRetry: async (milliseconds) => retryDelays.push(milliseconds)
  });
  assert.deepEqual(retryDelays, [7, 10], 'scheduled step retries must use bounded exponential backoff');
  assert.equal(await fs.readFile(retryCounter, 'utf8'), '3', 'scheduled step retries must stop after the first success');

  const fatalWorkspace = path.join(temporary, 'fatal-workspace');
  const fatalPublish = path.join(temporary, 'fatal-publish');
  await write(fatalWorkspace, 'data/declared.json', 'old');
  await write(fatalPublish, 'data/declared.json', 'old');
  const fatalReport = await runRefreshLanes({
    lanes: [{ id: 'scope', targets: ['data/declared.json'], refresh: [{ script: 'scripts/fixture.mjs', args: ['fail', 'data/declared.json', 'broken'] }], validate: [] }],
    workspaceRoot: fatalWorkspace,
    publishRoot: fatalPublish,
    backupRoot: path.join(temporary, 'fatal-backups'),
    executeStep,
    listChangedPaths: async () => ['data/declared.json', 'data/undeclared.json']
  });
  assert.match(fatalReport.fatal, /undeclared paths/);
  assert.equal(await read(fatalPublish, 'data/declared.json'), 'old', 'fatal scope violations must publish nothing');

  const missingWorkspace = path.join(temporary, 'missing-workspace');
  const missingPublish = path.join(temporary, 'missing-publish');
  await write(missingWorkspace, 'data/required.json', 'old');
  await write(missingPublish, 'data/required.json', 'old');
  await assert.rejects(
    runRefreshLanes({
      lanes: [{ id: 'missing', targets: ['data/required.json'], refresh: [{ script: 'scripts/fixture.mjs', args: ['remove', 'data/required.json'] }], validate: [] }],
      workspaceRoot: missingWorkspace,
      publishRoot: missingPublish,
      backupRoot: path.join(temporary, 'missing-backups'),
      executeStep: async (step, { cwd }) => fs.rm(path.join(cwd, step.args[1]), { force: true })
    }),
    /Successful scheduled-refresh target is missing/,
    'a successful lane may not delete a declared publish target'
  );
  assert.equal(await read(missingPublish, 'data/required.json'), 'old', 'missing success targets must not delete the published last-good file');

  const goodReportPath = path.join(temporary, 'good-report.json');
  const badReportPath = path.join(temporary, 'bad-report.json');
  await fs.writeFile(goodReportPath, JSON.stringify({ summary: { succeeded: 2, failed: 0, skipped: 0 }, lanes: [] }));
  await fs.writeFile(badReportPath, JSON.stringify({ summary: { succeeded: 1, failed: 1, skipped: 0 }, lanes: [{ id: 'broken', status: 'failed', error: 'injected' }] }));
  const goodReportCheck = spawnSync(process.execPath, ['scripts/refresh-scheduled-data.mjs', '--check-report', goodReportPath], { cwd: root, encoding: 'utf8' });
  const badReportCheck = spawnSync(process.execPath, ['scripts/refresh-scheduled-data.mjs', '--check-report', badReportPath], { cwd: root, encoding: 'utf8' });
  assert.equal(goodReportCheck.status, 0, goodReportCheck.stderr);
  assert.notEqual(badReportCheck.status, 0, 'failed lane reports must keep the scheduled Action red after partial publication');
  const retiredMonolith = spawnSync(process.execPath, ['scripts/refresh-generated-surfaces.mjs', '--mode', 'scheduled'], { cwd: root, encoding: 'utf8' });
  assert.notEqual(retiredMonolith.status, 0, 'the old all-or-nothing scheduled mode must fail before running generators');
  assert.match(retiredMonolith.stderr, /refresh-scheduled-data\.mjs/);
  await assert.rejects(
    executeNodeStep({ script: 'scripts/refresh-generated-surfaces.mjs', args: ['--mode', 'scheduled'] }, { cwd: root, forwardOutput: false }),
    /Scheduled data must use scripts\/refresh-scheduled-data\.mjs/,
    'lane reports must retain the upstream error detail, not only an exit code'
  );

  console.log('ok - scheduled refresh lanes isolate failures, preserve last-good data, and enforce declared write scope');
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}
