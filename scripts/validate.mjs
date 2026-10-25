#!/usr/bin/env node
/**
 * 校验 modules/ 下的每一个 module.json。
 *
 * 为什么要有这个脚本：第三方仓库是「谁都能提 PR」的地方，一条格式写错的提交会让
 * 整份 index.json 生成失败，进而连带所有插件在客户端里消失。所以先在这里拦住。
 *
 * 用法：node scripts/validate.mjs
 * 退出码 0 = 全部通过；1 = 有错误（错误会逐条打印）。
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const modulesDir = join(root, 'modules');

const ID_RE = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const VERSION_RE = /^\d+\.\d+\.\d+$/;
const SHA_RE = /^[0-9a-f]{64}$/;

const sha256Hex = (buf) => createHash('sha256').update(buf).digest('hex');

const errors = [];
const warnings = [];
const seen = new Map();

const err = (file, msg) => errors.push(`${file}: ${msg}`);
const warn = (file, msg) => warnings.push(`${file}: ${msg}`);

function needString(obj, key, file, { min = 1, max = 200 } = {}) {
  const v = obj[key];
  if (typeof v !== 'string' || v.trim().length < min) {
    err(file, `缺少字符串字段 ${key}`);
    return null;
  }
  if (v.length > max) {
    err(file, `字段 ${key} 太长（${v.length} > ${max}）`);
    return null;
  }
  if (/[\u0000-\u001f]/.test(v)) {
    err(file, `字段 ${key} 含控制字符`);
    return null;
  }
  return v;
}

let entries;
try {
  entries = (await readdir(modulesDir, { withFileTypes: true }))
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
} catch (e) {
  console.error(`读不了 modules 目录：${e.message}`);
  process.exit(1);
}

if (entries.length === 0) err('modules/', '一个插件都没有');

for (const dirName of entries) {
  const file = `modules/${dirName}/module.json`;
  let raw;
  try {
    raw = await readFile(join(modulesDir, dirName, 'module.json'), 'utf8');
  } catch {
    err(file, '缺少 module.json');
    continue;
  }

  let m;
  try {
    m = JSON.parse(raw);
  } catch (e) {
    err(file, `JSON 解析失败：${e.message}`);
    continue;
  }
  if (!m || typeof m !== 'object' || Array.isArray(m)) {
    err(file, 'module.json 顶层必须是对象');
    continue;
  }

  const id = needString(m, 'id', file);
  if (id) {
    if (!ID_RE.test(id) || id.length < 6 || id.length > 64) {
      err(file, `id 不合法（小写字母/数字，用 . 或 - 分段，6–64 字符）：${id}`);
    }
    if (id !== dirName) err(file, `目录名必须等于 id：目录 ${dirName}，id ${id}`);
    if (seen.has(id)) err(file, `id 与 modules/${seen.get(id)} 重复`);
    else seen.set(id, dirName);
  }

  const version = needString(m, 'version', file);
  if (version && !VERSION_RE.test(version)) err(file, `version 必须是 x.y.z：${version}`);

  needString(m, 'name', file, { max: 60 });
  needString(m, 'description', file, { max: 300 });
  needString(m, 'author', file, { max: 60 });

  // downloadPath 有两种合法形态：
  //   modules/<id>/<id>-<version>.zip  → 包在本仓库里（第三方插件的标准做法，一键上传生成的就是它）
  //   packages/<文件名>.zip             → 包在官方仓库 cncp-plugins（只有官方示例这样放）
  const dl = needString(m, 'downloadPath', file, { max: 300 });
  const dlAbs = typeof m.downloadUrl === 'string' && /^https:\/\//.test(m.downloadUrl) ? m.downloadUrl : null;
  let localZip = null;
  if (dl) {
    if (dlAbs) {
      warn(file, `同时给了 downloadUrl（${dlAbs}），客户端会用它下载`);
    } else if (dl.startsWith('modules/')) {
      if (id && version) {
        if (dl !== `modules/${id}/${id}-${version}.zip`) {
          err(file, `downloadPath 必须是 modules/${id}/${id}-${version}.zip：${dl}`);
        } else {
          localZip = dl;
        }
      }
    } else if (!/^packages\/[^/]+\.zip$/.test(dl)) {
      err(
        file,
        `downloadPath 要么是 modules/<id>/<id>-<version>.zip（包在本仓库），` +
          `要么是 packages/<文件名>.zip（包在官方仓库）：${dl}`,
      );
    } else if (id && version && dl !== `packages/${id}-${version}.zip`) {
      err(file, `downloadPath 必须叫 packages/${id}-${version}.zip：${dl}`);
    }
  }

  const sha = needString(m, 'sha256', file, { max: 64 });
  const shaOk = !!sha && SHA_RE.test(sha);
  if (sha && !shaOk) err(file, `sha256 必须是 64 位小写十六进制：${sha}`);

  // 包在本仓库时，必须真的存在、真的对得上 —— 这是「一键上传」之外的第二道闸门：
  // 手工改 zip 忘了同步 sha256，客户端会拒装，这种错必须在 PR 阶段就拦住。
  if (localZip) {
    let buf = null;
    try {
      buf = await readFile(join(root, localZip));
    } catch {
      err(file, `downloadPath 指向的文件不存在：${localZip}（用 node scripts/upload-plugin.mjs 生成）`);
    }
    if (buf) {
      if (buf.length === 0) err(file, `${localZip} 是个空文件`);
      if (shaOk && sha256Hex(buf) !== sha) {
        err(file, `sha256 和 ${localZip} 的实际内容对不上（清单写的 ${sha}，实际 ${sha256Hex(buf)}）`);
      }
    }
  }

  if (!Array.isArray(m.capabilities) || m.capabilities.length === 0) {
    err(file, 'capabilities 必须是非空数组');
  } else {
    for (const c of m.capabilities) {
      if (typeof c !== 'string' || !/^[a-z][a-z0-9-]*$/.test(c)) {
        err(file, `capabilities 里的值不合法：${JSON.stringify(c)}`);
      }
    }
  }

  for (const key of ['homepage', 'source']) {
    if (m[key] === undefined || m[key] === '') continue;
    if (!/^https:\/\//.test(String(m[key]))) {
      if (key === 'homepage') err(file, 'homepage 必须是 https 地址');
      else warn(file, 'source 建议写 https 地址');
    }
  }

  if (m.minHostVersion !== undefined && !VERSION_RE.test(String(m.minHostVersion))) {
    err(file, `minHostVersion 必须是 x.y.z：${m.minHostVersion}`);
  }
  if (m.categories !== undefined) {
    if (!Array.isArray(m.categories)) err(file, 'categories 必须是数组');
    else for (const c of m.categories) if (typeof c !== 'string' || !c.trim()) err(file, 'categories 里的值必须是非空字符串');
  }
  if (m.license !== undefined && typeof m.license !== 'string') err(file, 'license 必须是字符串');
}

if (warnings.length) {
  console.log('提醒：');
  for (const w of warnings) console.log(`  · ${w}`);
  console.log('');
}

if (errors.length) {
  console.error(`校验失败：${errors.length} 个问题`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}

console.log(`校验通过：${entries.length} 个插件`);
for (const [id, dir] of seen) console.log(`  · ${id}  (modules/${dir})`);
