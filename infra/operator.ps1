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
scp -q "${PiUser}@${piIp}:$PiDir/infra/secrets/ca.crt" $ca
if ($LASTEXITCODE -ne 0) { throw "Le Pi ne repond pas : connecte ce PC au Wi-Fi SentinelX-$Table, puis relance." }
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
