<#
.SYNOPSIS
  Ship staged/working changes to pinion-md's protected main via the required PR + hygiene flow.

.DESCRIPTION
  main is a protected branch: direct `git push origin main` is rejected because the `hygiene`
  status check only runs on a pull request. This script does the supported flow end to end:
  stage -> commit -> push branch -> open PR -> wait for checks -> merge -> sync local main.

.PARAMETER Message
  Commit message (also used as the PR title).

.PARAMETER Files
  Optional list of paths to stage. If omitted, stages all tracked changes (git add -A).

.PARAMETER Branch
  Optional branch name. Defaults to a slug derived from the commit message.

.PARAMETER NoMerge
  Open the PR but do not auto-merge (leave it for review).

.EXAMPLE
  .\scripts\ship.ps1 -Message "Tidy feather icon" -Files icon.svg,icon-192.png
#>
param(
  [Parameter(Mandatory = $true)][string]$Message,
  [string[]]$Files,
  [string]$Branch,
  [switch]$NoMerge
)

$ErrorActionPreference = 'Stop'
$repo = "C:\Users\Adam\source\repos\pinion-md"
Set-Location $repo

# Clear any stale lock left by an interrupted git op.
if (Test-Path ".git\index.lock") { Remove-Item ".git\index.lock" -Force }

# Ensure the repo-local commit identity is set (global is intentionally unset).
if (-not (git config user.email)) {
  git config user.name  "buildwithbaker"
  git config user.email "bakeradm6@gmail.com"
}

# Derive a branch name from the message if none given.
if (-not $Branch) {
  $slug = ($Message.ToLower() -replace '[^a-z0-9]+', '-').Trim('-')
  if ($slug.Length -gt 40) { $slug = $slug.Substring(0, 40).Trim('-') }
  $Branch = "ship/$slug"
}

git checkout -b $Branch

if ($Files) { git add -- $Files } else { git add -A }

# Nothing to commit? Bail cleanly.
if (-not (git status --porcelain)) {
  Write-Host "No changes to commit." -ForegroundColor Yellow
  git checkout main; git branch -D $Branch
  exit 0
}

git commit -m $Message
git push -u origin $Branch

gh pr create --base main --head $Branch --title $Message --body @"
$Message

🤖 Generated with [Claude Code](https://claude.com/claude-code)
"@

if ($NoMerge) {
  Write-Host "PR opened (not merged). Review it on GitHub." -ForegroundColor Cyan
  exit 0
}

# Wait for required checks, then merge.
Write-Host "Waiting for required checks..." -ForegroundColor Cyan
gh pr checks $Branch --watch
gh pr merge $Branch --merge --delete-branch

# Sync local main.
git checkout main
git pull origin main
Write-Host "Shipped. main is now at:" -ForegroundColor Green
git log -1 --format="%h %s"
