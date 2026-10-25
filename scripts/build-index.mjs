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
const pluginsBase = (
  argValue('--plugins-base') ||
  process.env.PLUGINS_BASE ||
  `https://raw.githubusercontent.com/${pluginsRepo}/main`
).replace(/\/+$/, '');

if (!/^https?:\/\//.test(pluginsBase)) {
  console.warn('[提醒] 插件包前缀不是一个 http(s) 地址：' + pluginsBase);
  console.warn('       用 --plugins-base 或环境变量 PLUGINS_BASE 指定，例如');
  console.warn('       https://raw.githubusercontent.com/Char0n111/cncp-plugins/main');
  console.warn('');
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

  const download = /^https?:\/\//.test(m.downloadPath)
    ? m.downloadPath
    : `${pluginsBase}/${String(m.downloadPath).replace(/^\/+/, '')}`;

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
  name: 'Cncp 插件聚合仓库',
  updated,
  count: modules.length,
  modules,
};

// 客户端格式：字段名与 cncp-plugins/index.json 一致，这样同一个客户端代码能直接读两个源。
const clientSource = {
  schemaVersion: 1,
  name: 'Cncp 插件聚合仓库',
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
console.log(`下载前缀：${pluginsBase}`);
for (const m of modules) console.log(`  · ${m.id}@${m.version}  ${m.name}`);
