param([string]$Destination='C:\Users\jenal\Dev\riceguard-gemini-release-20261023')
$ErrorActionPreference='Stop'
$repo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$receipt=Get-Content -LiteralPath (Join-Path $repo 'docs/gemini-live-baseline.json') -Raw | ConvertFrom-Json
$assets=Get-Content -LiteralPath (Join-Path $repo 'docs/gemini-live-assets.json') -Raw | ConvertFrom-Json
$target=[IO.Path]::GetFullPath($Destination)
if($target -ne 'C:\Users\jenal\Dev\riceguard-gemini-release-20261023'){throw 'Unapproved release target'}
if(Test-Path -LiteralPath $target){throw 'Release target already exists; inspect it rather than overwrite'}
if(!$receipt.all_checked_match -or @($assets|Where-Object {!$_.matches}).Count){throw 'Baseline verification incomplete'}
$baseline=@($receipt.checked)+@($assets)
function Safe-Path($root,$relative){
  $path=[IO.Path]::GetFullPath((Join-Path $root $relative))
  if(!$path.StartsWith($root+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Path escaped scope'}
  return $path
}
# Reverify all selected baseline bytes before creating anything. No broad copy.
foreach($item in $baseline){
  $source=Safe-Path $receipt.stage $item.path
  if((Get-FileHash -LiteralPath $source -Algorithm SHA1).Hash.ToLower() -ne $item.expected){throw "Changed baseline: $($item.path)"}
}
New-Item -ItemType Directory -Path $target | Out-Null
function Copy-Scoped($root,$relative){
  $source=Safe-Path $root $relative
  $destination=Safe-Path $target $relative
  New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($destination)) -Force | Out-Null
  Copy-Item -LiteralPath $source -Destination $destination
  if((Get-FileHash -LiteralPath $source).Hash -ne (Get-FileHash -LiteralPath $destination).Hash){throw "Copy verification failed: $relative"}
}
foreach($item in $baseline){Copy-Scoped $receipt.stage $item.path}
# Explicit overlays: no user data, unrelated source, QA fixtures or secrets.
$overlay=@(
  'frontend/src/app/router.tsx','frontend/src/components/guards/ProtectedRoute.tsx',
  'frontend/src/pages/public/Login.tsx','frontend/src/operations/GeminiConnection.tsx',
  'frontend/src/operations/geminiConnector.ts','vercel.json',
  'supabase/functions/advisory-mcp/index.ts','supabase/functions/advisory-mcp/deno.json',
  'supabase/functions/advisory-mcp/deno.lock','supabase/functions/_shared/awsSigV4.ts',
  'supabase/functions/_shared/advisoryEvidence.ts',
  'supabase/migrations/20261022185322_gemini_advisory_connector.sql'
)
$overlay+=Get-ChildItem -LiteralPath (Join-Path $repo 'supabase/functions/_shared/geminiConnector') -Filter '*.ts' -File |
  ForEach-Object {'supabase/functions/_shared/geminiConnector/'+$_.Name}
foreach($path in $overlay){Copy-Scoped $repo $path}
Write-Output "Assembled local-only release from $($receipt.deployment): $($baseline.Count) verified baseline files, $($overlay.Count) explicit overlays."
Write-Output 'No deployment, grants, data mutation, dependency install or credential copy performed.'
