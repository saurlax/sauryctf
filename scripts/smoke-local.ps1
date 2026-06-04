param(
  [string]$BaseUrl = "http://127.0.0.1:8080",
  [string]$AdminUsername = "admin",
  [string]$AdminPassword = "sauryctf"
)

$ErrorActionPreference = "Stop"

function Write-Step {
  param([string]$Message)
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Fail {
  param([string]$Message)
  Write-Error $Message
  exit 1
}

function Invoke-JsonRequest {
  param(
    [Parameter(Mandatory = $true)][string]$Method,
    [Parameter(Mandatory = $true)][string]$Url,
    [Parameter()][object]$Body,
    [Parameter()][Microsoft.PowerShell.Commands.WebRequestSession]$Session
  )

  $params = @{
    Method      = $Method
    Uri         = $Url
    ContentType = "application/json"
  }

  if ($Session) {
    $params.WebSession = $Session
  }

  if ($null -ne $Body) {
    $params.Body = ($Body | ConvertTo-Json -Depth 10)
  }

  return Invoke-RestMethod @params
}

function Assert-Equal {
  param(
    [Parameter(Mandatory = $true)]$Actual,
    [Parameter(Mandatory = $true)]$Expected,
    [Parameter(Mandatory = $true)][string]$Message
  )

  if ($Actual -ne $Expected) {
    Fail "$Message`nExpected: $Expected`nActual:   $Actual"
  }
}

function Assert-True {
  param(
    [Parameter(Mandatory = $true)][bool]$Condition,
    [Parameter(Mandatory = $true)][string]$Message
  )

  if (-not $Condition) {
    Fail $Message
  }
}

$suffix = Get-Date -Format "yyyyMMddHHmmss"
$playerUsername = "smoke-$suffix"
$playerEmail = "$playerUsername@example.com"
$playerPassword = "smoke-pass-123"
$teamName = "Smoke Team $suffix"
$gameName = "Smoke Game $suffix"
$challengeTitle = "Smoke Challenge $suffix"
$flag = "flag{smoke-test}"
$now = (Get-Date).ToUniversalTime()
$startTime = $now.AddMinutes(-5).ToString("o")
$endTime = $now.AddHours(2).ToString("o")

Write-Step "Checking backend health"
$health = Invoke-JsonRequest -Method "GET" -Url "$BaseUrl/api/healthz"
Assert-Equal $health.status "ok" "Backend health check failed."

Write-Step "Checking bootstrap admin availability"
$setupStatus = Invoke-JsonRequest -Method "GET" -Url "$BaseUrl/api/auth/setup-status"
Assert-True ($setupStatus.bootstrap_admin_available -eq $true) "Bootstrap admin is not available. This smoke script is intended for a fresh database with no existing users."
Assert-Equal $setupStatus.default_admin_username $AdminUsername "Bootstrap admin username mismatch."

Write-Step "Logging in bootstrap admin"
$adminSession = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$adminLogin = Invoke-JsonRequest -Method "POST" -Url "$BaseUrl/api/auth/login" -Body @{
  username = $AdminUsername
  password = $AdminPassword
} -Session $adminSession
Assert-Equal $adminLogin.user.username $AdminUsername "Admin login did not return the expected user."

Write-Step "Creating public contest"
$game = Invoke-JsonRequest -Method "POST" -Url "$BaseUrl/api/games" -Body @{
  name              = $gameName
  description       = "Automated local smoke flow"
  start_time        = $startTime
  end_time          = $endTime
  is_public         = $true
  registration_mode = "auto_accept"
} -Session $adminSession
Assert-Equal $game.name $gameName "Failed to create smoke contest."

Write-Step "Creating challenge"
$challenge = Invoke-JsonRequest -Method "POST" -Url "$BaseUrl/api/challenges" -Body @{
  title       = $challengeTitle
  description = "Automated smoke challenge"
  category    = "misc"
  type        = "static"
  flag        = $flag
  base_score  = 500
  is_visible  = $true
} -Session $adminSession
Assert-Equal $challenge.title $challengeTitle "Failed to create smoke challenge."

Write-Step "Attaching challenge to contest"
$attachResult = Invoke-JsonRequest -Method "POST" -Url "$BaseUrl/api/games/$($game.id)/challenges" -Body @{
  challenge_id = $challenge.id
} -Session $adminSession
Assert-Equal $attachResult.message "added" "Challenge attach did not succeed."

Write-Step "Activating contest"
$updatedGame = Invoke-JsonRequest -Method "PUT" -Url "$BaseUrl/api/games/$($game.id)" -Body @{
  status = "active"
} -Session $adminSession
Assert-Equal $updatedGame.status "active" "Contest was not activated."

Write-Step "Registering player account"
$playerSession = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$playerRegister = Invoke-JsonRequest -Method "POST" -Url "$BaseUrl/api/auth/register" -Body @{
  username = $playerUsername
  email    = $playerEmail
  password = $playerPassword
} -Session $playerSession
Assert-Equal $playerRegister.user.username $playerUsername "Player registration did not return the expected user."

Write-Step "Creating player team"
$teamResult = Invoke-JsonRequest -Method "POST" -Url "$BaseUrl/api/teams" -Body @{
  name = $teamName
} -Session $playerSession
Assert-Equal $teamResult.team.name $teamName "Failed to create player team."

Write-Step "Joining contest"
$joinResult = Invoke-JsonRequest -Method "POST" -Url "$BaseUrl/api/games/$($game.id)/join" -Body @{
  team_id = $teamResult.team.id
} -Session $playerSession
Assert-Equal $joinResult.message "joined" "Join contest request did not succeed."

Write-Step "Checking participation state"
$participation = Invoke-JsonRequest -Method "GET" -Url "$BaseUrl/api/games/$($game.id)/participation" -Session $playerSession
Assert-True ($participation.participated -eq $true) "Participation response does not show the player team as joined."
Assert-Equal $participation.status "accepted" "Auto-accept contest did not produce accepted participation."

Write-Step "Submitting correct flag"
$submitResult = Invoke-JsonRequest -Method "POST" -Url "$BaseUrl/api/games/$($game.id)/challenges/$($challenge.id)/submit" -Body @{
  team_id = $teamResult.team.id
  flag    = $flag
} -Session $playerSession
Assert-True ($submitResult.correct -eq $true) "Correct flag submission was not accepted."

Write-Step "Validating public scoreboard"
$scoreboard = Invoke-JsonRequest -Method "GET" -Url "$BaseUrl/api/games/$($game.id)/scoreboard"
Assert-True ($scoreboard.entries.Count -ge 1) "Public scoreboard is empty after a correct solve."

$entry = $scoreboard.entries | Where-Object { $_.team_name -eq $teamName } | Select-Object -First 1
Assert-True ($null -ne $entry) "Player team was not found in the public scoreboard."
Assert-True ($entry.score -ge 1) "Player team scoreboard score was not updated."

Write-Host ""
Write-Host "Smoke flow passed." -ForegroundColor Green
Write-Host "Contest: $gameName"
Write-Host "Challenge: $challengeTitle"
Write-Host "Player: $playerUsername"
Write-Host "Team: $teamName"
