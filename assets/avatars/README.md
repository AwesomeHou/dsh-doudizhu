# avatars/ — 默认头像

**默认头像 = DeepSeek 品牌蓝/黑两枚**，由用户提供的品牌素材派生：

| 头像 id | 名称 | 来源 |
|---|---|---|
| `default-01` | DeepSeek 蓝 | `assets/deepseek-blue.svg`（蓝 `#4D6BFE`） |
| `default-02` | DeepSeek 黑 | `assets/deepseek-black.svg`（黑 `#2c2c2c`） |

## 派生要求
- 格式：方形 `256×256`，SVG 优先（`@2x` 提供 512 用 PNG）。
- 保持品牌图形完整不变形；可加圆角/描边/深色底衬托（贴合 DSH 深色界面）。

## 扩展
后续如需更多默认头像，可在本目录派生变体（反色、裁剪居中、加边框），命名 `default-03.svg` … 递增。

## 自定义头像（暂缓）
用户上传自定义头像已**暂缓**（启用 R2 需绑定支付方式）。第一阶段只用上方默认头像。
设计保留：客户端转 WebP（256×256、≤128KB）→ R2 存储 `user-<uid>-<hash>.webp`（详见 docs/架构设计.md §3.5）。
