#!/usr/bin/env node
/**
 * 一键上传插件。
 *
 * 你只管把插件写在自己的目录里（里面有 `plugin.json`），剩下的交给它：
 *
 *   1. 递归收集文件 → 打成 zip（固定时间戳，同样的源码永远得到同样的字节）
 *   2. 算 sha256
 *   3. 写到 `modules/<id>/<id>-<version>.zip`
 *   4. 生成/更新 `modules/<id>/module.json`（保留你手写过的其它字段）
 *   5. 跑一遍 `scripts/validate.mjs` 自检（含「sha256 和 zip 实际内容是否一致」）
 *   6. `git add` + `git commit`，并打印提 PR 的下一步
 *
 * 用法（在仓库根目录、或任意位置用绝对路径都行）：
 *
 *   node scripts/upload-plugin.mjs ../我的插件
 *   node scripts/upload-plugin.mjs ../我的插件 --dry-run          # 只看会做什么
 *   node scripts/upload-plugin.mjs ../我的插件 --no-git           # 只生成文件，不提交
 *   node scripts/upload-plugin.mjs ../我的插件 --author 张三 --homepage https://example.com
 *
 * 退出码：0 = 成功（或无需改动）；1 = 出错。
 */

import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { makeZip } from './lib/zip.mjs';

const ROOT = resolve(join(dirname(fileURLToPath(import.meta.url)), '..'));
const MODULES = join(ROOT, 'modules');

// 和客户端的解压闸门保持一致（PluginStore 里是 16MB 单文件 / 64MB 总量）
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;

const ID_RE = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const VERSION_RE = /^\d+\.\d+\.\d+$/;

/* ------------------------------------------------------------------ 参数 */

function usage(code = 0) {
  const text = `
一键上传 Cncp 插件

  node scripts/upload-plugin.mjs <插件目录> [选项]

必填
  <插件目录>              内含 plugin.json 的目录

选项
  --dry-run               只报告会做什么，不写文件、不提交
  --no-git                生成文件但不 git add / commit
  --force                 允许覆盖已存在的同一版本（内容变了却不想升版本号时才用）
  --author <名字>         覆盖 module.json 的 author
  --description <文字>    覆盖 module.json 的 description
  --homepage <https 地址> 插件主页
  --source <https 地址>   源码地址（默认留空）
  --license <许可证>      例如 MIT
  --category <分类>       可重复，例如 --category 工具 --category 网络
  --min-host-version <x.y.z>  要求的最低客户端版本（默认取 plugin.json 里的值）
  -h, --help              显示这段帮助

它做的事：打 zip → 算 sha256 → 写 modules/<id>/ → 生成 module.json → 自检 → git 提交。
`;
  console.log(text);
  process.exit(code);
}

const argv = process.argv.slice(2);
if (argv.length === 0 || argv.includes('-h') || argv.includes('--help')) usage(argv.length === 0 ? 1 : 0);

const opts = {
  dir: null,
  dryRun: false,
  noGit: false,
  force: false,
  author: null,
  description: null,
  homepage: null,
  source: null,
  license: null,
  categories: [],
  minHostVersion: null,
};

for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  const next = () => {
    const v = argv[++i];
    if (v === undefined) fail(`参数 ${a} 后面少了值`);
    return v;
  };
  switch (a) {
    case '--dry-run': opts.dryRun = true; break;
    case '--no-git': opts.noGit = true; break;
    case '--force': opts.force = true; break;
    case '--author': opts.author = next(); break;
    case '--description': opts.description = next(); break;
    case '--homepage': opts.homepage = next(); break;
    case '--source': opts.source = next(); break;
    case '--license': opts.license = next(); break;
    case '--category': opts.categories.push(next()); break;
    case '--min-host-version': opts.minHostVersion = next(); break;
    default:
      if (a.startsWith('-')) fail(`不认识的参数：${a}（-h 看帮助）`);
      if (opts.dir) fail(`只接受一个插件目录，多给了：${a}`);
      opts.dir = a;
  }
}

if (!opts.dir) fail('缺少插件目录（-h 看帮助）');

/* ------------------------------------------------------------------ 工具 */

function fail(msg, code = 1) {
  console.error(`\n✗ ${msg}\n`);
  process.exit(code);
}

function info(msg) {
  console.log(`  ${msg}`);
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

function rel(p) {
  return relative(ROOT, p).split(sep).join('/');
}

/** 这些文件/目录不进插件包。 */
function shouldSkip(name) {
  const lower = name.toLowerCase();
  if (lower === '.git' || lower === '.svn' || lower === '.hg') return true;
  if (lower === '__pycache__' || lower === 'node_modules' || lower === '.venv' || lower === 'venv') return true;
  if (lower === '.vscode' || lower === '.idea' || lower === '.gradle') return true;
  if (lower === '.ds_store' || lower === 'thumbs.db' || lower === 'desktop.ini') return true;
  if (lower.endsWith('.pyc') || lower.endsWith('.pyo')) return true;
  return false;
}

/** 递归收集文件，返回 [{ name, data }]，name 用 / 分隔、相对插件目录根。 */
async function collect(dir, prefix, out, depth = 0) {
  if (depth > 12) fail(`目录嵌套太深，放弃：${dir}`);
  const entries = (await readdir(dir, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  let total = 0;
  for (const e of entries) {
    if (shouldSkip(e.name)) continue;
    const abs = join(dir, e.name);
    const name = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) {
      total += await collect(abs, name, out, depth + 1);
      continue;
    }
    if (!e.isFile()) continue; // 符号链接之类，一律跳过
    const st = await stat(abs);
    if (st.size > MAX_FILE_BYTES) fail(`文件太大：${name}（${(st.size / 1048576).toFixed(1)} MB，上限 16 MB）`);
    out.push({ name, data: await readFile(abs) });
    total += st.size;
    if (total > MAX_TOTAL_BYTES) fail('插件总大小超过 64 MB');
  }
  return total;
}

function pick(obj, ...keys) {
  for (const k of keys) {
    if (obj && obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k];
  }
  return undefined;
}

/* ------------------------------------------------------------------ 读清单 */

const srcDir = resolve(opts.dir);
if (!existsSync(srcDir)) fail(`目录不存在：${srcDir}`);

const manifestPath = join(srcDir, 'plugin.json');
if (!existsSync(manifestPath)) {
  fail(`没找到 ${join(opts.dir, 'plugin.json')} —— 插件清单必须放在插件目录的根上`);
}

let manifest;
try {
  manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
} catch (e) {
  fail(`plugin.json 不是合法 JSON：${e.message}`);
}

const id = String(pick(manifest, 'id') ?? dirname(manifestPath).split(sep).pop() ?? '').trim();
if (!ID_RE.test(id) || id.length < 6 || id.length > 64) {
  fail(`插件 id 不合法：${JSON.stringify(id)}\n  要求：小写字母/数字，用 . 或 - 分段，6–64 字符，例如 com.yourname.myplugin`);
}

const version = String(pick(manifest, 'version') ?? '').trim();
if (!VERSION_RE.test(version)) fail(`plugin.json 的 version 必须是 x.y.z，当前：${JSON.stringify(version)}`);

const name = String(pick(manifest, 'name') ?? id).trim();
if (!name) fail('缺少插件名（plugin.json 的 name）');
const description = String(opts.description ?? pick(manifest, 'description') ?? '').trim();
if (!description) fail('缺少插件描述（plugin.json 的 description，或用 --description 指定）');

const author = String(opts.author ?? pick(manifest, 'author') ?? '').trim();
if (!author) fail('缺少作者（plugin.json 的 author，或用 --author 指定）');

const homepage = String(opts.homepage ?? pick(manifest, 'homepage') ?? '').trim();
if (homepage && !/^https:\/\//.test(homepage)) fail(`homepage 必须是 https 地址：${homepage}`);
const source = String(opts.source ?? pick(manifest, 'source') ?? '').trim();
const license = String(opts.license ?? pick(manifest, 'license') ?? '').trim();
const minHostVersion = String(opts.minHostVersion ?? pick(manifest, 'minHostVersion', 'min_host_version') ?? '').trim();
if (minHostVersion && !VERSION_RE.test(minHostVersion)) fail(`minHostVersion 必须是 x.y.z：${minHostVersion}`);

let capabilities = pick(manifest, 'capabilities');
if (!Array.isArray(capabilities) || capabilities.length === 0) {
  // 清单里没显式声明就按功能块推断，省得开发者还要多填一遍
  const inferred = [];
  if (Array.isArray(manifest.actions) && manifest.actions.length) inferred.push('actions');
  if (Array.isArray(manifest.hooks) && manifest.hooks.length) inferred.push('hooks');
  if (Array.isArray(manifest.tasks) && manifest.tasks.length) inferred.push('tasks');
  capabilities = inferred;
}
if (!Array.isArray(capabilities) || capabilities.length === 0) {
  fail('拿不到插件能力声明：请给 plugin.json 加 "capabilities": ["actions"] 之类的数组\n  （可选值：actions / hooks / tasks / speedtester）');
}
capabilities = [...new Set(capabilities.map((c) => String(c).trim()).filter(Boolean))];

const categories = opts.categories.length ? opts.categories : Array.isArray(manifest.categories) ? manifest.categories : [];

/* ------------------------------------------------------------------ 打包 */

const files = [];
const totalBytes = await collect(srcDir, '', files);

if (files.length === 0) fail('插件目录里除了被忽略的文件以外什么都没收集到');
if (!files.some((f) => f.name === 'plugin.json')) fail('打出来的包里根目录没有 plugin.json');

const zipBuf = makeZip(files);
const digest = sha256(zipBuf);

const modDir = join(MODULES, id);
const zipName = `${id}-${version}.zip`;
const zipPath = join(modDir, zipName);
const modJsonPath = join(modDir, 'module.json');
const downloadPath = `modules/${id}/${zipName}`;

console.log(`\n插件：${name} (${id}) v${version}`);
console.log(`作者：${author}`);
console.log(`能力：${capabilities.join(', ')}`);
console.log(`文件：${files.length} 个，源 ${(totalBytes / 1024).toFixed(1)} KB → 包 ${(zipBuf.length / 1024).toFixed(1)} KB`);
console.log(`sha256：${digest}`);
console.log(`目标：${downloadPath}`);

/* ------------------------------------------------------------------ 同版本冲突 */

if (existsSync(zipPath) && !opts.force) {
  const old = sha256(await readFile(zipPath));
  if (old === digest) {
    console.log('\n✓ 这个版本的内容和已提交的完全一致，无需改动。');
    process.exit(0);
  }
  fail(
    `modules/${id}/${zipName} 已经存在，但内容不一样。\n` +
      `  同版本号不能换内容（客户端会认为装过了、不给你更新）。请先升 version，\n` +
      `  确实要覆盖就加 --force。`,
  );
}

if (opts.dryRun) {
  console.log('\n（--dry-run：到此为止，没有写任何文件）\n');
  process.exit(0);
}

/* ------------------------------------------------------------------ 写文件 */

await mkdir(modDir, { recursive: true });
await writeFile(zipPath, zipBuf);

let module = {};
if (existsSync(modJsonPath)) {
  try {
    module = JSON.parse(await readFile(modJsonPath, 'utf8'));
  } catch {
    module = {};
  }
}

// 保留开发者手写过的其它字段（notes、maintainers…），只覆盖下面这些
module = {
  ...module,
  id,
  name,
  version,
  description,
  author,
  ...(homepage ? { homepage } : {}),
  ...(source ? { source } : {}),
  ...(license ? { license } : {}),
  ...(categories.length ? { categories } : {}),
  capabilities,
  ...(minHostVersion ? { minHostVersion } : {}),
  downloadPath,
  sha256: digest,
};
// 固定字段顺序，减少无意义的 diff
const ORDER = [
  'id',
  'name',
  'version',
  'description',
  'author',
  'homepage',
  'source',
  'license',
  'categories',
  'capabilities',
  'minHostVersion',
  'downloadPath',
  'sha256',
];
const ordered = {};
for (const k of ORDER) if (module[k] !== undefined) ordered[k] = module[k];
for (const k of Object.keys(module)) if (!(k in ordered)) ordered[k] = module[k];

await writeFile(modJsonPath, JSON.stringify(ordered, null, 2) + '\n', 'utf8');
console.log(`\n已写入：`);
console.log(`  ${downloadPath}`);
console.log(`  modules/${id}/module.json`);

/* ------------------------------------------------------------------ 自检 */

console.log('\n自检（scripts/validate.mjs）：');
const v = spawnSync(process.execPath, [join(ROOT, 'scripts', 'validate.mjs')], { cwd: ROOT, stdio: 'inherit' });
if (v.status !== 0) fail('自检没过，上面的错误改掉再跑一次');

// 索引也顺手重建一次，让本地 index.json 和 modules/ 保持一致
const b = spawnSync(process.execPath, [join(ROOT, 'scripts', 'build-index.mjs')], { cwd: ROOT, stdio: 'inherit' });
if (b.status !== 0) fail('生成索引失败，见上面的输出');

/* ------------------------------------------------------------------ 提交 */

if (opts.noGit) {
  console.log('\n（--no-git：文件已就绪，但没有提交）');
  console.log('  下一步：git add modules/ index.json cncp-source.json && git commit，然后提 PR\n');
  process.exit(0);
}

const gitCheck = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: ROOT, encoding: 'utf8' });
if (gitCheck.status !== 0) {
  console.log('\n这个仓库还不属于任何 git 仓库（或者没装 git），文件已经生成好了。');
  console.log('  下一步：按 README 的「怎么提交」把 modules/ 传上去即可。\n');
  process.exit(0);
}

const commitMsg = `新增插件：${name} v${version}\n\n- id: ${id}\n- 作者: ${author}\n- 能力: ${capabilities.join(', ')}\n- 包: ${downloadPath}\n- sha256: ${digest}\n`;
const msgFile = join(tmpdir(), `cncp-plugin-commit-${process.pid}.txt`);
await writeFile(msgFile, commitMsg, 'utf8');

const add = spawnSync('git', ['add', `modules/${id}`, 'index.json', 'cncp-source.json'], { cwd: ROOT, stdio: 'inherit' });
if (add.status !== 0) fail('git add 失败');

// 已经没有任何改动（比如只重建了索引）就别硬提交
const staged = spawnSync('git', ['diff', '--cached', '--quiet'], { cwd: ROOT });
if (staged.status === 0) {
  console.log('\n✓ 没有需要提交的改动（索引已经是最新的）。\n');
  process.exit(0);
}

const commit = spawnSync('git', ['commit', '-F', msgFile], { cwd: ROOT, stdio: 'inherit' });
if (commit.status !== 0) fail('git commit 失败（可能是没配置 user.name / user.email）');

console.log(`
✓ 已提交。

下一步（把提交推到你自己 fork 的仓库，再开 PR）：

  git push origin <你的分支名>
  # 装过 GitHub CLI 的话，直接：
  gh pr create --fill

没装 gh 就去网页开 PR：仓库页 → Pull requests → New pull request。
PR 里会自动跑「校验插件清单」，绿了就能合并；合并后索引和站点自动重建。
`);
