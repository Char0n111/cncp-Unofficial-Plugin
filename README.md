# Cncp 第三方插件仓库

类 LSPosed 模块仓库的玩法：**任何人**把自己的 Cncp 插件提一个 PR（`modules/<插件id>/module.json` + 一个能下载的 zip），自动校验通过后合并，站点和索引自动重建 —— 客户端只要填一次源地址，就能看到这里收录的全部社区插件。

> **两个仓库的分工（别弄错）**
>
> | 仓库 | 是什么 | 能不能第三方上传 |
> | --- | --- | --- |
> | [`cncp-plugins`](https://github.com/Char0n111/cncp-plugins) | **官方源**，官方维护的示例/内置插件 | **不能**，只收官方自己发的 |
> | 本仓库 | **第三方 / 社区源**，谁都能提 PR | **能**，走自动校验，不带人工审核 |
>
> 两个源在客户端里是并列的，可以同时用：官方源填官方地址，社区源填本仓库的 `cncp-source.json`。
> 本仓库**不会**把插件并进官方源 —— 进了官方源才算「官方插件」。

- 站点：`https://<你的用户名>.github.io/cncp-Unofficial-Plugin/`
- 索引（页面/工具用）：[`index.json`](index.json)
- 索引（**客户端直接填这个地址**）：`cncp-source.json`

官方示例插件的源码在 [cncp-plugins](https://github.com/Char0n111/cncp-plugins)；本仓库收录的是社区插件，以及它们的元数据。

## 为什么分两份索引

| 文件 | 谁在用 | 结构 |
| --- | --- | --- |
| `index.json` | 站点页面、第三方工具 | `{ schemaVersion, name, updated, count, modules: [...] }` |
| `cncp-source.json` | Cncp 客户端「插件源」 | `{ schemaVersion, name, updated, plugins: [{ id, name, version, description, author, homepage, url, sha256, capabilities }] }` |

`plugins` 数组的字段名与官方仓库 `cncp-plugins/index.json` 完全一致 —— 这样客户端一套代码能读两个源，不用为第三方仓库写特例。

## 一键上传（推荐）

把插件写在一个普通目录里（根上有 `plugin.json`），然后在本仓库根目录跑一条命令：

```bash
node scripts/upload-plugin.mjs ../我的插件
```

它一次做完这些事：

| 步骤 | 说明 |
| --- | --- |
| 打 zip | 递归收集文件，自动跳过 `.git` / `__pycache__` / `*.pyc` / `node_modules` / `.DS_Store` 等；时间戳固定，**同样的源码永远打出同样的字节**，PR diff 不会每次都变 |
| 算 sha256 | 直接算在打出来的 zip 上，不用你手抄 |
| 放包 | `modules/<id>/<id>-<version>.zip` |
| 写清单 | 生成/更新 `modules/<id>/module.json`（你手写过的其它字段会保留，字段顺序固定） |
| 自检 | 跑 `scripts/validate.mjs`，其中一条就是「`sha256` 和 zip 的实际内容是否一致」 |
| 提交 | `git add` + `git commit`，并打印提 PR 的下一步 |

常用参数：

```bash
node scripts/upload-plugin.mjs ../我的插件 --dry-run     # 只看会做什么，不写任何文件
node scripts/upload-plugin.mjs ../我的插件 --no-git      # 生成文件但不提交
node scripts/upload-plugin.mjs ../我的插件 --author 张三 --homepage https://example.com
node scripts/upload-plugin.mjs ../我的插件 --category 工具 --category 网络
node scripts/upload-plugin.mjs ../我的插件 --help
```

它自带三道护栏，命中就直接拒绝并说清原因：

- **同一个版本号换内容** —— 客户端会认为「装过了、不给你更新」，所以脚本要求先升 `version`（真要在同版本上覆盖才加 `--force`）；
- **`sha256` 和 zip 对不上** —— `validate.mjs` 在 PR 阶段就拦住，不会等到用户装了失败；
- **单文件超 16 MB / 总量超 64 MB** —— 和客户端解压闸门保持一致。

完整流程（在一个新终端里照着抄就行）：

```bash
# 0) 在 GitHub 上 fork 本仓库，然后 clone 你自己那份
git clone https://github.com/<你的用户名>/cncp-Unofficial-Plugin
cd cncp-Unofficial-Plugin
git checkout -b add/myplugin

# 1) 一键上传（生成模块目录 + 自检 + 自动 commit）
node scripts/upload-plugin.mjs ../我的插件

# 2) 推到 fork，开 PR
git push -u origin add/myplugin
gh pr create --fill      # 没装 GitHub CLI 就去网页：Pull requests → New pull request
```

PR 会自动跑「校验插件清单」工作流；合并进 `main` 后「生成索引并发布」自动重建站点与索引，客户端下一次刷新源就能看到。

> Node 需要 18 以上。脚本只用标准库（zip 容器是自己写的），不需要 `npm install`。

## 手动提交（不想用脚本时）

```bash
mkdir -p modules/com.yourname.myplugin          # 目录名必须等于插件 id
$EDITOR modules/com.yourname.myplugin/module.json
cp 我的插件.zip modules/com.yourname.myplugin/com.yourname.myplugin-1.0.0.zip
node scripts/validate.mjs                        # 会校验 sha256 与 zip 是否对得上
node scripts/build-index.mjs
```

此时 `downloadPath` 写 `modules/com.yourname.myplugin/com.yourname.myplugin-1.0.0.zip`，
`sha256` 自己用 `sha256sum`（Linux/macOS）或 `Get-FileHash -Algorithm SHA256`（Windows）算。
手动模式最容易漏的是改完 zip 忘了同步 `sha256` —— 所以还是建议用上面的一键脚本。

## module.json 字段

```json
{
  "id": "cn.example.actions",
  "name": "示例功能插件",
  "version": "1.0.0",
  "description": "演示怎么给客户端加自己的功能按钮",
  "author": "Cncp",
  "homepage": "https://clash.cupzz.cn/docs/plugins",
  "source": "https://github.com/you/your-repo/tree/main/myplugin",
  "license": "MIT",
  "categories": ["示例"],
  "capabilities": ["actions", "hooks", "tasks"],
  "minHostVersion": "1.3.18",
  "downloadPath": "packages/cn.example.actions-1.0.0.zip",
  "sha256": "b16744ab7ce31deb26a3fb9eec8e2d4790dbdfe36847be96104355029e947097"
}
```

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `id` | 是 | 小写字母/数字，用 `.` 或 `-` 分段，6–64 字符，**必须等于目录名**，全仓库唯一 |
| `name` | 是 | 显示名，≤60 字符 |
| `version` | 是 | 必须是 `x.y.z` |
| `description` | 是 | 一句话说明，≤300 字符 |
| `author` | 是 | ≤60 字符 |
| `downloadPath` | 是 | 本仓库放包时形如 `modules/<id>/<id>-<version>.zip`（一键脚本自动写成这样，且会核对文件存在与哈希）；也可以直接写 `https://…zip` 指向自己的 Release |
| `sha256` | 是 | zip 的 64 位小写十六进制哈希。**算错就装不上** —— 用 `node scripts/upload-plugin.mjs` 会自动算好并校验，手动模式才需要自己 `sha256sum` / `Get-FileHash` |
| `capabilities` | 是 | 非空数组，客户端据此决定插件能挂哪些能力：`actions` / `hooks` / `tasks` / `speedtester` |
| `homepage` | 否 | 必须是 https |
| `source` | 否 | 源码地址，建议 https |
| `license` | 否 | 许可证标识，如 `MIT` |
| `categories` | 否 | 分类标签数组，用于站点筛选 |
| `minHostVersion` | 否 | 要求的最低客户端版本，`x.y.z` |

## 下载地址怎么来的

`downloadPath` 是相对路径时，构建脚本按它的开头决定拼哪个前缀：

| `downloadPath` 形状 | 拼哪个前缀 | 用在哪 |
| --- | --- | --- |
| `modules/<id>/<id>-<version>.zip` | 本仓库 `selfBase` | 包放在本仓库，也就是一键脚本生成的形态 |
| 其它（如 `packages/x.zip`） | 官方仓库 `pluginsBase` | 兼容从官方仓库搬过来的清单，包仍留在官方仓库 |
| 完整 `https://…zip` | 原样使用 | 包放在自己的 Release 或别的 CDN |

两个前缀的默认值都走 `ghproxy.net` 镜像（`https://ghproxy.net/https://raw.githubusercontent.com/<owner>/<repo>/main`），因为国内直连 `raw.githubusercontent.com` 基本不通。要换前缀：

```bash
# 本地临时指定
node scripts/build-index.mjs \
  --plugins-base https://raw.githubusercontent.com/Char0n111/cncp-plugins/main \
  --self-base    https://raw.githubusercontent.com/Char0n111/cncp-Unofficial-Plugin/main

# 或改默认值（环境变量）
PLUGINS_REPO=you/cncp-plugins SELF_REPO=you/cncp-Unofficial-Plugin node scripts/build-index.mjs
```

GitHub Actions 里读的是仓库变量 `PLUGINS_BASE`（见 `.github/workflows/build.yml`），`selfBase` 默认已指向本仓库。

想让包放在自己的 Release 里？直接给 `downloadPath` 写完整 `https://…` 地址，脚本会原样使用（此时 CORS 需要允许，GitHub Release 是允许的）。

## 客户端怎么用

Cncp 安卓客户端 **2.0.0 起**有「插件市场」：插件页 → 市场 → 粘贴源地址 → 安装。本仓库的源地址：

```
https://<你的用户名>.github.io/cncp-Unofficial-Plugin/cncp-source.json
```

在客户端市场页也可以直接点「社区源 / 社区镜像」预设。若直连 `raw.githubusercontent.com` 不通，用镜像地址：

```
https://ghproxy.net/https://raw.githubusercontent.com/Char0n111/cncp-Unofficial-Plugin/main/cncp-source.json
```

## 本地预览站点

```bash
node scripts/build-index.mjs
npx serve .          # 或者 python -m http.server
```

直接双击 `site/index.html` 会因为 `file://` 下 fetch 被浏览器拦住而看不到列表，这不是 bug。

## 许可证

[MIT](LICENSE)。各插件版权归其作者，见各自 `module.json` 的 `author` / `license`。
