import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../skills/knowledge-brief/scripts/brief-store.mjs', import.meta.url));
const json = value => JSON.stringify(value, null, 2);
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (file, value) => fs.writeFileSync(file, json(value));

function fixture(t, input = { keywords: ['统计学'] }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-brief-test-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith('knowledge-brief-test-'));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const config = path.join(dir, '简报配置.json');
  write(config, input);
  return { dir, config, root: path.join(dir, 'briefs') };
}

function cli(ctx, command, options = {}, expected = 0) {
  const args = [script, command, '--config', ctx.config, ...Object.entries(options).flatMap(([key, value]) => [`--${key}`, String(value)])];
  const result = spawnSync(process.execPath, args, { encoding: 'utf8' });
  assert.equal(result.status, expected, result.stdout + result.stderr);
  return JSON.parse(result.stdout);
}

function cliAsync(ctx, command) {
  return new Promise((resolve, reject) => {
    const process = spawn(processExec, [script, command, '--config', ctx.config]);
    let output = '';
    let error = '';
    process.stdout.on('data', chunk => { output += chunk; });
    process.stderr.on('data', chunk => { error += chunk; });
    process.on('error', reject);
    process.on('exit', code => {
      try { assert.equal(code, 0, output + error); resolve(JSON.parse(output)); }
      catch (failure) { reject(failure); }
    });
  });
}
const processExec = process.execPath;

function draft(run, history, overrides = {}) {
  const claim = overrides.learning_outcome ?? '能根据抽样机制判断估计适用的总体';
  const record = {
    topic: '抽样',
    learning_question: '抽样机制如何影响总体推断？',
    learning_outcome: claim,
    key_claims: [claim], content_type: '经典知识',
    related_brief_ids: [], new_learning_delta: '学习抽样机制与适用范围的关系',
    dedup_review: {
      decision: 'pass', history_digest: run.history_digest,
      compared_brief_ids: history.entries.map(entry => entry.brief_id),
      closest_brief_ids: history.entries.slice(0, 1).map(entry => entry.brief_id),
      rationale: '本测试场景引入独立的学习问题和判断方法',
    },
    sources: [{
      url: 'https://example.org/study?version=2&utm_source=test', title: '隔离测试资料（非真实阅读证据）', author: '测试夹具',
      published_at: null, accessed_at: new Date().toISOString(), version: '2', supports: [claim],
    }],
    candidate_reviews: [{ question: '候选问题', decision: 'selected', reason: '用于验证存储行为的合成候选' }],
    ...overrides,
  };
  fs.writeFileSync(path.join(run.draft_dir, 'brief.md'), `# 知识简报｜${run.business_date}\n\n${record.learning_question}\n\n${record.learning_outcome}\n\n测试夹具，不是真实知识简报。\n`);
  write(path.join(run.draft_dir, 'record.json'), record);
  return record;
}

// 构造历史日期夹具：先通过公开 CLI 发布，再把完整归档和运行记录移到旧日期。
function seedHistory(ctx, date, outcome = `掌握 ${date} 对应的独立判断`) {
  const run = cli(ctx, 'begin');
  const history = cli(ctx, 'history');
  draft(run, history, { learning_question: `${date} 的学习问题是什么？`, learning_outcome: outcome });
  const result = cli(ctx, 'publish', { 'run-id': run.run_id });
  const directory = path.dirname(result.brief_path);
  const recordFile = path.join(directory, 'record.json');
  const record = read(recordFile);
  Object.assign(record, { brief_id: date, business_date: date });
  write(recordFile, record);
  const destination = path.join(ctx.root, date.slice(0, 4), date.slice(5, 7), date);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.renameSync(directory, destination);
  const runFile = path.join(ctx.root, 'runs', `${run.run_id}.json`);
  const savedRun = read(runFile);
  Object.assign(savedRun, { business_date: date, brief_path: path.join(destination, 'brief.md') });
  write(runFile, savedRun);
  fs.unlinkSync(path.join(ctx.root, 'index.jsonl'));
  return date;
}

test('仅关键词初始化为六项配置，默认模板独立可编辑，重复初始化不覆盖', t => {
  const ctx = fixture(t);
  const result = cli(ctx, 'init');
  assert.equal(result.status, 'initialized');
  assert.deepEqual(Object.keys(read(ctx.config)).sort(), ['keywords', 'description', 'style', 'source', 'output_dir', 'template'].sort());
  const customTemplate = '# 用户自己的模板';
  fs.writeFileSync(result.template_path, customTemplate);
  cli(ctx, 'init');
  assert.equal(fs.readFileSync(result.template_path, 'utf8'), customTemplate);
});

test('额外配置和非空未知输出目录均被拒绝，不覆盖原内容', t => {
  const ctx = fixture(t, { keywords: ['统计学'], reader: {} });
  assert.match(cli(ctx, 'init', {}, 1).error, /六项/);
  write(ctx.config, { keywords: ['统计学'] });
  fs.mkdirSync(ctx.root);
  const original = path.join(ctx.root, '用户文件.txt');
  fs.writeFileSync(original, '保留');
  assert.match(cli(ctx, 'init', {}, 1).error, /拒绝接管/);
  assert.equal(fs.readFileSync(original, 'utf8'), '保留');
});

test('公开 CLI 完成发布、来源规范化和同日复用，保留有意义参数与配置快照', t => {
  const ctx = fixture(t);
  cli(ctx, 'init');
  const originalConfig = read(ctx.config);
  const run = cli(ctx, 'begin');
  const history = cli(ctx, 'history');
  draft(run, history);
  write(ctx.config, { ...originalConfig, style: '改为严谨的表达' });
  const result = cli(ctx, 'publish', { 'run-id': run.run_id });
  assert.equal(result.status, 'succeeded');
  const record = read(path.join(path.dirname(result.brief_path), 'record.json'));
  assert.equal(record.config_snapshot.style, originalConfig.style);
  assert.equal(record.sources[0].canonical_url, 'https://example.org/study?version=2');
  assert.ok(record.template_snapshot.length > 0);
  const before = fs.readFileSync(result.brief_path, 'utf8');
  const reused = cli(ctx, 'begin');
  assert.equal(reused.status, 'reused');
  assert.equal(reused.brief_path, result.brief_path);
  assert.equal(fs.readFileSync(result.brief_path, 'utf8'), before);
  assert.equal(cli(ctx, 'history').total, 1);
});

test('两个真实 CLI 进程竞争同一目录时只有一个 ready，其他配置也共享该锁', async t => {
  const ctx = fixture(t);
  cli(ctx, 'init');
  const results = await Promise.all([cliAsync(ctx, 'begin'), cliAsync(ctx, 'begin')]);
  assert.deepEqual(results.map(result => result.status).sort(), ['busy', 'ready']);
  const secondConfig = path.join(ctx.dir, '另一配置.json');
  write(secondConfig, { ...read(ctx.config), keywords: ['实验设计'] });
  assert.equal(cli({ ...ctx, config: secondConfig }, 'begin').status, 'busy');
  const run = results.find(result => result.status === 'ready');
  assert.equal(cli(ctx, 'fail', { 'run-id': run.run_id, reason: '测试主动结束' }).persisted, true);
  assert.equal(fs.existsSync(path.join(ctx.root, '.lock')), false);
});

test('分页包含多年以前的全部历史，不能遗漏较早简报', t => {
  const ctx = fixture(t);
  cli(ctx, 'init');
  seedHistory(ctx, '2020-01-01');
  seedHistory(ctx, '2021-02-02');
  seedHistory(ctx, '2022-03-03');
  const first = cli(ctx, 'history', { offset: 0, limit: 2 });
  assert.equal(first.total, 3);
  assert.equal(first.next_offset, 2);
  assert.deepEqual(first.entries.map(entry => entry.brief_id), ['2020-01-01', '2021-02-02']);
  const second = cli(ctx, 'history', { offset: first.next_offset, limit: 2 });
  assert.equal(second.next_offset, null);
  assert.equal(second.entries[0].brief_id, '2022-03-03');
  assert.equal(first.history_digest, second.history_digest);
});

test('遗漏历史比较记录时拒绝发布，并保存失败尝试', t => {
  const ctx = fixture(t);
  cli(ctx, 'init');
  seedHistory(ctx, '2020-01-01');
  const run = cli(ctx, 'begin');
  const history = cli(ctx, 'history');
  const record = draft(run, history);
  record.dedup_review.compared_brief_ids = [];
  write(path.join(run.draft_dir, 'record.json'), record);
  const result = cli(ctx, 'publish', { 'run-id': run.run_id }, 1);
  assert.match(result.error, /全部历史/);
  assert.equal(result.persisted, true);
  assert.equal(read(path.join(ctx.root, 'runs', `${run.run_id}.json`)).status, 'failed');
  assert.equal(cli(ctx, 'history').total, 1);
});

test('改标题却保留相同学习成果时被确定性去重拦截', t => {
  const ctx = fixture(t);
  cli(ctx, 'init');
  seedHistory(ctx, '2020-01-01', '掌握抽样方法');
  const run = cli(ctx, 'begin');
  draft(run, cli(ctx, 'history'), { learning_question: '换个标题再讲一次？', learning_outcome: '掌握，抽样方法！' });
  const result = cli(ctx, 'publish', { 'run-id': run.run_id }, 1);
  assert.match(result.error, /学习成果与历史重复/);
  assert.equal(cli(ctx, 'history').total, 1);
});

test('同一来源回答不同问题可以发布，重访相同问题须关联旧简报', t => {
  const ctx = fixture(t);
  cli(ctx, 'init');
  const id = seedHistory(ctx, '2020-01-01');
  const run = cli(ctx, 'begin');
  draft(run, cli(ctx, 'history'), {
    learning_question: '2020-01-01 的学习问题是什么？',
    learning_outcome: '根据新的适用条件选择抽样策略', related_brief_ids: [id],
    new_learning_delta: '本次增加了约束变化下的策略选择',
  });
  assert.equal(cli(ctx, 'publish', { 'run-id': run.run_id }).status, 'succeeded');
  assert.equal(cli(ctx, 'history').total, 2);
});

test('重访相同问题未关联旧简报时拒绝发布', t => {
  const ctx = fixture(t);
  cli(ctx, 'init');
  seedHistory(ctx, '2020-01-01');
  const run = cli(ctx, 'begin');
  draft(run, cli(ctx, 'history'), { learning_question: '2020-01-01 的学习问题是什么？', learning_outcome: '新增的学习成果' });
  assert.match(cli(ctx, 'publish', { 'run-id': run.run_id }, 1).error, /关联旧简报/);
});

test('历史根目录丢失时停止，不静默创建空历史', t => {
  const ctx = fixture(t);
  cli(ctx, 'init');
  fs.renameSync(ctx.root, path.join(ctx.dir, '原历史目录'));
  const result = cli(ctx, 'begin', {}, 1);
  assert.equal(result.persisted, false);
  assert.match(result.error, /丢失/);
  assert.equal(fs.existsSync(ctx.root), false);
});

test('历史归档被删，即使索引也丢失，成功运行记录仍能阻止空历史继续', t => {
  const ctx = fixture(t);
  cli(ctx, 'init');
  const id = seedHistory(ctx, '2020-01-01');
  fs.renameSync(path.join(ctx.root, '2020', '01', id), path.join(ctx.dir, '移走的归档'));
  const result = cli(ctx, 'begin', {}, 1);
  assert.match(result.error, /归档丢失/);
  assert.equal(cli(ctx, 'history', {}, 1).persisted, false);
});

test('正文或附件损坏时停止，同日复用也不会绕过校验', t => {
  const ctx = fixture(t);
  cli(ctx, 'init');
  const run = cli(ctx, 'begin');
  draft(run, cli(ctx, 'history'));
  fs.writeFileSync(path.join(run.draft_dir, '逻辑图.svg'), '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  fs.writeFileSync(path.join(run.draft_dir, '逻辑图.mmd'), 'flowchart LR\nA-->B');
  fs.appendFileSync(path.join(run.draft_dir, 'brief.md'), '\n![逻辑图](逻辑图.svg)\n');
  const result = cli(ctx, 'publish', { 'run-id': run.run_id });
  const image = path.join(path.dirname(result.brief_path), '逻辑图.svg');
  fs.appendFileSync(image, 'changed');
  assert.match(cli(ctx, 'begin', {}, 1).error, /校验失败/);
});

test('越出草稿目录的图片引用被拒绝，外部文件不受影响', t => {
  const ctx = fixture(t);
  cli(ctx, 'init');
  const run = cli(ctx, 'begin');
  draft(run, cli(ctx, 'history'));
  const outside = path.join(ctx.dir, '外部.svg');
  fs.writeFileSync(outside, '保留外部图片');
  fs.appendFileSync(path.join(run.draft_dir, 'brief.md'), '\n![外部](../../../外部.svg)\n');
  assert.match(cli(ctx, 'publish', { 'run-id': run.run_id }, 1).error, /越过归档/);
  assert.equal(fs.readFileSync(outside, 'utf8'), '保留外部图片');
});

test('成功归档后中断可恢复索引和状态，不重复发布', t => {
  const ctx = fixture(t);
  cli(ctx, 'init');
  const run = cli(ctx, 'begin');
  draft(run, cli(ctx, 'history'));
  const published = cli(ctx, 'publish', { 'run-id': run.run_id });
  const savedRunFile = path.join(ctx.root, 'runs', `${run.run_id}.json`);
  write(savedRunFile, { ...read(savedRunFile), status: 'running' });
  write(path.join(ctx.root, '.lock'), { run_id: run.run_id, started_at: new Date().toISOString() });
  fs.unlinkSync(path.join(ctx.root, 'index.jsonl'));
  const recovered = cli(ctx, 'fail', { 'run-id': run.run_id, reason: '原调用已结束，恢复发布后的状态' });
  assert.equal(recovered.status, 'succeeded');
  assert.equal(recovered.brief_path, published.brief_path);
  assert.equal(fs.existsSync(path.join(ctx.root, '.lock')), false);
  assert.equal(cli(ctx, 'history').total, 1);
  assert.equal(cli(ctx, 'begin').status, 'reused');
});

test('反馈关联真实简报并影响后续快照，正文保持不变', t => {
  const ctx = fixture(t);
  cli(ctx, 'init');
  const id = seedHistory(ctx, '2020-01-01');
  const file = cli(ctx, 'history').entries[0].brief_path;
  const before = fs.readFileSync(file, 'utf8');
  const result = cli(ctx, 'feedback', { 'brief-id': id, text: '太浅，想继续研究边界' });
  assert.deepEqual(result.feedback.tags, ['太浅', '想继续']);
  const run = cli(ctx, 'begin');
  assert.equal(read(run.snapshot_path).feedback[0].brief_id, id);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  cli(ctx, 'fail', { 'run-id': run.run_id, reason: '反馈快照验证结束' });
});

test('错误运行标识不能释放其他运行的锁', t => {
  const ctx = fixture(t);
  cli(ctx, 'init');
  const run = cli(ctx, 'begin');
  cli(ctx, 'publish', { 'run-id': '00000000-0000-0000-0000-000000000000' }, 1);
  assert.equal(read(path.join(ctx.root, '.lock')).run_id, run.run_id);
  assert.equal(cli(ctx, 'begin').status, 'busy');
  cli(ctx, 'fail', { 'run-id': run.run_id, reason: '测试结束' });
});

test('创建锁后尚未写入运行文件的中断也能明确恢复', t => {
  const ctx = fixture(t);
  cli(ctx, 'init');
  const run = cli(ctx, 'begin');
  fs.unlinkSync(path.join(ctx.root, 'runs', `${run.run_id}.json`));
  const result = cli(ctx, 'fail', { 'run-id': run.run_id, reason: '已确认原调用结束' });
  assert.equal(result.status, 'failed');
  assert.equal(result.persisted, true);
  assert.equal(fs.existsSync(path.join(ctx.root, '.lock')), false);
});

test('所有候选被拒绝时，失败记录保留取舍摘要', t => {
  const ctx = fixture(t);
  cli(ctx, 'init');
  const run = cli(ctx, 'begin');
  const candidates = [{ question: '重复的问题', decision: 'rejected', reason: '历史已经覆盖相同结论' }];
  write(path.join(run.draft_dir, 'record.json'), { candidate_reviews: candidates });
  cli(ctx, 'fail', { 'run-id': run.run_id, reason: '无合格新题' });
  assert.deepEqual(read(path.join(ctx.root, 'runs', `${run.run_id}.json`)).candidate_reviews, candidates);
});
