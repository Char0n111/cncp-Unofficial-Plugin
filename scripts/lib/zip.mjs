/**
 * 最小的 ZIP 打包器（只用 Node 标准库，零依赖、跨平台）。
 *
 * 为什么不直接调系统命令：
 *   · Windows 有 `tar.exe`（bsdtar）支持 `-a -c -f x.zip`，但 Linux 的 GNU tar 不支持 `-a`；
 *   · `zip` 命令在 macOS/Linux 常见，Windows 默认没有；
 *   · PowerShell 的 `Compress-Archive` 在 Linux/macOS 上不存在。
 * 一条命令覆盖不了三个平台，所以干脆自己写：deflate 用 `zlib.deflateRawSync`，
 * 容器格式（local header / central directory / EOCD）按 PKWARE APPNOTE 手搓。
 *
 * 只实现插件包需要的那一小块：不加 zip64、不用 data descriptor、不加密、不做目录项
 * （客户端是流式解压，空目录没有意义）。
 */

import { deflateRawSync } from 'node:zlib';

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

/** 标准 CRC-32（PNG/ZIP 用的那个多项式），返回无符号 32 位。 */
export function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

// 固定的 DOS 时间戳（1980-01-01 00:00）。用固定值是为了让**同样的源文件打出来的 zip
// 字节完全一致** —— 否则每次打包 sha256 都变，索引跟着变，PR diff 一片红。
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;

/**
 * 打一个 zip。
 *
 * @param {{name: string, data: Buffer|string}[]} entries 条目（name 用 `/` 分隔，别再带前导 ./）
 * @returns {Buffer}
 */
export function makeZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data);

    const crc = crc32(data);
    let method = 8; // deflate
    let payload = deflateRawSync(data, { level: 9 });
    if (payload.length >= data.length) {
      // 压不动（小文件常见）就直接存原文，省得反而变大
      method = 0;
      payload = data;
    }

    const local = Buffer.alloc(30);
    local.writeUInt32LE(SIG_LOCAL, 0);
    local.writeUInt16LE(20, 4); // 解压所需版本 2.0
    local.writeUInt16LE(0x0800, 6); // bit 11：文件名是 UTF-8
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra 长度

    const central = Buffer.alloc(46);
    central.writeUInt32LE(SIG_CENTRAL, 0);
    central.writeUInt16LE((3 << 8) | 20, 4); // made by: unix(3) / 2.0
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // 起始磁盘号
    central.writeUInt16LE(0, 36); // 内部属性
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38); // 外部属性：普通文件 0644
    central.writeUInt32LE(offset, 42);

    locals.push(local, nameBuf, payload);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + payload.length;
  }

  const centralBuf = Buffer.concat(centrals);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(SIG_EOCD, 0);
  eocd.writeUInt16LE(0, 4); // 本磁盘号
  eocd.writeUInt16LE(0, 6); // 中央目录起始磁盘号
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20); // 注释长度

  return Buffer.concat([...locals, centralBuf, eocd]);
}
