# Downloads local copies of the enabled real feeds into dev/.fixtures for the browser harness
# (dev/harness/live.html and ui.html). Copies are third-party content: keep them local only.
$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$fx = Join-Path $root 'dev\.fixtures'
New-Item -ItemType Directory -Force $fx | Out-Null
$src = Get-Content (Join-Path $root 'src\sources.js') -Raw -Encoding UTF8
$ms = [regex]::Matches($src, "\{ key: '([a-z0-9_]+)', name: '[^']*', url: '([^']+)', type: '(\w+)'[^\n]*enabled: (true|false)")
$map = @{}
foreach ($m in $ms) {
  if ($m.Groups[4].Value -ne 'true') { continue }
  $k = $m.Groups[1].Value; $u = $m.Groups[2].Value; $out = Join-Path $fx "$k.txt"
  $code = & curl.exe -s -L --max-time 40 -A "SaudiNewsDigest/1.0 (+news aggregator)" -o $out -w "%{http_code}" $u
  $map[$u] = "$k.txt"; Write-Output "$code $k"
}
$spa = Get-Content (Join-Path $fx 'spa.txt') -Raw -Encoding UTF8
$ids = [regex]::Matches($spa, '"uuid":"(N\d{6,})"') | ForEach-Object { $_.Groups[1].Value } | Select-Object -Unique -First 6
foreach ($id in $ids) { $u = "https://www.spa.gov.sa/$id"; & curl.exe -s -L --max-time 40 -o (Join-Path $fx "spa_$id.txt") $u; $map[$u] = "spa_$id.txt" }
$map | ConvertTo-Json | Out-File (Join-Path $fx 'map.json') -Encoding utf8
