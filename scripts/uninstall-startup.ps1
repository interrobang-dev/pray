# install-startup.ps1 이 등록한 작업을 멈추고 제거한다.
& (Join-Path $PSScriptRoot 'stop.ps1')
foreach ($name in 'jk-corp-server', 'jk-corp-host') {
    if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $name -Confirm:$false
        Write-Host "제거: $name"
    }
}
