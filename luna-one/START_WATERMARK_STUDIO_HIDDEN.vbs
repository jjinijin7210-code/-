Option Explicit

Dim shell, fso, baseDir, serverScript, command
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

baseDir = fso.GetParentFolderName(WScript.ScriptFullName)
serverScript = fso.BuildPath(baseDir, "watermark-studio\server.js")

' 창 표시 없이 로컬 서버를 시작한다. 이미 실행 중이면 새 서버는 바로 종료되고 기존 서버를 사용한다.
command = "cmd.exe /c cd /d """ & baseDir & """ && node """ & serverScript & """"
shell.Run command, 0, False

' 서버가 준비될 시간을 준 뒤 기본 브라우저로 스튜디오를 연다.
WScript.Sleep 1500
shell.Run "http://localhost:3333/", 1, False
