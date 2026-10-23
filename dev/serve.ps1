# Dev-only static file server (Windows PowerShell, no installs) used to run the browser test
# harness when Node.js is not available locally. Not used in production.
param([int]$Port = 8765)
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$types = @{ '.html'='text/html; charset=utf-8'; '.js'='text/javascript; charset=utf-8'; '.css'='text/css; charset=utf-8'; '.json'='application/json; charset=utf-8'; '.svg'='image/svg+xml'; '.sql'='text/plain; charset=utf-8'; '.txt'='text/plain; charset=utf-8'; '.wasm'='application/wasm' }
$l = New-Object System.Net.HttpListener
$l.Prefixes.Add("http://localhost:$Port/")
$l.Start()
Write-Output "serving $root on http://localhost:$Port/"
while ($l.IsListening) {
  $ctx = $l.GetContext()
  $path = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart('/')
  if ($path -eq '') { $path = 'dev/harness/run-tests.html' }
  $full = [IO.Path]::GetFullPath((Join-Path $root $path))
  try {
    if (-not $full.StartsWith($root) -or -not (Test-Path $full -PathType Leaf)) { $ctx.Response.StatusCode = 404; $b = [Text.Encoding]::UTF8.GetBytes('not found') }
    else { $b = [IO.File]::ReadAllBytes($full); $ext = [IO.Path]::GetExtension($full); $ctx.Response.ContentType = $(if ($types[$ext]) { $types[$ext] } else { 'application/octet-stream' }) }
    $ctx.Response.Headers.Add('Cache-Control', 'no-store')
    $ctx.Response.OutputStream.Write($b, 0, $b.Length)
  } catch {} finally { $ctx.Response.Close() }
}
