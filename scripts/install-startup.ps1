# 로그인 시 세션 호스트와 서버가 자동으로 뜨도록 작업 스케줄러에 등록한다.
# 다시 실행하면 같은 이름의 작업을 덮어쓴다. 중지는 stop.ps1, 제거는 uninstall-startup.ps1.
# 옛 이름(jk-corp-*) 작업이 남아 있으면 지운다 — 같이 남으면 로그인 때 둘 다 떠서 pipe·포트가 겹친다 (호환 코드)
#
# - 대화형 로그온 + wscript(launch-hidden.vbs) 래퍼. 창 없이 띄우는 다른 방법(S4U)은 관리자 권한이 필요하다
#   PowerShell -WindowStyle Hidden 은 대화형 작업에서 콘솔 창이 그대로 보여서 사용자가 닫아 버리는 사고가 났다
# - 래퍼 때문에 Stop-ScheduledTask 는 래퍼만 죽이고 node 는 남는다 → 반드시 stop.ps1 로 멈춘다
# - 래퍼는 node 의 종료 코드를 그대로 돌려줘서 node 가 죽으면 스케줄러가 1분 뒤 다시 띄운다 (3회)
# - 스케줄러 환경에는 사용자 PATH 가 없을 수 있어 claude.exe 경로를 인자로 넘긴다. 로그는 node 가 직접 쓴다
$ErrorActionPreference = 'Stop'

$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$node = (Get-Command node.exe).Source
$claude = (Get-Command claude.exe).Source
$tsx = Join-Path $repo 'node_modules\tsx\dist\cli.mjs'
if (-not (Test-Path $tsx)) { throw "tsx 없음. 먼저 npm install 을 실행하세요: $tsx" }
# 로그 폴더는 만들지 않는다: 호스트·서버가 옛 설정 폴더 ~/.claude/jk-corp 를 ~/.claude/pray 로 옮긴 뒤 만든다 (먼저 만들면 pray 가 생겨 옮기지 않는다)
$logDir = Join-Path $env:USERPROFILE '.claude\pray\logs'

$settings = New-ScheduledTaskSettingsSet `
    -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -MultipleInstances IgnoreNew `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

$launcher = Join-Path $PSScriptRoot 'launch-hidden.vbs'

function Register-PrayTask {
    param([string]$Name, [string]$LogName, [string]$WorkDir, [string[]]$ExtraArgs, [string]$Description)
    # 로그 이름은 작업 이름과 따로: 이미 pray 폴더 안이라 앞말 없이 host.log·server.log (트레이와 같은 이름)
    $log = Join-Path $logDir "$LogName.log"
    # 인자마다 따옴표로 감싸 wscript 에 넘기고, VBS 가 다시 따옴표를 붙여 node 명령줄을 만든다 (중첩 따옴표 회피)
    $pieces = @($launcher, $WorkDir, $node, $tsx, 'src/index.ts', "--log=$log") + $ExtraArgs
    $argument = '//B //Nologo ' + (($pieces | ForEach-Object { '"' + $_ + '"' }) -join ' ')
    $action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument $argument -WorkingDirectory $WorkDir
    Register-ScheduledTask -TaskName $Name -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description $Description -Force | Out-Null
    Write-Host "등록: $Name ($WorkDir)"
}

foreach ($name in 'jk-corp-server', 'jk-corp-host') {
    if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) {
        Stop-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
        Unregister-ScheduledTask -TaskName $name -Confirm:$false
        Write-Host "옛 작업 제거: $name (떠 있던 node 는 stop.ps1 로 멈춘다)"
    }
}
Register-PrayTask -Name 'pray-host' -LogName 'host' -WorkDir (Join-Path $repo 'host') -ExtraArgs @("--claude=$claude") -Description 'Pray 세션 호스트 (claude 프로세스 보관)'
Register-PrayTask -Name 'pray-server' -LogName 'server' -WorkDir (Join-Path $repo 'server') -ExtraArgs @() -Description 'Pray 서버 (http://127.0.0.1:4710)'

Write-Host "로그: $logDir"
Write-Host '지금 시작: Start-ScheduledTask pray-host; Start-ScheduledTask pray-server'
Write-Host '중지: scripts\stop.ps1'
