# Cncp 插件聚合仓库

类 LSPosed 模块仓库的玩法：**任何人**把自己的 Cncp 插件提一个 PR（`modules/<插件id>/module.json` + 一个能下载的 zip），校验通过后合并，站点和索引自动重建 —— 客户端只要填一次源地址，就能看到全部插件。

- 站点：`https://<你的用户名>.github.io/cncp-plugin-repo/`
- 索引（页面/工具用）：[`index.json`](index.json)
- 索引（**客户端直接填这个地址**）：`cncp-source.json`

官方示例插件不在这里维护，在 [cncp-plugins](https://github.com/Char0n111/cncp-plugins)。本仓库收录的是社区插件，以及它们的元数据。

## 为什么分两份索引

| 文件 | 谁在用 | 结构 |
| --- | --- | --- |
| `index.json` | 站点页面、第三方工具 | `{ schemaVersion, name, updated, count, modules: [...] }` |
| `cncp-source.json` | Cncp 客户端「插件源」 | `{ schemaVersion, name, updated, plugins: [{ id, name, version, description, author, homepage, url, sha256, capabilities }] }` |

`plugins` 数组的字段名与官方仓库 `cncp-plugins/index.json` 完全一致 —— 这样客户端一套代码能读两个源，不用为聚合站写特例。

## 提交一个新插件

```bash
# 1) 建目录（目录名必须等于插件 id）
mkdir -p modules/com.yourname.myplugin

# 2) 写清单
$EDITOR modules/com.yourname.myplugin/module.json

# 3) 本地自检（需要 Node 18+）
node scripts/validate.mjs
node scripts/build-index.mjs

# 4) 提 PR
git checkout -b add/com.yourname.myplugin
git add modules/com.yourname.myplugin
git commit -m "新增插件：我的插件"
git push -u origin add/com.yourname.myplugin
```

PR 会跑 `校验插件清单` 工作流；合并进 `main` 后 `生成索引并发布` 自动更新站点与索引。

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
| `downloadPath` | 是 | 必须形如 `packages/<id>-<version>.zip`；也可以直接写 `https://…zip` 指向自己的 Release |
| `sha256` | 是 | zip 的 64 位小写十六进制哈希。**算错就装不上**，用 `tools/build.ps1`（官方仓库）或自己 `sha256sum` 算 |
| `capabilities` | 是 | 非空数组，客户端据此决定插件能挂哪些能力：`actions` / `hooks` / `tasks` / `speedtester` |
| `homepage` | 否 | 必须是 https |
| `source` | 否 | 源码地址，建议 https |
| `license` | 否 | 许可证标识，如 `MIT` |
| `categories` | 否 | 分类标签数组，用于站点筛选 |
| `minHostVersion` | 否 | 要求的最低客户端版本，`x.y.z` |

## 下载地址怎么来的

`downloadPath` 是相对路径时，构建脚本会拼上前缀：

```bash
# 默认（不配也行）：https://raw.githubusercontent.com/${PLUGINS_REPO}/main
node scripts/build-index.mjs

# 推荐：在仓库 Settings → Secrets and variables → Actions → Variables 里
# 加一个 PLUGINS_BASE，值形如 https://raw.githubusercontent.com/you/cncp-plugins/main
# 工作流会自动读它；本地也可临时指定：
node scripts/build-index.mjs --plugins-base https://raw.githubusercontent.com/you/cncp-plugins/main
```

想让包放在自己的 Release 里？直接给 `downloadPath` 写完整 `https://…` 地址，脚本会原样使用（此时 CORS 需要允许，GitHub Release 是允许的）。

## 客户端怎么用

客户端「插件」页填这个地址即可：

```
https://<你的用户名>.github.io/cncp-plugin-repo/cncp-source.json
```

> 注意：Cncp 安卓客户端目前（1.3.x）只支持「导入本地 zip」。插件源的读取随着 2.0.0 的插件市场一起上 —— 本仓库先按最终格式把数据准备好。

## 本地预览站点

```bash
node scripts/build-index.mjs
npx serve .          # 或者 python -m http.server
```

直接双击 `site/index.html` 会因为 `file://` 下 fetch 被浏览器拦住而看不到列表，这不是 bug。

## 许可证

[MIT](LICENSE)。各插件版权归其作者，见各自 `module.json` 的 `author` / `license`。
