---
name: review-push
description: "git push 前进行检查； 当用户要求push代码的时候触发此skills"
---

# Review Push

这是一个在git push 前触发，用于对代码进行审核和校验。

在当前git 分支的 checkout 中串行执行：

```text
Review -> 修复 -> Test -> Lint -> 报告 -> Push
```

Review 阶段必须通过 `code-reviewer` 子 Agent 执行，避免 review 上下文污染
主 Agent 后续的修复、测试、lint 和 push 决策。
子 Agent 定义在 `.qoder/agents/code-reviewer.md`，它会自主收集 git 上下文并
输出结构化 JSON。

## 项目适配方式

这个 Skill 本身是通用流程，但 Test 和 Lint 不做自动探测。每个项目应该在
对应脚本里直接写本项目的固定命令，保持脚本简单、明确、可审计。

当前项目的默认命令是：

- Test：`cd front && npm run build`
- Test：`cd back && uv run python -m compileall app seed.py`
- Lint：`cd front && npm run lint`
- Lint：`git diff --check`

如果复制到其他项目，优先只改这两个脚本中的 `COMMANDS` 数组：

- `.qoder/skills/review-push/scripts/test.sh`
- `.qoder/skills/review-push/scripts/lint.sh`

临时覆盖命令时，也可以使用环境变量：

```sh
REVIEW_PUSH_TEST_CMD="make test" .qoder/skills/review-push/scripts/test.sh "$RUN_DIR"
REVIEW_PUSH_LINT_CMD="make lint" .qoder/skills/review-push/scripts/lint.sh "$RUN_DIR"
REVIEW_PUSH_PUSH_CMD="git push origin HEAD" .qoder/skills/review-push/scripts/push.sh "$RUN_DIR"
REVIEW_PUSH_BASE="origin/main" .qoder/skills/review-push/scripts/review.sh "$RUN_DIR"
```

## 流程

1. 检查当前状态：
   ```sh
   git status --short --branch
   git branch --show-current
   git remote -v
   ```
   如果当前在 `main` 或默认分支，需先确认用户是否为个人项目。个人项目允许直接
   从 main 推送，但需提示用户确认；团队项目则不允许，应要求切换到功能分支。
   如果工作区里有和本次任务无关的用户改动，不要回滚，也不要一起提交；只处理和本次任务相关的文件。

2. 创建本次运行目录：
   ```sh
   RUN_DIR=".review-push/runs/$(date +%Y%m%d-%H%M%S)"
   mkdir -p "$RUN_DIR"
   ```

3. 使用 `code-reviewer` 子 Agent 执行 Review：
   启动 `code-reviewer` 子 Agent，要求它审查当前分支相对 base 分支的所有
   改动（committed + staged + unstaged + untracked），并将结果写入
   `$RUN_DIR/review.json`。子 Agent 会自主收集 git 上下文，无需主 Agent
   预组装 prompt。

   主 Agent 只读取 `$RUN_DIR/review.json`，不要把完整 review 上下文重新读入
   主上下文。按 `action` 处理 findings：

   - `auto-fix`：局部、机械、安全的问题可以直接修。
   - `ask-user`：涉及产品语义、业务规则、交互取舍、数据口径的问题必须停下来问用户。
   - `no-op`：信息性提醒，不阻塞流程。

4. 修复留痕：每处理完一个 finding，必须在 `review.json` 中对应 finding 的
   `resolution` 字段写入处理结果，格式如下：
   ```json
   {
     "status": "fixed" | "deferred" | "dismissed",
     "detail": "具体做了什么，或为什么推迟/忽略"
   }
   ```
   - `fixed`：已修复，detail 写修复方式（如"后端增加 field_validator 校验未来日期"）。
   - `deferred`：推迟处理，detail 写原因（如"用户确认暂不处理，后续迭代"）。
   - `dismissed`：忽略，detail 写原因（如"no-op 信息性提醒，无需处理"）。

   **所有 finding 都必须有 resolution**，确保报告能完整展示处理轨迹。
   留痕时机：修复完成后立即写回 `review.json`，不要等所有修复做完再补。

5. 如果做了修复，重新运行 Review。Review/修复最多循环两轮；超过两轮仍有
   问题时，停止并把剩余问题告诉用户。每轮重新运行 Review 后，需再次确保
   新增 finding 的 resolution 也被填写。

6. 运行测试：
   ```sh
   .qoder/skills/review-push/scripts/test.sh "$RUN_DIR"
   ```
   如果失败，查看 `$RUN_DIR/test.log`。**必须修复所有报错**，无论是本次提交
   引入的还是预先存在的问题，然后重跑。最多自动修复/重试两轮。

7. 运行 lint：
   ```sh
   .qoder/skills/review-push/scripts/lint.sh "$RUN_DIR"
   ```
   如果失败，查看 `$RUN_DIR/lint.log`。**必须修复所有报错**，无论是本次提交
   引入的还是预先存在的问题，然后重跑。最多自动修复/重试两轮。

8. 如果流程中修改了代码，只提交相关改动：
   ```sh
   git status --short
   git add <relevant paths>
   git commit -m "review-push: [validate changes]"
   ```
   push 前不能存在属于本次任务但未提交或未跟踪的改动。不要在工作区仍有相关
   改动时直接 push `HEAD`，否则会出现“本地看到了改动，但远程没有”的错觉。

9. push 前生成报告：
   ```sh
   .qoder/skills/review-push/scripts/report.py "$RUN_DIR"
   ```

10. 只有 Review、Test、Lint 都通过后，才推送当前分支：
   ```sh
   .qoder/skills/review-push/scripts/push.sh "$RUN_DIR"
   ```
   这个脚本会写入 `$RUN_DIR/push.log` 和 `$RUN_DIR/push.json`。push 后重新生成
   报告：
   ```sh
   .qoder/skills/review-push/scripts/report.py "$RUN_DIR"
   ```

## 报告

完成后必须告诉用户最终 HTML 报告位置：

```text
.review-push/latest.html
```

报告是本地验证证据，默认应加入 `.gitignore`，不要进入业务提交。
