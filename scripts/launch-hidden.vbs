' 창 없이 명령을 실행한다. wscript 는 GUI 프로그램이라 콘솔이 없고, 자식은 창 스타일 0(숨김)으로 띄운다.
' 사용: wscript //B //Nologo launch-hidden.vbs <작업폴더> <실행파일> [인자...]
' 자식이 끝날 때까지 기다렸다가 그 종료 코드를 그대로 돌려준다 (작업 스케줄러의 실패 재시작용).
Option Explicit
Dim shell, args, command, index
Set shell = CreateObject("WScript.Shell")
Set args = WScript.Arguments
If args.Count < 2 Then WScript.Quit 2
shell.CurrentDirectory = args(0)
command = ""
For index = 1 To args.Count - 1
    command = command & """" & args(index) & """ "
Next
WScript.Quit shell.Run(command, 0, True)
