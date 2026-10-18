# MeetingCopilot：代码修改后生成 EXE 并发布

本文只说明一条实际流程：修改完代码后，如何生成最终的 Windows EXE 安装程序，并发布到组织仓库的 GitHub Release。

项目目录：

```text
C:\path\to\MeetingCopilot
```

GitHub 仓库：

```text
https://github.com/421tuanhuo/MeetingCopilot
```

## 一、生成最终 EXE 安装程序

### 1. 进入项目目录

打开 PowerShell：

```powershell
cd C:\path\to\MeetingCopilot
```

### 2. 修改版本号

正式发布时最好使用新版本号。例如从 `0.2.0-beta.1` 升级为 `0.2.0-beta.2`：

```powershell
npm version 0.2.0-beta.2 --no-git-tag-version
```

这会同时修改 `package.json` 和 `package-lock.json`。

检查版本号：

```powershell
node -p "require('./package.json').version"
```

下一次发布继续递增，例如：

```text
0.2.0-beta.3
0.2.0-beta.4
0.2.0
0.2.1
```

如果只是本地临时测试、不准备发布新版本，可以跳过这一步。

### 3. 检查代码

执行：

```powershell
npm run typecheck
npm test
```

两条命令都成功后再打包。

### 4. 生成安装版和免安装版 EXE

执行：

```powershell
npm run dist:win
```

这个命令会自动编译最新源码，然后调用 electron-builder 生成 Windows 程序。

完成后，打开产物目录：

```powershell
explorer .\release
```

或者在命令行查看：

```powershell
Get-ChildItem .\release -Filter *.exe -File | Select-Object Name,Length,LastWriteTime
```

主要会得到：

```text
MeetingCopilot-0.2.0-beta.2-win-x64.exe
MeetingCopilot-0.2.0-beta.2-win-x64-portable.exe
```

| 文件 | 用途 |
|---|---|
| 不带 `portable` 的 EXE | 正式安装版，给普通用户安装 |
| 带 `portable` 的 EXE | 免安装版，双击直接运行 |

你要的最终安装程序是：

```text
release/MeetingCopilot-<版本号>-win-x64.exe
```

### 5. 本地测试安装版

以 `0.2.0-beta.2` 为例：

```powershell
Start-Process .\release\MeetingCopilot-0.2.0-beta.2-win-x64.exe
```

至少检查：

1. 安装向导可以正常打开。
2. 可以选择安装位置。
3. 安装后桌面快捷方式可以启动程序。
4. 文本问答、截图问答和“停”按钮正常。
5. 测试前先退出托盘中的旧版本，防止实际运行的还是旧程序。

当前安装包没有代码签名，Windows 可能显示“未知发布者”。这是签名提示，不代表打包失败。

### 6. 计算文件校验值（建议）

```powershell
Get-ChildItem .\release -Filter *.exe -File | Get-FileHash -Algorithm SHA256
```

保存输出。成员下载后可以再次计算 SHA256，确认下载文件没有损坏或被替换。

## 二、提交本次代码

先检查修改范围：

```powershell
git status --short
git diff --stat
```

只添加本次确定需要提交的文件。例如：

```powershell
git add electron\main.ts electron\llm\vision.ts src\App.tsx package.json package-lock.json
```

如果本次修改了其他文件，再把对应文件明确加进去。

检查即将提交的内容：

```powershell
git status --short
git diff --cached
```

提交并推送：

```powershell
git commit -m "Release v0.2.0-beta.2"
git push origin main
```

注意：不要提交或上传以下内容：

```text
node_modules/
out/
release/win-unpacked/
settings.json
sessions.json
knowledge.md
真实 API Key
个人日志和个人文档
```

## 三、发布到 GitHub Release

项目支持两种发布方式。选择其中一种即可。

## 方式 A：网页上传本地生成的 EXE

这是最直观的方式。

### 1. 打开 Releases 页面

```text
https://github.com/421tuanhuo/MeetingCopilot/releases
```

点击：

```text
Draft a new release
```

### 2. 填写版本信息

以 `0.2.0-beta.2` 为例：

```text
Tag: v0.2.0-beta.2
Title: MeetingCopilot v0.2.0-beta.2
```

`package.json` 中的版本不带 `v`，Git 标签通常带 `v`。

Release 说明可以写：

```markdown
## 本次更新

- 视觉任务改为同一时间只执行一个。
- 视觉请求 20 秒超时后自动重试一次。
- 点击“停”会取消请求并移除任务卡片。
```

### 3. 上传文件

将下面的安装版拖入 Release 附件区域：

```text
release/MeetingCopilot-0.2.0-beta.2-win-x64.exe
```

如果还要提供免安装版，再上传：

```text
release/MeetingCopilot-0.2.0-beta.2-win-x64-portable.exe
```

不要上传 `win-unpacked`、`node_modules`、用户配置或 API Key。

### 4. 正式发布

确认标签、标题、文件名中的版本号一致，并且 EXE 已经本地测试，然后点击：

```text
Publish release
```

如果仓库是私有仓库，只有拥有仓库访问权限的组织成员才能下载。普通成员使用 `Read` 权限即可，不需要 `Write` 权限。

## 方式 B：推送标签，让 GitHub Actions 自动打包

项目已有 `.github/workflows/release.yml`。推送以 `v` 开头的标签后，GitHub 会在云端重新测试、打包，并创建 Draft Release。

代码已经提交并推送后执行：

```powershell
git tag -a v0.2.0-beta.2 -m "MeetingCopilot v0.2.0-beta.2"
git push origin v0.2.0-beta.2
```

打开 Actions 页面查看构建进度：

```text
https://github.com/421tuanhuo/MeetingCopilot/actions
```

`Release` 工作流完成后，再打开：

```text
https://github.com/421tuanhuo/MeetingCopilot/releases
```

GitHub Actions 会创建一个 Draft Release，并自动上传安装版、免安装版和 SHA256 文件。检查无误后点击 `Publish release`。

使用这种方式时，不需要再手动上传本地 `release/` 目录里的 EXE。

## 四、以后每次发布直接照着执行

下面以发布 `0.2.0-beta.2` 为例。下一次发布时把版本号替换为新版本。

```powershell
cd C:\path\to\MeetingCopilot

npm version 0.2.0-beta.2 --no-git-tag-version
npm run typecheck
npm test
npm run dist:win

Get-ChildItem .\release -Filter *.exe -File | Select-Object Name,Length,LastWriteTime
Get-ChildItem .\release -Filter *.exe -File | Get-FileHash -Algorithm SHA256

git status --short
git add electron\main.ts electron\llm\vision.ts src\App.tsx package.json package-lock.json
git diff --cached
git commit -m "Release v0.2.0-beta.2"
git push origin main
```

然后二选一：

- 打开 GitHub Releases 网页，创建 Release 并上传 `release` 目录里的 EXE。
- 执行下面两条命令，让 GitHub Actions 自动打包：

```powershell
git tag -a v0.2.0-beta.2 -m "MeetingCopilot v0.2.0-beta.2"
git push origin v0.2.0-beta.2
```

最后在 Releases 页面检查 Draft，并点击 `Publish release`。

## 最重要的三个本地命令

如果不需要发布新版本，只想把刚修改的代码做成安装包：

```powershell
npm run typecheck
npm test
npm run dist:win
```

最终安装版位于：

```text
release/MeetingCopilot-<当前版本>-win-x64.exe
```
