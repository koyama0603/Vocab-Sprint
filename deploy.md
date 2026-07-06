作業場所はここです。

cd C:\Users\koyam\Documents\Codex\HTML-English-Word-App\Word-Rush

1. 事前チェック

node --check .\js\game.js
node --check .\js\main.js
node --check .\js\levels.config.js
npm run generate:cache
git diff --check
git diff -- ..\appgallery-single-html\index.html


2. dist を作り直す

$root = (Resolve-Path -LiteralPath '.').Path
$distPath = Join-Path $root 'dist'

if (Test-Path -LiteralPath $distPath) {
  Remove-Item -LiteralPath $distPath -Recurse -Force
}

New-Item -ItemType Directory -Path $distPath | Out-Null

$files = @('index.html','sw.js','manifest.webmanifest','cache-manifest.json','_headers')
foreach ($file in $files) {
  Copy-Item -LiteralPath (Join-Path $root $file) -Destination (Join-Path $distPath $file) -Force
}

$dirs = @('css','js','data','assets')
foreach ($dir in $dirs) {
  Copy-Item -LiteralPath (Join-Path $root $dir) -Destination (Join-Path $distPath $dir) -Recurse -Force
}

$readme = Join-Path $distPath 'data\README.md'
if (Test-Path -LiteralPath $readme) {
  Remove-Item -LiteralPath $readme -Force
}

3. Cloudflareへデプロイ

npx --yes wrangler@latest deploy

4. 本番確認

Invoke-WebRequest -Uri 'https://wordrush.myshortcuts.workers.dev/' -UseBasicParsing
Invoke-RestMethod -Uri 'https://wordrush.myshortcuts.workers.dev/cache-manifest.json'

5. Gitに保存してpush

cd C:\Users\koyam\Documents\Codex\HTML-English-Word-App
git status --short
git add Word-Rush
git commit -m "変更内容が分かるメッセージ"
git push origin main

