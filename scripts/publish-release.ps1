<#
.SYNOPSIS
  知序 GitHub Release 发布助手：创建草稿、上传产物、校验并正式发布。

.DESCRIPTION
  修复要点（0.2.19 发布卡住的根因）：
  1. 发布标题不再在脚本里写死中文，改从 UTF-8 发布说明首行读取，避免 Windows PowerShell 5.1
     以 ANSI/GBK 解析 UTF-8 无 BOM 脚本造成 "知序" 变成乱码 "鐭ュ簭"。
  2. 所有 JSON 读写显式 UTF-8，避免发布说明 body 乱码。
  3. 上传失败会重试；校验 size / digest / state 三者一致后才允许发布。
  4. 新增 status 动作用于诊断草稿/正式发布与资源状态。
  5. 发布前自动修正草稿中被旧脚本写坏的标题与正文编码。
  6. 统一仓库所有者为规范拼写 HUlI-J（GitHub 账号真实 login）。

  用法（在项目根目录、发布产物已生成后按顺序执行）：
    powershell -File scripts/publish-release.ps1 -Action create
    powershell -File scripts/publish-release.ps1 -Action upload
    powershell -File scripts/publish-release.ps1 -Action publish
    powershell -File scripts/publish-release.ps1 -Action verify
    powershell -File scripts/publish-release.ps1 -Action status
#>
param(
  [ValidateSet('create','upload','publish','verify','status')][string]$Action = 'status',
  [ValidatePattern('^\d+\.\d+\.\d+$')][string]$Version = '0.2.20',
  [string]$NotesPath = 'docs/43-0.2.20发布说明.md',
  [string]$ArtifactDirectory = 'release',
  [string]$ExpectedPublisher = 'HUlI-J',
  [string]$Proxy = '',
  [int]$Retries = 3
)
$ErrorActionPreference = 'Stop'
$env:GCM_INTERACTIVE = 'never'
$env:GIT_TERMINAL_PROMPT = '0'

# ---------- 凭据：只经 stdin 传递给 curl，不落盘、不进进程参数 ----------
$credentialLines = "protocol=https`nhost=github.com`n`n" | git -c credential.interactive=never credential fill
$credentials = @{}
foreach ($entry in $credentialLines) {
  if ($entry -match '^([^=]+)=(.*)$') { $credentials[$matches[1]] = $matches[2] }
}
if (!$credentials['password']) { throw 'GitHub credential unavailable' }
$curlConfiguration = 'header = "Authorization: Bearer ' + $credentials['password'] + '"'

# ---------- curl 公共参数 ----------
$curlCommon = @('--config','-','--http1.1','--connect-timeout','15','--max-time','120',
  '--silent','--show-error','--fail-with-body','-H','Accept: application/vnd.github+json')
if ($Proxy) { $curlCommon += @('--proxy',$Proxy) } else { $curlCommon += @('--noproxy','*') }

function Invoke-CurlWithRetry([string[]]$Arguments, [string]$ErrorMessage) {
  for ($attempt = 1; $attempt -le $Retries; $attempt++) {
    $curlConfiguration | curl.exe @Arguments
    if ($LASTEXITCODE -eq 0) { return }
    if ($attempt -lt $Retries) {
      Write-Warning "$ErrorMessage (attempt $attempt/$Retries failed; retrying)"
      Start-Sleep -Seconds ([Math]::Min(2 * $attempt, 8))
    }
  }
  throw $ErrorMessage
}

# ---------- 账号核验（发布操作）----------
if ($Action -in @('create','upload','publish')) {
  $publisherJson = $curlConfiguration | curl.exe @curlCommon 'https://api.github.com/user'
  if ($LASTEXITCODE -ne 0) { throw 'Could not verify the authenticated GitHub publisher' }
  $publisher = $publisherJson | ConvertFrom-Json
  if ($publisher.login -ine $ExpectedPublisher) {
    throw "Authenticated GitHub user '$($publisher.login)' does not match expected publisher '$ExpectedPublisher'"
  }
  Write-Output "GitHub publisher verified: $($publisher.login)"
}

$apiRoot = 'https://api.github.com/repos/HUlI-J/ZHIXU/releases'
$statePath = Join-Path 'release' "release-state-$Version.json"
$assetNames = @("Zhixu-$Version-Windows-Setup.exe", "Zhixu-$Version-source.zip", "SHA256SUMS-$Version.txt")
if ([version]$Version -ge [version]'0.2.9') {
  $assetNames += @("Zhixu-$Version-Windows-Setup.exe.blockmap", 'latest.yml')
}

function Invoke-ReleaseAPI([string]$Method, [string]$Url, [string]$Body = '') {
  $arguments = $curlCommon + @('-X',$Method,'-o',$statePath,'-w','%{http_code}')
  if ($Body) { $arguments += @('-H','Content-Type: application/json; charset=utf-8','--data-binary',('@'+$Body)) }
  $code = $curlConfiguration | curl.exe @arguments $Url
  if ($LASTEXITCODE -ne 0 -or $code -notmatch '^2') { throw "GitHub $Method failed (HTTP $code)" }
  $raw = [IO.File]::ReadAllText((Join-Path (Get-Location) $statePath), [Text.Encoding]::UTF8)
  $value = $raw | ConvertFrom-Json
  if (!$value.id -or $value.tag_name -ne "v$Version") { throw 'Unexpected release identity' }
  return $value
}

# 发布标题：从 UTF-8 发布说明首行读取，避免脚本内中文字面量被 PS 5.1 误解码。
$notesFullPath = Join-Path (Get-Location) $NotesPath
$notesText = [IO.File]::ReadAllText($notesFullPath, [Text.Encoding]::UTF8)
$firstLine = ($notesText -split "`r?`n", 2)[0].Trim()
$releaseName = if ($firstLine.StartsWith('#')) { $firstLine.TrimStart('#').Trim() } else { "Zhixu $Version" }

if ($Action -eq 'create') {
  $headCommit = (git rev-parse HEAD).Trim()
  if ($LASTEXITCODE -ne 0) { throw 'Missing Git commit' }
  $request = @{
    tag_name = "v$Version"; target_commitish = $headCommit; name = $releaseName
    body = $notesText; draft = $true; prerelease = $false
  }
  $requestPath = Join-Path 'release' "release-request-$Version.json"
  [IO.File]::WriteAllText($requestPath, ($request | ConvertTo-Json -Depth 5), [Text.UTF8Encoding]::new($false))
  $state = Invoke-ReleaseAPI 'POST' $apiRoot $requestPath
  if (!$state.draft) { throw 'Expected draft release' }
} else {
  if (!(Test-Path -LiteralPath $statePath)) { throw "Missing release state: $statePath (run create first)" }
  $state = Invoke-ReleaseAPI 'GET' "$apiRoot/$((Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json).id)"
}

if ($Action -eq 'status') {
  [PSCustomObject]@{
    Tag = $state.tag_name; Draft = $state.draft; PublishedAt = $state.published_at
    Name = $state.name; Url = $state.html_url
    Assets = (@($state.assets | ForEach-Object { "$($_.name) [$($_.state)] $($_.size)" }) -join ', ')
  }
  return
}

if ($Action -eq 'upload') {
  if (!$state.draft) { throw 'Uploads require a draft release' }
  $uploadBase = $state.upload_url -replace '\{.*$',''
  foreach ($name in $assetNames) {
    $assetPath = (Resolve-Path (Join-Path $ArtifactDirectory $name)).Path
    $existing = @($state.assets | Where-Object name -eq $name)
    if (!$existing.Count) {
      $uploadArgs = $curlCommon + @('--max-time','600','-X','POST',
        '-H','Content-Type: application/octet-stream','-H','Expect:',
        '--data-binary',('@'+$assetPath),'-o',(Join-Path 'release' "upload-$name.json"),
        ($uploadBase+'?name='+[Uri]::EscapeDataString($name)))
      Invoke-CurlWithRetry $uploadArgs "Upload failed: $name"
      $state = Invoke-ReleaseAPI 'GET' "$apiRoot/$($state.id)"
    }
    $asset = @($state.assets | Where-Object name -eq $name)
    $hash = (Get-FileHash -LiteralPath $assetPath -Algorithm SHA256).Hash.ToLower()
    if ($asset.Count -ne 1 -or $asset[0].state -ne 'uploaded' -or $asset[0].size -ne (Get-Item $assetPath).Length -or $asset[0].digest -ne "sha256:$hash") {
      throw "Asset verification failed: $name"
    }
    Write-Output "$name verified"
  }
}

if ($Action -in @('publish','verify')) {
  foreach ($name in $assetNames) {
    $assetPath = Join-Path $ArtifactDirectory $name
    if (!(Test-Path -LiteralPath $assetPath)) { throw "Missing artifact: $assetPath" }
    $hash = (Get-FileHash -LiteralPath $assetPath -Algorithm SHA256).Hash.ToLower()
    $asset = @($state.assets | Where-Object name -eq $name)
    if ($asset.Count -ne 1 -or $asset[0].state -ne 'uploaded' -or $asset[0].digest -ne "sha256:$hash") {
      throw "Asset verification failed: $name"
    }
  }
  if ($Action -eq 'publish') {
    # 修正旧脚本写入的乱码标题与正文，然后正式发布。
    $publish = @{
      name = $releaseName; body = $notesText
      draft = $false; prerelease = $false; make_latest = 'true'
    }
    $publishPath = Join-Path 'release' "publish-$Version.json"
    [IO.File]::WriteAllText($publishPath, ($publish | ConvertTo-Json -Depth 5), [Text.UTF8Encoding]::new($false))
    $state = Invoke-ReleaseAPI 'PATCH' "$apiRoot/$($state.id)" $publishPath
  }
  if ($state.draft -or !$state.published_at -or $state.prerelease) { throw 'Release is not published' }
  if ($state.name -ne $releaseName) { Write-Warning "Release name mismatch: $($state.name)" }
}
[PSCustomObject]@{ Tag=$state.tag_name; Draft=$state.draft; Url=$state.html_url; Assets=@($state.assets).Count }
