# deploy/deploy.ps1 — builda web e sobe pro devilsworks (padrão manduu-apps)
$proj = Split-Path $PSScriptRoot -Parent
Push-Location $proj
npm run build:web
Pop-Location
ssh devilsworks 'mkdir -p /home/ubuntu/excalidraw-ray'
scp "$proj/server/server.mjs" devilsworks:/home/ubuntu/excalidraw-ray/
scp -r "$proj/server/public" devilsworks:/home/ubuntu/excalidraw-ray/
ssh devilsworks 'sudo systemctl restart excalidraw-ray && sleep 1 && curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8050/'
