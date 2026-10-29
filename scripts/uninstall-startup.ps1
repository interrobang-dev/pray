# install-startup.ps1 이 등록한 작업을 멈추고 제거한다.
& (Join-Path $PSScriptRoot 'stop.ps1')
# 옛 이름(jk-corp-*) 작업도 같이 지운다 — 이름을 바꾸기 전에 등록한 PC 에 남아 있을 수 있다 (호환 코드)
foreach ($name in 'pray-server', 'pray-host', 'jk-corp-server', 'jk-corp-host') {
    if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $name -Confirm:$false
        Write-Host "제거: $name"
    }
}
