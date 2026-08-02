Option Explicit

Dim shell, projectPath, command
Set shell = CreateObject("WScript.Shell")

projectPath = "C:\Users\aaa\Desktop\youtube\repo\luna-one"
command = "cmd /c cd /d """ & projectPath & """ && node server.js"

' 0 = hide the command window, False = keep the server running in the background.
shell.Run command, 0, False
WScript.Sleep 2000
shell.Run "http://localhost:4174", 1, False

Set shell = Nothing
