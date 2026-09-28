# pi-resource-manager

pi 扩展：资源管理。`/res` 打开浮层，列出当前已加载的 skill 与扩展（含工具、命令、描述），直接删除不需要的条目。

## 安装

### 方式一：作为 pi 包安装（推荐）

```bash
pi install git:github.com/wangxiang0605qvq/pi-resource-manager
```

### 方式二：手动复制

复制 `resource-manager.ts` 到 pi 扩展目录：

```bash
cp resource-manager.ts ~/.pi/agent/extensions/resource-manager.ts
```

然后 `/reload`。

## 用法

| 操作 | 说明 |
| --- | --- |
| `/res` | 打开资源管理面板 |
| `Alt+J` / `Alt+K` | 上 / 下移动 |
| `d` | 删除选中项（`y` 确认 / `n` 取消） |
| `Esc` | 关闭 |

- skill 条目删除整个技能目录，扩展条目删除入口 `.ts` / `.js` 文件。
- 同时扫描全局（`~/.pi/agent/`）与项目级（`<项目>/.pi/`）目录。
- 历史遗留的 `*.disabled` 文件也会列出，可单独清理。
- 删除后 `/reload` 彻底生效。
- 仅支持 TUI 模式。

## 版权

著作权归作者所有，保留一切权利。详见 [LICENSE](LICENSE)。
