# 호스트·서버를 멈춘다. Stop-ScheduledTask 는 숨김 래퍼만 죽이고 node 는 남기므로 node 까지 직접 죽인다.
# 주의: 호스트를 멈추면 웹 세션(claude 프로세스)도 같이 죽는다. 다음 시작 때 --resume 으로 복구된다.
foreach ($name in 'jk-corp-server', 'jk-corp-host') {
    Stop-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
}
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -like "*$repo*" -and $_.CommandLine -like '*src/index.ts*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; Write-Host "종료: node $($_.ProcessId)" }
