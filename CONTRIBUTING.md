# 提交插件

欢迎提交。这个仓库只做一件事：把散落的 Cncp 插件聚到一个列表里，让用户填一个地址就能看见。

## 最省事的方式：一键上传

```bash
git clone https://github.com/<你的用户名>/cncp-Unofficial-Plugin
cd cncp-Unofficial-Plugin
git checkout -b add/myplugin

node scripts/upload-plugin.mjs ../我的插件     # 打 zip + 算 sha256 + 写 module.json + 自检 + commit

git push -u origin add/myplugin              # 然后去网页开 PR，或 gh pr create --fill
```

脚本会自动跳过 `__pycache__` / `*.pyc` / `node_modules` / `.git` / `.DS_Store` 等，并且直接拒绝两种情况：
「同一个版本号换内容」（客户端会认为装过了、不给你更新）和「`sha256` 与 zip 实际内容不符」。
常用参数 `--dry-run`（只看不写）、`--no-git`（不提交）、`--author/--homepage/--category`。细节见 README 的「一键上传（推荐）」。

## 提 PR 之前，请确认

- [ ] 目录名 = `module.json` 里的 `id`，且 id 全局唯一（建议用 `反向域名.名字`，例如 `com.yourname.ssh-tools`）
- [ ] `node scripts/validate.mjs` 本地跑过，0 错误
- [ ] `downloadPath` 指向的 zip 真的能下载，`sha256` 与 zip 一致
- [ ] zip 里是**插件本身**（`plugin.json` + 入口文件在压缩包根目录），不是外面又套一层文件夹
- [ ] 描述写清「这个插件解决什么问题」，不要写「强大」「神器」这类空话
- [ ] 代码里没有 `os.system` 之类的任意命令执行，没有把用户的订阅地址/账号密码往外传

## 审核看什么

1. **能装上、能跑起来**：sha256 对得上，`plugin.json` 里的 `minHostVersion` 不比当前客户端高太多（否则用户装上去也用不了）。
2. **不越界**：插件与客户端同权限运行（没有沙箱），所以任何试图读取/上传用户配置、节点、token 的行为直接拒绝。
3. **元数据老实**：`description` 与实际行为一致；`capabilities` 不要多报（没用到 hooks 就别写 `hooks`）。
4. **可维护**：给了 `source`，作者愿意跟进客户端新版本。

## 常见错误

| 提交后 CI 报 | 原因 | 怎么修 |
| --- | --- | --- |
| `目录名必须等于 id` | `modules/xxx/` 与 `"id"` 不一致 | 改目录名或改 id，别两边都改 |
| `downloadPath 必须形如 modules/<id>/<id>-<version>.zip` | 文件名没带版本，或版本号与 `version` 不同步 | 重跑 `node scripts/upload-plugin.mjs` 会自动生成正确路径 |
| `sha256 和 … 的实际内容对不上` | 换了 zip 没同步 `sha256`（手动提交最常见） | 重跑一键脚本，或 `sha256sum 包.zip` 重算后改清单 |
| `sha256 必须是 64 位小写十六进制` | 复制时带了大写或截断 | 全小写、64 位，别只贴前 16 位 |
| `version 必须是 x.y.z` | 写了 `1.0` 或 `v1.0.0` | 去掉 `v`，补成三段 |
| `capabilities 必须是非空数组` | 漏写或写成字符串 | 写成 `["hooks"]` 这种数组 |
| 本地报 `已经存在，但内容不一样` | 同版本号下改了代码 | 先升 `version` 再上传（真要在同版本覆盖才加 `--force`） |

## 更新已有插件

- 发布新版本：改代码后把 `plugin.json` 里的 `version` 升一下，再跑一次 `node scripts/upload-plugin.mjs ../我的插件`
  —— 它会打包成新的 `modules/<id>/<id>-<新版本>.zip`、更新 `sha256` 与 `downloadPath`，旧版本的 zip 留着不动（老客户端可能还在用）。
- 手动改元数据（作者、描述、首页等）：直接编辑 `modules/<id>/module.json`，跑 `node scripts/build-index.mjs`，PR 里只应有该文件与两份索引的改动。
- 改别人插件的元数据：单独开一个 PR 说明理由；作者失联超过 3 个月且插件已不可用，维护者可以接管或下架。

## 下架

在自己的 PR 里删掉 `modules/<id>/` 目录即可。已装在用户机器上的版本不会因此消失 —— 客户端以本地安装的为准。
