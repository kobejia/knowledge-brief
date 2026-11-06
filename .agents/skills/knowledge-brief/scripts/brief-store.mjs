import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const skillDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const version = '1.0.0';
const timezone = 'Asia/Shanghai';
const configKeys = ['keywords', 'description', 'style', 'source', 'output_dir', 'template'];
const defaults = {
  description: '',
  style: '准确、简洁、通俗易懂，用具体例子解释，区分事实、观点与推断。',
  source: '优先原始研究、权威机构资料和可信的一手实践，关键结论追溯原始资料，排除纯营销内容。',
  output_dir: './briefs',
  template: './brief-template.md',
};
const hash = value => createHash('sha256').update(value).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const check = (condition, message) => { if (!condition) throw new Error(message); };
const text = value => typeof value === 'string' && value.trim().length > 0;
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const now = () => new Date().toISOString();
const dateAt = instant => new Intl.DateTimeFormat('en-CA', {
  timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date(instant));
const dayPath = (root, date) => path.join(root, date.slice(0, 4), date.slice(5, 7), date);
const runPath = (root, id) => path.join(root, 'runs', `${id}.json`);
const validId = id => typeof id === 'string' && /^[0-9a-f-]{36}$/.test(id);
const normalize = value => value.normalize('NFKC').replace(/[\p{P}\p{Z}\s]/gu, '').toLowerCase();
let active;

function atomic(file, value) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, value, { flag: 'wx' });
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function configAt(configFile, initializing = false) {
  check(text(configFile), '缺少 --config 配置路径');
  const configPath = path.resolve(configFile);
  const input = readJson(configPath);
  check(input && typeof input === 'object' && !Array.isArray(input), '配置必须为 JSON 对象');
  check(Object.keys(input).every(key => configKeys.includes(key)), '配置只支持六项：' + configKeys.join(', '));
  if (!initializing) check(configKeys.every(key => Object.hasOwn(input, key)), '配置未初始化，请先执行 init');
  const config = { keywords: input.keywords, ...defaults, ...input };
  check(Array.isArray(config.keywords) && config.keywords.length > 0 && config.keywords.every(text), 'keywords 必须为非空字符串数组');
  for (const key of configKeys.slice(1)) check(typeof config[key] === 'string', `${key} 必须为字符串`);
  for (const key of ['style', 'source', 'output_dir', 'template']) check(text(config[key]), `${key} 不能为空`);
  const base = path.dirname(configPath);
  const root = path.resolve(base, config.output_dir);
  return { configPath, config, root, templatePath: path.resolve(base, config.template) };
}

function storeAt(configFile) {
  const ctx = configAt(configFile);
  check(fs.existsSync(path.join(ctx.root, '.store.json')), '历史目录未初始化或已丢失；请确认原目录，不能自动重建空历史');
  ctx.root = fs.realpathSync(ctx.root);
  check(readJson(path.join(ctx.root, '.store.json')).version === 1, '不支持的历史存储格式');
  for (const directory of ['runs', '.drafts']) check(fs.statSync(path.join(ctx.root, directory)).isDirectory(), `历史内部目录缺失：${directory}`);
  return ctx;
}

function initialize(configFile) {
  const ctx = configAt(configFile, true);
  const marker = path.join(ctx.root, '.store.json');
  if (fs.existsSync(ctx.root) && !fs.existsSync(marker)) {
    check(fs.readdirSync(ctx.root).length === 0, '输出目录非空且未初始化，拒绝接管已有内容');
  }
  if (!fs.existsSync(ctx.templatePath)) {
    check(ctx.templatePath === path.join(path.dirname(ctx.configPath), 'brief-template.md'), '指定的自定义模板不存在');
    fs.copyFileSync(path.join(skillDir, 'references', 'brief-template.md'), ctx.templatePath, fs.constants.COPYFILE_EXCL);
  }
  check(text(fs.readFileSync(ctx.templatePath, 'utf8')), '模板不能为空');
  fs.mkdirSync(ctx.root, { recursive: true });
  for (const directory of ['runs', '.drafts']) fs.mkdirSync(path.join(ctx.root, directory), { recursive: true });
  if (!fs.existsSync(marker)) fs.writeFileSync(marker, json({ version: 1, initialized_at: now() }), { flag: 'wx' });
  check(readJson(marker).version === 1, '不支持的历史存储格式');
  atomic(ctx.configPath, json(ctx.config));
  const initialized = storeAt(ctx.configPath);
  const history = loadHistory(initialized);
  return { status: 'initialized', config_path: ctx.configPath, output_dir: initialized.root, template_path: ctx.templatePath, history_count: history.entries.length };
}

function child(root, relative) {
  check(text(relative) && !relative.includes('\\') && !path.isAbsolute(relative), '附件路径必须为目录内的相对路径');
  const file = path.resolve(root, relative);
  check(file.startsWith(`${root}${path.sep}`), '附件路径越过归档目录');
  return file;
}

function filesAt(root, relative = '') {
  const files = [];
  for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
    check(!entry.isSymbolicLink(), '归档中不允许符号链接');
    const name = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...filesAt(root, name));
    else {
      check(entry.isFile(), '归档中只允许普通文件');
      files.push(name);
    }
  }
  return files.sort();
}

function bundleAt(root, date) {
  const directory = dayPath(root, date);
  const record = readJson(path.join(directory, 'record.json'));
  check(record.brief_id === date && record.business_date === date && record.timezone === timezone, `归档日期不一致：${date}`);
  check(validId(record.run_id) && text(record.learning_question) && text(record.learning_outcome), `归档元数据损坏：${date}`);
  const files = filesAt(directory).filter(file => file !== 'record.json');
  check(record.file_checksums && JSON.stringify(Object.keys(record.file_checksums).sort()) === JSON.stringify(files), `归档文件缺失或新增：${date}`);
  for (const file of files) check(hash(fs.readFileSync(child(directory, file))) === record.file_checksums[file], `归档文件校验失败：${date}/${file}`);
  check(record.content_hash === record.file_checksums['brief.md'], `正文校验记录不一致：${date}`);
  return { record, directory, brief_path: path.join(directory, 'brief.md'), record_hash: hash(fs.readFileSync(path.join(directory, 'record.json'))) };
}

function loadHistory(ctx, repair = false) {
  const bundles = [];
  for (const year of fs.readdirSync(ctx.root, { withFileTypes: true }).filter(entry => /^\d{4}$/.test(entry.name))) {
    check(year.isDirectory() && !year.isSymbolicLink(), '历史年份目录损坏');
    for (const month of fs.readdirSync(path.join(ctx.root, year.name), { withFileTypes: true })) {
      check(month.isDirectory() && !month.isSymbolicLink() && /^(0[1-9]|1[0-2])$/.test(month.name), '历史月份目录损坏');
      for (const day of fs.readdirSync(path.join(ctx.root, year.name, month.name), { withFileTypes: true })) {
        check(day.isDirectory() && !day.isSymbolicLink() && /^\d{4}-\d{2}-\d{2}$/.test(day.name) && day.name.startsWith(`${year.name}-${month.name}-`), '历史日期目录损坏');
        bundles.push(bundleAt(ctx.root, day.name));
      }
    }
  }
  bundles.sort((a, b) => a.record.brief_id.localeCompare(b.record.brief_id));
  const ids = new Set(bundles.map(bundle => bundle.record.brief_id));
  const indexFile = path.join(ctx.root, 'index.jsonl');
  let oldIndex = [];
  if (fs.existsSync(indexFile)) {
    try { oldIndex = fs.readFileSync(indexFile, 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)); }
    catch { /* 索引可从完整归档与运行记录重建。 */ }
  }
  for (const entry of oldIndex) check(ids.has(entry.brief_id), `已索引的历史归档丢失：${entry.brief_id}`);
  for (const file of fs.readdirSync(path.join(ctx.root, 'runs')).filter(file => file.endsWith('.json'))) {
    const run = readJson(path.join(ctx.root, 'runs', file));
    if (run.status === 'succeeded' || run.status === 'reused') check(ids.has(run.business_date), `成功运行对应的归档丢失：${run.business_date}`);
  }
  const entries = bundles.map(bundle => {
    const r = bundle.record;
    const previous = oldIndex.find(entry => entry.brief_id === r.brief_id);
    if (previous?.record_hash) check(previous.record_hash === bundle.record_hash, `历史元数据与索引不一致：${r.brief_id}`);
    return {
      brief_id: r.brief_id, topic: r.topic, learning_question: r.learning_question,
      learning_outcome: r.learning_outcome, key_claims: r.key_claims,
      new_learning_delta: r.new_learning_delta, related_brief_ids: r.related_brief_ids,
      sources: r.sources, brief_path: bundle.brief_path, record_hash: bundle.record_hash,
    };
  });
  const serialized = entries.map(entry => JSON.stringify(entry)).join('\n') + (entries.length ? '\n' : '');
  if (repair && (!fs.existsSync(indexFile) || fs.readFileSync(indexFile, 'utf8') !== serialized)) atomic(indexFile, serialized);
  return { entries, bundles, digest: hash(JSON.stringify(entries)) };
}

function createLock(ctx, run) {
  try {
    fs.writeFileSync(path.join(ctx.root, '.lock'), json({ run_id: run.run_id, started_at: run.started_at }), { flag: 'wx' });
    return true;
  } catch (error) {
    if (error.code === 'EEXIST') return false;
    throw error;
  }
}

function release(ctx, id) {
  const file = path.join(ctx.root, '.lock');
  if (fs.existsSync(file) && readJson(file).run_id === id) fs.unlinkSync(file);
}

function reuse(ctx, history, date) {
  const entry = history.entries.find(item => item.brief_id === date);
  const run = { run_id: randomUUID(), status: 'reused', business_date: date, started_at: now(), finished_at: now(), brief_path: entry.brief_path };
  fs.writeFileSync(runPath(ctx.root, run.run_id), json(run), { flag: 'wx' });
  return { status: 'reused', brief_id: date, brief_path: entry.brief_path, persisted: true };
}

function begin(configFile) {
  const ctx = storeAt(configFile);
  const run = { run_id: randomUUID(), status: 'running', started_at: now() };
  run.business_date = dateAt(run.started_at);
  if (!createLock(ctx, run)) {
    const lock = readJson(path.join(ctx.root, '.lock'));
    const history = loadHistory(ctx);
    if (history.entries.some(entry => entry.brief_id === run.business_date)) return reuse(ctx, history, run.business_date);
    return { status: 'busy', ...lock };
  }
  active = { ctx, run };
  fs.writeFileSync(runPath(ctx.root, run.run_id), json(run), { flag: 'wx' });
  const history = loadHistory(ctx, true);
  if (history.entries.some(entry => entry.brief_id === run.business_date)) {
    run.status = 'reused';
    run.finished_at = now();
    run.brief_path = history.entries.find(entry => entry.brief_id === run.business_date).brief_path;
    atomic(runPath(ctx.root, run.run_id), json(run));
    release(ctx, run.run_id);
    return { status: 'reused', brief_id: run.business_date, brief_path: run.brief_path, persisted: true };
  }
  const template = fs.readFileSync(ctx.templatePath, 'utf8');
  check(text(template), '模板不能为空');
  const feedbackFile = path.join(ctx.root, 'feedback.jsonl');
  const feedback = fs.existsSync(feedbackFile) ? fs.readFileSync(feedbackFile, 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)) : [];
  Object.assign(run, { config_snapshot: ctx.config, template_snapshot: template, template_path: ctx.templatePath, history_digest: history.digest, history_ids: history.entries.map(entry => entry.brief_id), feedback });
  atomic(runPath(ctx.root, run.run_id), json(run));
  const draft = path.join(ctx.root, '.drafts', run.run_id);
  fs.mkdirSync(draft);
  return { status: 'ready', run_id: run.run_id, business_date: run.business_date, draft_dir: draft, snapshot_path: runPath(ctx.root, run.run_id), history_count: history.entries.length, history_digest: history.digest };
}

function ownedRun(configFile, id) {
  check(validId(id), '无效的 --run-id');
  const ctx = storeAt(configFile);
  const lockFile = path.join(ctx.root, '.lock');
  let run;
  if (fs.existsSync(runPath(ctx.root, id))) run = readJson(runPath(ctx.root, id));
  else {
    const lock = readJson(lockFile);
    check(lock.run_id === id && text(lock.started_at), '找不到该运行，不能恢复其他运行的锁');
    run = { run_id: id, started_at: lock.started_at, business_date: dateAt(lock.started_at), status: 'running' };
  }
  check(run.run_id === id, '运行标识不一致');
  if (!fs.existsSync(path.join(ctx.root, '.lock'))) check(createLock(ctx, run), '无法获取运行锁');
  check(readJson(path.join(ctx.root, '.lock')).run_id === id, '当前锁属于其他运行，禁止接管');
  active = { ctx, run };
  return active;
}

function canonicalURL(raw) {
  const url = new URL(raw);
  check(['http:', 'https:'].includes(url.protocol) && !url.username && !url.password, '来源必须为不含凭据的 HTTP(S) 链接');
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) if (/^utm_/i.test(key) || ['gclid', 'fbclid', 'mc_cid', 'mc_eid'].includes(key.toLowerCase())) url.searchParams.delete(key);
  return url.href;
}

function validateDraft(record, body, history, run, draft) {
  for (const key of ['topic', 'learning_question', 'learning_outcome', 'new_learning_delta']) check(text(record[key]), `草稿缺少 ${key}`);
  check(text(body), '正文不能为空');
  check(Array.isArray(record.key_claims) && record.key_claims.length && record.key_claims.every(text), 'key_claims 必须为非空结论数组');
  check(['新进展', '经典知识'].includes(record.content_type), 'content_type 必须为新进展或经典知识');
  const ids = history.entries.map(entry => entry.brief_id);
  const review = record.dedup_review;
  check(review?.decision === 'pass' && text(review.rationale) && review.history_digest === run.history_digest && history.digest === run.history_digest, '去重依据缺失或历史已变化');
  check(Array.isArray(review.compared_brief_ids) && JSON.stringify([...review.compared_brief_ids].sort()) === JSON.stringify(ids), '必须比较全部历史简报');
  for (const list of [review.closest_brief_ids, record.related_brief_ids]) check(Array.isArray(list) && list.every(id => ids.includes(id)), '近似或关联简报必须存在于历史中');
  if (ids.length) check(review.closest_brief_ids.length > 0, '有历史时必须指出最相近简报');
  const candidates = record.candidate_reviews;
  check(Array.isArray(candidates) && candidates.length > 0 && candidates.length <= 5 && candidates.every(item => text(item.question) && text(item.reason) && ['selected', 'rejected'].includes(item.decision)) && candidates.filter(item => item.decision === 'selected').length === 1, '候选记录须有 1–5 项且恰有一个选中');
  check(Array.isArray(record.sources) && record.sources.length > 0, '至少需要一个实际阅读的来源');
  for (const source of record.sources) {
    check(text(source.title) && text(source.author) && text(source.url), '来源缺少标题、作者或链接');
    check(text(source.accessed_at) && Number.isFinite(Date.parse(source.accessed_at)), '来源缺少有效访问时间');
    check(source.published_at === null || (text(source.published_at) && Number.isFinite(Date.parse(source.published_at))), '来源发布日期未知时须填 null');
    check(source.version === null || text(source.version), '来源版本未知时须填 null');
    check(Array.isArray(source.supports) && source.supports.length > 0 && source.supports.every(claim => record.key_claims.includes(claim)), '来源须指明支撑的核心结论');
    canonicalURL(source.url);
  }
  for (const claim of record.key_claims) check(record.sources.some(source => source.supports.includes(claim)), '每条关键结论都必须有来源或推断依据');
  for (const bundle of history.bundles) {
    check(normalize(record.learning_outcome) !== normalize(bundle.record.learning_outcome), `学习成果与历史重复：${bundle.record.brief_id}`);
    check(hash(body) !== bundle.record.content_hash, `正文与历史完全相同：${bundle.record.brief_id}`);
    if (normalize(record.learning_question) === normalize(bundle.record.learning_question)) check(record.related_brief_ids.includes(bundle.record.brief_id), '重访相同问题必须关联旧简报并说明增量');
  }
  check(!/<img\b|!\[[^\]]*\]\[/i.test(body), '图片请用 Markdown 行内相对路径，便于完整归档');
  const images = [...body.matchAll(/!\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g)];
  check(images.length === [...body.matchAll(/!\[[^\]]*\]\(/g)].length, '图片路径格式无法核验，请使用简单行内路径或尖括号包围路径');
  for (const match of images) {
    const file = child(draft, decodeURIComponent(match[1] ?? match[2]));
    check(fs.existsSync(file) && fs.lstatSync(file).isFile(), '正文图片缺失或不是普通文件');
  }
}

function finishSuccess(ctx, run) {
  const bundle = bundleAt(ctx.root, run.business_date);
  check(bundle.record.run_id === run.run_id, '当天归档属于另一次运行');
  const warnings = [];
  try { loadHistory(ctx, true); } catch (error) { warnings.push(`索引待修复：${error.message}`); }
  Object.assign(run, { status: 'succeeded', finished_at: now(), brief_path: bundle.brief_path, candidate_reviews: bundle.record.candidate_reviews });
  try { atomic(runPath(ctx.root, run.run_id), json(run)); } catch (error) { warnings.push(`运行记录待修复：${error.message}`); }
  try { release(ctx, run.run_id); } catch (error) { warnings.push(`运行锁待释放：${error.message}`); }
  return { status: 'succeeded', brief_id: run.business_date, brief_path: bundle.brief_path, persisted: true, warnings };
}

function publish(configFile, id) {
  const { ctx, run } = ownedRun(configFile, id);
  if (fs.existsSync(dayPath(ctx.root, run.business_date))) return finishSuccess(ctx, run);
  check(run.status === 'running' && text(run.template_snapshot), '运行未就绪或已经结束');
  const history = loadHistory(ctx);
  const draft = path.join(ctx.root, '.drafts', id);
  const body = fs.readFileSync(path.join(draft, 'brief.md'), 'utf8');
  const input = readJson(path.join(draft, 'record.json'));
  validateDraft(input, body, history, run, draft);
  const fileChecksums = Object.fromEntries(filesAt(draft).filter(file => file !== 'record.json').map(file => [file, hash(fs.readFileSync(child(draft, file)))]));
  const record = {
    topic: input.topic, learning_question: input.learning_question, learning_outcome: input.learning_outcome,
    key_claims: input.key_claims, content_type: input.content_type, related_brief_ids: input.related_brief_ids,
    new_learning_delta: input.new_learning_delta, dedup_review: input.dedup_review,
    sources: input.sources.map(source => ({ ...source, canonical_url: canonicalURL(source.url) })),
    candidate_reviews: input.candidate_reviews, brief_id: run.business_date, business_date: run.business_date,
    timezone, run_id: id, generated_at: now(), config_snapshot: run.config_snapshot,
    template_snapshot: run.template_snapshot, skill_version: version, content_hash: hash(body), file_checksums: fileChecksums,
  };
  atomic(path.join(draft, 'record.json'), json(record));
  const destination = dayPath(ctx.root, run.business_date);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  check(!fs.existsSync(destination), '当天简报已经存在，禁止覆盖');
  fs.renameSync(draft, destination);
  return finishSuccess(ctx, run);
}

function failRun(ctx, run, reason) {
  if (fs.existsSync(dayPath(ctx.root, run.business_date))) {
    const bundle = bundleAt(ctx.root, run.business_date);
    if (bundle.record.run_id === run.run_id) return finishSuccess(ctx, run);
  }
  const draftRecord = path.join(ctx.root, '.drafts', run.run_id, 'record.json');
  if (fs.existsSync(draftRecord)) {
    try {
      const candidates = readJson(draftRecord).candidate_reviews;
      if (Array.isArray(candidates)) run.candidate_reviews = candidates;
    } catch { /* 损坏草稿不妨碍保存本轮失败原因。 */ }
  }
  Object.assign(run, { status: 'failed', finished_at: now(), error: reason });
  atomic(runPath(ctx.root, run.run_id), json(run));
  release(ctx, run.run_id);
  return { status: 'failed', run_id: run.run_id, error: reason, persisted: true };
}

function historyPage(configFile, options) {
  const ctx = storeAt(configFile);
  const lock = { run_id: randomUUID(), started_at: now() };
  const acquired = createLock(ctx, lock);
  try {
    const history = loadHistory(ctx, acquired);
    const offset = Number(options.offset ?? 0);
    const limit = Number(options.limit ?? 50);
    check(Number.isInteger(offset) && offset >= 0 && Number.isInteger(limit) && limit >= 1 && limit <= 500, '分页参数必须为非负 offset 和 1–500 的 limit');
    return { total: history.entries.length, history_digest: history.digest, entries: history.entries.slice(offset, offset + limit), next_offset: offset + limit < history.entries.length ? offset + limit : null };
  } finally { if (acquired) release(ctx, lock.run_id); }
}

function feedback(configFile, id, value) {
  const ctx = storeAt(configFile);
  check(/^\d{4}-\d{2}-\d{2}$/.test(id ?? '') && text(value), '反馈需要有效的 --brief-id 和非空 --text');
  bundleAt(ctx.root, id);
  const entry = { brief_id: id, created_at: now(), text: value, tags: ['太浅', '太深', '已掌握', '想继续'].filter(tag => value.includes(tag)) };
  const lock = { run_id: randomUUID(), started_at: now() };
  check(createLock(ctx, lock), '正在生成，请在本轮结束后记录反馈');
  try { fs.appendFileSync(path.join(ctx.root, 'feedback.jsonl'), `${JSON.stringify(entry)}\n`); }
  finally { release(ctx, lock.run_id); }
  return { status: 'recorded', feedback: entry, persisted: true };
}

function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === '--help') return { commands: ['init', 'begin', 'history', 'publish', 'fail', 'feedback'], usage: '见 references/store-contract.md；所有命令使用 --config <路径>' };
  const allowed = { init: [], begin: [], history: ['offset', 'limit'], publish: ['run-id'], fail: ['run-id', 'reason'], feedback: ['brief-id', 'text'] };
  check(Object.hasOwn(allowed, command), '未知命令');
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    check(args[i].startsWith('--') && i + 1 < args.length, '参数须为 --名称 值');
    const key = args[i].slice(2);
    check(['config', ...allowed[command]].includes(key) && !Object.hasOwn(options, key), `不支持或重复的参数：${key}`);
    options[key] = args[i + 1];
  }
  if (command === 'init') return initialize(options.config);
  if (command === 'begin') return begin(options.config);
  if (command === 'history') return historyPage(options.config, options);
  if (command === 'publish') return publish(options.config, options['run-id']);
  if (command === 'feedback') return feedback(options.config, options['brief-id'], options.text);
  check(text(options.reason), 'fail 需要非空 --reason');
  const { ctx, run } = ownedRun(options.config, options['run-id']);
  return failRun(ctx, run, options.reason);
}

try {
  console.log(json(main()).trimEnd());
} catch (error) {
  let result = { status: 'error', error: error.message, persisted: false };
  if (active) {
    try { result = failRun(active.ctx, active.run, error.message); }
    catch (savingError) { result.error += `；记录未落盘或未能完成恢复：${savingError.message}`; }
  }
  console.log(json(result).trimEnd());
  process.exitCode = result.status === 'succeeded' ? 0 : 1;
}
