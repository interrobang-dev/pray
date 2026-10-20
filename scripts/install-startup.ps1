# 로그인 시 세션 호스트와 서버가 자동으로 뜨도록 작업 스케줄러에 등록한다.
# 다시 실행하면 같은 이름의 작업을 덮어쓴다. 중지는 stop.ps1, 제거는 uninstall-startup.ps1.
#
# - 대화형 로그온 + 숨김 PowerShell 래퍼. 창 없이 띄우는 다른 방법(S4U)은 관리자 권한이 필요하다
# - 래퍼 때문에 Stop-ScheduledTask 는 래퍼만 죽이고 node 는 남는다 → 반드시 stop.ps1 로 멈춘다
# - 래퍼는 node 의 종료 코드를 그대로 돌려줘서 node 가 죽으면 스케줄러가 1분 뒤 다시 띄운다 (3회)
# - 스케줄러 환경에는 사용자 PATH 가 없을 수 있어 claude.exe 경로를 인자로 넘긴다. 로그는 node 가 직접 쓴다
$ErrorActionPreference = 'Stop'

$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$node = (Get-Command node.exe).Source
$claude = (Get-Command claude.exe).Source
$tsx = Join-Path $repo 'node_modules\tsx\dist\cli.mjs'
if (-not (Test-Path $tsx)) { throw "tsx 없음. 먼저 npm install 을 실행하세요: $tsx" }
$logDir = Join-Path $env:USERPROFILE '.claude\jk-corp\logs'
New-Item -ItemType Directory -Force $logDir | Out-Null

$settings = New-ScheduledTaskSettingsSet `
    -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -MultipleInstances IgnoreNew `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

function Register-JkTask {
    param([string]$Name, [string]$WorkDir, [string]$ExtraArgs, [string]$Description)
    $log = Join-Path $logDir "$Name.log"
    $command = "& '$node' '$tsx' src/index.ts --log='$log' $ExtraArgs; exit `$LASTEXITCODE"
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' `
        -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -Command `"$command`"" `
        -WorkingDirectory $WorkDir
    Register-ScheduledTask -TaskName $Name -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description $Description -Force | Out-Null
    Write-Host "등록: $Name ($WorkDir)"
}

Register-JkTask -Name 'jk-corp-host' -WorkDir (Join-Path $repo 'host') -ExtraArgs "--claude='$claude'" -Description 'jk-corp 세션 호스트 (claude 프로세스 보관)'
Register-JkTask -Name 'jk-corp-server' -WorkDir (Join-Path $repo 'server') -ExtraArgs '' -Description 'jk-corp 서버 (http://127.0.0.1:4710)'

Write-Host "로그: $logDir"
Write-Host '지금 시작: Start-ScheduledTask jk-corp-host; Start-ScheduledTask jk-corp-server'
Write-Host '중지: scripts\stop.ps1'
