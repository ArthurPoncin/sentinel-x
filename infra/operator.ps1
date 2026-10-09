# Readies the Operator laptop (Windows) for the dashboard, once, on the table Wi-Fi: fetches the
# team CA from the Pi (scp), trusts it for the whole machine (Chrome, Edge and Firefox read that
# store) and gives the Pi its name in the hosts file: the table Wi-Fi has no DNS.
# After it, https://sentinel-x.local/ opens with no warning. Linux and macOS: infra/operator.sh.
# In a PowerShell opened as administrator, from the repo:
#   powershell -ExecutionPolicy Bypass -File infra\operator.ps1 <table number> <your user on the Pi> [the repo's directory on the Pi]
# Its messages have no accents: Windows PowerShell reads a script without a BOM as ANSI.
param(
  [Parameter(Mandatory = $true)][ValidateRange(0, 254)][int]$Table,
  [Parameter(Mandatory = $true)][string]$PiUser,
  [string]$PiDir = "sentinel-x"
)
$ErrorActionPreference = "Stop"

$piIp = "192.168.$Table.1"
$piName = "sentinel-x.local"
$caName = "Sentinel-X Team CA"

$admin = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $admin.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw "Ouvre PowerShell en administrateur (clic droit, Executer en tant qu'administrateur), puis relance."
}

Write-Host "`n1. Le certificat de l'equipe, pris sur le Pi ($piIp)"
$ca = Join-Path $env:TEMP "sentinel-x-ca.crt"
# ssh's errors are kept, for scp to say why it fails: its warnings only are left out.
scp -o LogLevel=ERROR "${PiUser}@${piIp}:$PiDir/infra/secrets/ca.crt" $ca
if ($LASTEXITCODE -ne 0) { throw "scp n'a pas pris le certificat sur le Pi, sa raison est juste au-dessus. 'timed out' : ce PC n'est pas sur le Wi-Fi SentinelX-$Table, ou le Pi est durci et SSH ne repond qu'au PC Operateur. 'Permission denied' : l'utilisateur du Pi ou son mot de passe. 'No such file' : le depot n'est pas dans ~/$PiDir sur le Pi, donne son dossier en 3e argument." }
$cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2 $ca
if ($cert.Subject -notmatch [regex]::Escape($caName)) { throw "Ce fichier n'est pas le certificat de l'equipe ($caName)." }
Write-Host "  empreinte SHA-1 $($cert.Thumbprint)"

Write-Host "`n2. Autorite de confiance sur ce PC"
# In place of the CA of another install, if there is one.
Get-ChildItem Cert:\LocalMachine\Root | Where-Object { $_.Subject -match [regex]::Escape($caName) } | Remove-Item
Import-Certificate -FilePath $ca -CertStoreLocation Cert:\LocalMachine\Root | Out-Null
Remove-Item $ca
Write-Host "  magasin de l'ordinateur : Chrome, Edge et Firefox"

Write-Host "`n3. Le nom du Pi dans le fichier hosts"
$hosts = "$env:SystemRoot\System32\drivers\etc\hosts"
# Without the line of another table, if there is one.
$lines = @(Get-Content $hosts | Where-Object { $_ -notmatch "\s$([regex]::Escape($piName))\s*$" })
$lines += "$piIp $piName"
Set-Content -Path $hosts -Value $lines -Encoding ascii
Write-Host "  $piIp $piName"

Write-Host "`nFerme et rouvre le navigateur, puis ouvre https://$piName/"
