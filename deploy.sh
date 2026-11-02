#!/bin/sh
# Copy the app to desktop and restart its scheduled task. node_modules and data/ stay on the host.
set -e
cd "$(dirname "$0")"
COPYFILE_DISABLE=1 tar --exclude=node_modules --exclude=data --exclude=.git --exclude=deploy.sh -czf /tmp/paddock-deploy.tgz .
scp -q /tmp/paddock-deploy.tgz kangw@desktop:C:/Users/kangw/src/paddock-deploy.tgz
rm /tmp/paddock-deploy.tgz
ssh kangw@desktop 'Set-Location C:\Users\kangw\src\paddock; tar -xzf ..\paddock-deploy.tgz; Remove-Item ..\paddock-deploy.tgz; Stop-ScheduledTask Paddock; Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }; npm ci --silent --omit=dev 2>&1 | Out-Null; Start-ScheduledTask Paddock; Start-Sleep 3; (Get-ScheduledTask Paddock).State'
