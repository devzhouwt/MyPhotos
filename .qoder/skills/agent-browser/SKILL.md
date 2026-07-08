---
name: agent-browser
description: 自动化浏览器交互，用于 Web 测试、表单填写、截图和数据提取。当用户需要导航网站、与网页交互、填写表单、截图、测试 Web 应用或从网页提取信息时使用。
---

# 使用 agent-browser 进行浏览器自动化

## 简要指令

```bash
agent-browser open <url>        # 导航到页面
agent-browser snapshot -i       # 获取可交互元素及其引用
agent-browser click @e1         # 通过引用点击元素
agent-browser fill @e2 "text"   # 通过引用填充输入框
agent-browser close             # 关闭浏览器
```

## 核心工作流

1. 导航：`agent-browser open <url>`
2. 快照：`agent-browser snapshot -i`（返回带有 `@e1`、`@e2` 等引用的元素）
3. 使用快照中的引用进行交互
4. 导航或 DOM 发生重大变化后重新获取快照

## 命令

### 导航
```bash
agent-browser open <url>      # 导航到 URL
agent-browser back            # 后退
agent-browser forward         # 前进
agent-browser reload          # 重新加载页面
agent-browser close           # 关闭浏览器
```

### 快照（页面分析）
```bash
agent-browser snapshot            # 完整无障碍树
agent-browser snapshot -i         # 仅可交互元素（推荐）
agent-browser snapshot -c         # 紧凑输出
agent-browser snapshot -d 3       # 限制深度为 3
agent-browser snapshot -s "#main" # 限定到 CSS 选择器范围
```

### 交互操作（使用快照中的 @refs）
```bash
agent-browser click @e1           # 单击
agent-browser dblclick @e1        # 双击
agent-browser focus @e1           # 聚焦元素
agent-browser fill @e2 "text"     # 清空后输入
agent-browser type @e2 "text"     # 追加输入（不清空）
agent-browser press Enter         # 按键
agent-browser press Control+a     # 组合键
agent-browser keydown Shift       # 按住按键
agent-browser keyup Shift         # 释放按键
agent-browser hover @e1           # 悬停
agent-browser check @e1           # 勾选复选框
agent-browser uncheck @e1         # 取消勾选
agent-browser select @e1 "value"  # 选择下拉项
agent-browser scroll down 500     # 滚动页面
agent-browser scrollintoview @e1  # 滚动元素到可见区域
agent-browser drag @e1 @e2        # 拖放
agent-browser upload @e1 file.pdf # 上传文件
```

### 获取信息
```bash
agent-browser get text @e1        # 获取元素文本
agent-browser get html @e1        # 获取 innerHTML
agent-browser get value @e1       # 获取输入值
agent-browser get attr @e1 href   # 获取属性
agent-browser get title           # 获取页面标题
agent-browser get url             # 获取当前 URL
agent-browser get count ".item"   # 统计匹配元素数量
agent-browser get box @e1         # 获取边界框
```

### 检查状态
```bash
agent-browser is visible @e1      # 是否可见
agent-browser is enabled @e1      # 是否可用
agent-browser is checked @e1      # 是否已勾选
```

### 截图
```bash
agent-browser screenshot body path.png         # 推荐：整页截图并保存到 path.png（body 表示整页）
agent-browser screenshot --full path.png      # 整页截图（仅视口用 screenshot body path.png）
```
注意：当前版本 (0.7.x) 的 MCP/服务端要求 `selector` 为字符串，不能为 null。只传路径时会被判为 selector 缺失而报错，因此需显式传选择器（整页用 `body`）。

### 视频录制
```bash
agent-browser record start ./demo.webm    # 开始录制（使用当前 URL + 状态）
agent-browser click @e1                   # 执行操作
agent-browser record stop                 # 停止并保存视频
agent-browser record restart ./take2.webm # 停止当前录制 + 开始新录制
```
录制会创建新的上下文，但保留会话中的 cookies/存储。如果未提供 URL，会自动返回当前页面。为获得流畅的演示效果，建议先探索页面，再开始录制。

### 等待
```bash
agent-browser wait @e1                     # 等待元素出现
agent-browser wait 2000                    # 等待毫秒数
agent-browser wait --text "Success"        # 等待文本出现
agent-browser wait --url "**/dashboard"    # 等待 URL 匹配模式
agent-browser wait --load networkidle      # 等待网络空闲
agent-browser wait --fn "window.ready"     # 等待 JS 条件满足
```

### 鼠标控制
```bash
agent-browser mouse move 100 200      # 移动鼠标
agent-browser mouse down left         # 按下鼠标键
agent-browser mouse up left           # 释放鼠标键
agent-browser mouse wheel 100         # 滚动滚轮
```

### 语义定位器（引用的替代方案）
```bash
agent-browser find role button click --name "Submit"
agent-browser find text "Sign In" click
agent-browser find label "Email" fill "user@test.com"
agent-browser find first ".item" click
agent-browser find nth 2 "a" text
```

### 浏览器设置
```bash
agent-browser set viewport 1920 1080      # 设置视口大小
agent-browser set device "iPhone 14"      # 模拟设备
agent-browser set geo 37.7749 -122.4194   # 设置地理位置
agent-browser set offline on              # 切换离线模式
agent-browser set headers '{"X-Key":"v"}' # 附加 HTTP 请求头
agent-browser set credentials user pass   # HTTP 基本认证
agent-browser set media dark              # 模拟颜色方案
```

### Cookies 与存储
```bash
agent-browser cookies                     # 获取所有 cookies
agent-browser cookies set name value      # 设置 cookie
agent-browser cookies clear               # 清除 cookies
agent-browser storage local               # 获取所有 localStorage
agent-browser storage local key           # 获取指定键
agent-browser storage local set k v       # 设置值
agent-browser storage local clear         # 清除所有
```

### 网络
```bash
agent-browser network route <url>              # 拦截请求
agent-browser network route <url> --abort      # 阻止请求
agent-browser network route <url> --body '{}'  # 模拟响应
agent-browser network unroute [url]            # 移除路由
agent-browser network requests                 # 查看跟踪的请求
agent-browser network requests --filter api    # 过滤请求
```

### 标签页与窗口
```bash
agent-browser tab                 # 列出标签页
agent-browser tab new [url]       # 新建标签页
agent-browser tab 2               # 切换到标签页
agent-browser tab close           # 关闭标签页
agent-browser window new          # 新建窗口
```

### 框架
```bash
agent-browser frame "#iframe"     # 切换到 iframe
agent-browser frame main          # 返回主框架
```

### 对话框
```bash
agent-browser dialog accept [text]  # 接受对话框
agent-browser dialog dismiss        # 关闭对话框
```

### JavaScript
```bash
agent-browser eval "document.title"   # 执行 JavaScript
```

## 示例：表单提交

```bash
agent-browser open https://example.com/form
agent-browser snapshot -i
# 输出显示：textbox "Email" [ref=e1]、textbox "Password" [ref=e2]、button "Submit" [ref=e3]

agent-browser fill @e1 "user@example.com"
agent-browser fill @e2 "password123"
agent-browser click @e3
agent-browser wait --load networkidle
agent-browser snapshot -i  # 检查结果
```

## 示例：带状态保存的认证

```bash
# 首次登录
agent-browser open https://app.example.com/login
agent-browser snapshot -i
agent-browser fill @e1 "username"
agent-browser fill @e2 "password"
agent-browser click @e3
agent-browser wait --url "**/dashboard"
agent-browser state save auth.json

# 后续会话：加载保存的状态
agent-browser state load auth.json
agent-browser open https://app.example.com/dashboard
```

## 会话（并行浏览器）

```bash
agent-browser --session test1 open site-a.com
agent-browser --session test2 open site-b.com
agent-browser session list
```

## JSON 输出（用于解析）

添加 `--json` 获取机器可读的输出：
```bash
agent-browser snapshot -i --json
agent-browser get text @e1 --json
```

## 调试

```bash
agent-browser open example.com --headed              # 显示浏览器窗口
agent-browser console                                # 查看控制台消息
agent-browser errors                                 # 查看页面错误
agent-browser record start ./debug.webm              # 从当前页面开始录制
agent-browser record stop                            # 保存录制
agent-browser --cdp 9222 snapshot                    # 通过 CDP 连接
agent-browser console --clear                        # 清除控制台
agent-browser errors --clear                         # 清除错误
agent-browser highlight @e1                          # 高亮元素
agent-browser trace start                            # 开始录制 trace
agent-browser trace stop trace.zip                   # 停止并保存 trace
```