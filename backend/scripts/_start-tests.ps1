$env:MONGOMS_VERSION = "7.0.14"
$log = "C:\Users\ADMINI~1\AppData\Local\Temp\opencode\jest-run.log"
$err = "C:\Users\ADMINI~1\AppData\Local\Temp\opencode\jest-run.err.log"
Remove-Item $log,$err -ErrorAction SilentlyContinue
$p = Start-Process -FilePath "npm.cmd" -ArgumentList "test" -WorkingDirectory "C:\Users\Administrator\Desktop\AWT\backend" -RedirectStandardOutput $log -RedirectStandardError $err -WindowStyle Hidden -PassThru
Set-Content "C:\Users\ADMINI~1\AppData\Local\Temp\opencode\jest.pid" $p.Id
Write-Output "started jest pid $($p.Id)"