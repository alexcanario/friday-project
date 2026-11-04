# Creates the user-owned GitHub Project "Friday", its "Estado" field, links it to
# the repository, adds every issue and sets the variable/secret used by
# .github/workflows/project-sync.yml. Run once, from PowerShell, with gh logged in.
# The token is typed in a hidden prompt by `gh secret set`; it is never written here.

$ErrorActionPreference = 'Stop'
$Owner = 'alexcanario'
$Repo  = 'alexcanario/friday-project'

gh auth refresh -s project

$project = gh project create --owner $Owner --title 'Friday' --format json | ConvertFrom-Json
$number  = $project.number
Write-Host "Project number: $number"

gh project link $number --owner $Owner --repo $Repo
gh project field-create $number --owner $Owner --name 'Estado' --data-type SINGLE_SELECT `
  --single-select-options 'Backlog,Ready,In progress,In review,Needs you,Blocked,Done,Discarded'

$issues = gh issue list --repo $Repo --state all --limit 200 --json url | ConvertFrom-Json
foreach ($i in $issues) { gh project item-add $number --owner $Owner --url $i.url | Out-Null }
Write-Host "Added $($issues.Count) issues."

gh variable set PROJECT_NUMBER --repo $Repo --body "$number"
Write-Host 'Paste a classic PAT with scopes "project" and "repo" (input is hidden):'
gh secret set PROJECT_TOKEN --repo $Repo

# Re-trigger the sync once for every open issue so "Estado" gets filled.
$open = gh issue list --repo $Repo --state open --limit 200 --json number | ConvertFrom-Json
foreach ($i in $open) {
  gh issue edit $i.number --repo $Repo --add-label 'sync:touch' | Out-Null
  gh issue edit $i.number --repo $Repo --remove-label 'sync:touch' | Out-Null
}
Write-Host "Done. Open https://github.com/users/$Owner/projects/$number and group the board by 'Estado'."
