# 0.4.17 / 0.4.18（2026-11-25）

> 0.4.18：`uninstall.sh` 打包时没有执行位（`./uninstall.sh` 会 Permission denied）。现在三个脚本都带 +x。
>
> 0.4.19：卸载补两件——删掉 `local-packages/` 里的本地副本；如果卸载后 patch 里已经没有任何启用的压缩引擎，自动重新启用宿主自带的 `compaction-basic`（否则会变成没有压缩，上下文一到线就报错）。

## 一键安装：`./install.sh` 现在是个会自检、会回滚的配置器

`install.sh` 只剩一层壳，真正的活在 `scripts/setup.mjs`：每一步「做 → 验 → 不行就回滚」。

```
./install.sh                    # 自动找 profile（只有一个就直接用）
./install.sh --profile web
./install.sh --dry-run          # 只看要改什么，不写盘
./install.sh --verify-only      # 只检查现有安装
```

### 修掉的坑

| 坑 | 现在怎么防 |
|---|---|
| 符号链接装进去，引擎静默不激活 | 发现符号链接就换成真目录；装完再查一次 `lstat` |
| 用 `/^- id:/` 匹配缩进条目 → 漏匹配 → 重复插入 → DSH 报重复 id | 只认缩进 0 的 `- id:`；写完做结构自检，重复 id 直接报错 |
| 装完不核对，配置没生效也打印 done | 装完必跑四项：JSON 可解析、包是真目录、`node --check`、patch 结构 |
| 出错留半装状态 | 任何一步失败：还原 `package.json` / `cordis.patch.yml`，删掉这次新建的目录，退出码 1 |
| `compaction-jiyu` 的配置行被当成重复条目删掉 | **不动**。bundle 用 `- insert:` 建条目，profile 里那条是配置补丁 |

### 顺带

- 备份文件名改成时间戳到秒，且只备份不再堆积；
- 旧剪裁阈值（2000/1200/500）在配置器里一并撤销；
- 测试：`test/setup.test.mjs` 九条（含「dry-run 不写盘」「坏了要回滚」「符号链接要认出来」）；全量 124/124。
