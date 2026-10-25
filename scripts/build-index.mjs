#!/usr/bin/env node
/**
 * 把 modules/<id>/module.json 汇总成两份索引：
 *
 *   index.json        给本站页面和第三方工具用，插件在 modules 数组里
 *   cncp-source.json  给 Cncp 客户端直接「填一个源地址」用，插件在 plugins 数组里，
 *                     字段名与官方仓库（cncp-plugins）的 index.json 完全一致
 *
 * 用法：
 *   node scripts/build-index.mjs
 *   node scripts/build-index.mjs --plugins-base https://raw.githubusercontent.com/me/cncp-plugins/main
 *
 * 环境变量（优先级低于命令行参数）：
 *   PLUGINS_BASE  插件包所在的前缀地址
 *   PLUGINS_REPO  owner/repo，配合默认的 raw.githubusercontent.com 生成 PLUGINS_BASE
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const modulesDir = join(root, 'modules');

function argValue(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const pluginsRepo = process.env.PLUGINS_REPO || 'Char0n111/cncp-plugins';

/**
 * 插件包所在的前缀地址（社区插件的包都放在官方仓库 cncp-plugins 的 packages/ 下）。
 *
 * 默认**不走** raw.githubusercontent.com 直连：国内大多数网络连不上（实测超时），
 * 而客户端拿到 url 之后是照着下载的，直连地址等于「索引能看、包装不上」。
 * 换成 ghproxy 这类前缀代理后，url 长这样：
 *   https://ghproxy.net/https://raw.githubusercontent.com/<owner>/<repo>/main/packages/x.zip
 * 索引和包都能通（实测 sha256 对得上）。
 *
 * 想换回直连：`--plugins-base https://raw.githubusercontent.com/<owner>/<repo>/main`，
 * 或者把仓库变量 PLUGINS_BASE 设成想要的前缀。
 */
const pluginsBase = (
  argValue('--plugins-base') ||
  process.env.PLUGINS_BASE ||
  `https://ghproxy.net/https://raw.githubusercontent.com/${pluginsRepo}/main`
).replace(/\/+$/, '');

if (!/^https?:\/\//.test(pluginsBase)) {
  console.warn('[提醒] 插件包前缀不是一个 http(s) 地址：' + pluginsBase);
  console.warn('       用 --plugins-base 或环境变量 PLUGINS_BASE 指定，例如');
  console.warn('       https://ghproxy.net/https://raw.githubusercontent.com/Char0n111/cncp-plugins/main');
  console.warn('');
}

/**
 * 本仓库自己的前缀：`downloadPath` 以 `modules/` 开头的插件，包就放在本仓库里
 * （第三方开发者的标准做法，`scripts/upload-plugin.mjs` 生成的就是这种）。
 * 默认同样走 ghproxy —— 客户端下载不下来等于没上传。
 */
const selfRepo = process.env.SELF_REPO || 'Char0n111/cncp-Unofficial-Plugin';
const selfBase = (
  argValue('--self-base') ||
  process.env.SELF_BASE ||
  `https://ghproxy.net/https://raw.githubusercontent.com/${selfRepo}/main`
).replace(/\/+$/, '');

/**
 * downloadPath / downloadUrl → 客户端能直接下载的绝对地址。
 *
 *   · `downloadUrl` 给了绝对地址        → 用它
 *   · `downloadPath` 本身就是 http(s)   → 用它
 *   · `downloadPath` 以 `modules/` 开头 → 包在本仓库，拼 selfBase
 *   · 其它（`packages/x.zip`）          → 包在官方仓库 cncp-plugins，拼 pluginsBase
 */
function resolveDownload(m) {
  const p = String(m.downloadUrl ?? m.downloadPath ?? '')
    .trim()
    .replace(/^\/+/, '');
  if (/^https?:\/\//.test(p)) return p;
  if (p.startsWith('modules/')) return `${selfBase}/${p}`;
  return `${pluginsBase}/${p}`;
}

const dirs = (await readdir(modulesDir, { withFileTypes: true }))
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

const modules = [];
for (const dirName of dirs) {
  let m;
  try {
    m = JSON.parse(await readFile(join(modulesDir, dirName, 'module.json'), 'utf8'));
  } catch (e) {
    console.error(`跳过 modules/${dirName}：${e.message}`);
    continue;
  }

  const download = resolveDownload(m);

  modules.push({
    id: m.id,
    name: m.name,
    version: m.version,
    description: m.description,
    author: m.author,
    homepage: m.homepage ?? '',
    source: m.source ?? '',
    license: m.license ?? '',
    categories: Array.isArray(m.categories) ? m.categories : [],
    capabilities: Array.isArray(m.capabilities) ? m.capabilities : [],
    minHostVersion: m.minHostVersion ?? '',
    download,
    sha256: String(m.sha256).toLowerCase(),
  });
}

modules.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));

const updated = new Date().toISOString().slice(0, 10);

const repoIndex = {
  schemaVersion: 1,
  name: 'Cncp 第三方插件仓库',
  updated,
  count: modules.length,
  modules,
};

// 客户端格式：字段名与 cncp-plugins/index.json 一致，这样同一个客户端代码能直接读两个源。
const clientSource = {
  schemaVersion: 1,
  name: 'Cncp 第三方插件仓库',
  updated,
  plugins: modules.map((m) => ({
    id: m.id,
    name: m.name,
    version: m.version,
    description: m.description,
    author: m.author,
    homepage: m.homepage,
    url: m.download,
    sha256: m.sha256,
    capabilities: m.capabilities,
  })),
};

const write = (file, obj) => writeFile(join(root, file), JSON.stringify(obj, null, 2) + '\n', 'utf8');

await write('index.json', repoIndex);
await write('cncp-source.json', clientSource);

console.log(`已生成 index.json / cncp-source.json：${modules.length} 个插件`);
console.log(`官方仓库包前缀：${pluginsBase}`);
console.log(`本仓库包前缀：${selfBase}`);
for (const m of modules) console.log(`  · ${m.id}@${m.version}  ${m.name}`);
