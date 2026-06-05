param(
  [string]$BaseUrl = "http://127.0.0.1:8080",
  [string]$AdminUsername = "admin",
  [string]$AdminPassword = "sauryctf",
  [ValidateSet("mock", "docker")][string]$DynamicMode = "mock"
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

function Assert-False {
  param(
    [Parameter(Mandatory = $true)][bool]$Condition,
    [Parameter(Mandatory = $true)][string]$Message
  )

  if ($Condition) {
    Fail $Message
  }
}

function Invoke-TextRequest {
  param(
    [Parameter(Mandatory = $true)][string]$Url
  )

  return Invoke-WebRequest -Method "GET" -Uri $Url
}

$suffix = Get-Date -Format "yyyyMMddHHmmss"
$playerUsername = "smoke-$suffix"
$playerEmail = "$playerUsername@example.com"
$playerPassword = "smoke-pass-123"
$teamName = "Smoke Team $suffix"
$gameName = "Smoke Game $suffix"
$challengeTitle = "Smoke Challenge $suffix"
$dynamicChallengeTitle = "Smoke Dynamic Challenge $suffix"
$dynamicChallengeImage = if ($DynamicMode -eq "docker") { "nginx:alpine" } else { "ctf/example:latest" }
$flag = "flag{smoke-test}"
$now = (Get-Date).ToUniversalTime()
$startTime = $now.AddMinutes(-5).ToString("o")
$endTime = $now.AddHours(2).ToString("o")

Write-Step "Checking backend health"
$health = Invoke-JsonRequest -Method "GET" -Url "$BaseUrl/api/healthz"
Assert-Equal $health.status "ok" "Backend health check failed."

if ($DynamicMode -eq "docker") {
  Write-Step "Checking local Docker prerequisites"
  $dockerCheck = Invoke-Command -ScriptBlock { docker version --format '{{.Server.Version}}' } 2>$null
  Assert-True (-not [string]::IsNullOrWhiteSpace(($dockerCheck | Out-String).Trim())) "Docker server is not reachable. Please start Docker Desktop or switch back to -DynamicMode mock."
}

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

Write-Step "Creating dynamic challenge"
$dynamicChallenge = Invoke-JsonRequest -Method "POST" -Url "$BaseUrl/api/challenges" -Body @{
  title          = $dynamicChallengeTitle
  description    = if ($DynamicMode -eq "docker") { "Automated dynamic smoke challenge (real docker mode)" } else { "Automated dynamic smoke challenge" }
  category       = "web"
  type           = "dynamic"
  flag           = "flag{dynamic-smoke}"
  base_score     = 300
  min_score      = 100
  decay_rate     = 0.1
  is_visible     = $true
  container_spec = (@{
    runtime = @{
      provider = "docker"
      image    = $dynamicChallengeImage
      expose   = if ($DynamicMode -eq "docker") { @(80) } else { @(8080) }
    }
    connection = if ($DynamicMode -eq "docker") {
      @{
        note = "Real local docker smoke instance for team {{team_id}}"
      }
    } else {
      @{
        url     = "/mock-instance/{{game_id}}/{{challenge_id}}/{{team_hash}}?team={{team_id}}"
        host    = "127.0.0.1"
        port    = "{{team_id}}"
        command = "open /mock-instance/{{game_id}}/{{challenge_id}}/{{team_hash}}?team={{team_id}}"
        note    = "Dynamic smoke instance for team {{team_id}}"
      }
    }
  } | ConvertTo-Json -Depth 10 -Compress)
} -Session $adminSession
Assert-Equal $dynamicChallenge.title $dynamicChallengeTitle "Failed to create dynamic smoke challenge."

Write-Step "Attaching challenge to contest"
$attachResult = Invoke-JsonRequest -Method "POST" -Url "$BaseUrl/api/games/$($game.id)/challenges" -Body @{
  challenge_id = $challenge.id
} -Session $adminSession
Assert-Equal $attachResult.message "added" "Challenge attach did not succeed."

Write-Step "Attaching dynamic challenge to contest"
$dynamicAttachResult = Invoke-JsonRequest -Method "POST" -Url "$BaseUrl/api/games/$($game.id)/challenges" -Body @{
  challenge_id = $dynamicChallenge.id
} -Session $adminSession
Assert-Equal $dynamicAttachResult.message "added" "Dynamic challenge attach did not succeed."

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

Write-Step "Checking dynamic instance idle state"
$instanceIdle = Invoke-JsonRequest -Method "GET" -Url "$BaseUrl/api/games/$($game.id)/challenges/$($dynamicChallenge.id)/instance" -Session $playerSession
Assert-Equal $instanceIdle.status "idle" "Dynamic challenge instance should start in idle state."
Assert-True ($instanceIdle.can_start -eq $true) "Dynamic challenge instance should be startable before first lease."
Assert-Equal $instanceIdle.policy.lease_duration_minutes 30 "Dynamic challenge idle policy should expose the initial lease duration."
Assert-Equal $instanceIdle.policy.extension_duration_minutes 30 "Dynamic challenge idle policy should expose the renewal extension duration."
Assert-Equal $instanceIdle.policy.renewal_window_minutes 10 "Dynamic challenge idle policy should expose the renewal window."
Assert-Equal $instanceIdle.policy.team_active_limit 3 "Dynamic challenge idle policy should expose the per-team active instance limit."
Assert-Equal $instanceIdle.provider "docker" "Dynamic challenge instance should inherit runtime provider."

Write-Step "Starting dynamic instance lease"
$instanceRunning = Invoke-JsonRequest -Method "POST" -Url "$BaseUrl/api/games/$($game.id)/challenges/$($dynamicChallenge.id)/instance" -Session $playerSession
Assert-Equal $instanceRunning.status "running" "Dynamic challenge instance was not started."
Assert-Equal $instanceRunning.policy.lease_duration_minutes 30 "Dynamic challenge running policy should expose the initial lease duration."
Assert-Equal $instanceRunning.policy.extension_duration_minutes 30 "Dynamic challenge running policy should expose the renewal extension duration."
Assert-Equal $instanceRunning.policy.renewal_window_minutes 10 "Dynamic challenge running policy should expose the renewal window."
Assert-Equal $instanceRunning.policy.team_active_limit 3 "Dynamic challenge running policy should expose the per-team active instance limit."
Assert-False ($instanceRunning.can_renew -eq $true) "Dynamic challenge instance should not be renewable immediately after start."
Assert-True (-not [string]::IsNullOrWhiteSpace($instanceRunning.message)) "Dynamic challenge instance should explain the current renewal window."
Assert-True (-not [string]::IsNullOrWhiteSpace($instanceRunning.launch_url)) "Dynamic challenge instance did not return a launch URL."
Assert-True (-not [string]::IsNullOrWhiteSpace($instanceRunning.host)) "Dynamic challenge instance did not return a host."
Assert-False ($instanceRunning.launch_url.Contains("{{")) "Dynamic challenge launch URL still contains unresolved template placeholders."
Assert-False ($instanceRunning.host.Contains("{{")) "Dynamic challenge host still contains unresolved template placeholders."

if ($DynamicMode -eq "docker") {
  Assert-True ($instanceRunning.launch_url.StartsWith("http://127.0.0.1:")) "Dynamic challenge launch URL does not point to a local docker published port."
  Assert-Equal $instanceRunning.host "127.0.0.1" "Dynamic challenge docker host should resolve to 127.0.0.1."
  Assert-True ($instanceRunning.port -match '^\d+$') "Dynamic challenge docker port should resolve to a numeric host port."

  Write-Step "Validating published docker web entry"
  $instanceWeb = Invoke-TextRequest -Url $instanceRunning.launch_url
  Assert-Equal $instanceWeb.StatusCode 200 "Dynamic challenge docker entry did not return HTTP 200."
  Assert-True (($instanceWeb.Content | Out-String) -match "nginx") "Dynamic challenge docker entry does not look like the expected nginx page."
} else {
  Assert-True (-not [string]::IsNullOrWhiteSpace($instanceRunning.command)) "Dynamic challenge instance did not return a command."
  Assert-False ($instanceRunning.command.Contains("{{")) "Dynamic challenge command still contains unresolved template placeholders."
  Assert-True ($instanceRunning.launch_url.StartsWith("/mock-instance/")) "Dynamic challenge launch URL does not point to the local mock instance page."
}

Write-Step "Destroying dynamic instance lease"
$destroyedInstance = Invoke-JsonRequest -Method "DELETE" -Url "$BaseUrl/api/games/$($game.id)/challenges/$($dynamicChallenge.id)/instance" -Session $playerSession
Assert-Equal $destroyedInstance.status "idle" "Dynamic challenge instance was not destroyed back to idle state."

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
Write-Host "Dynamic Challenge: $dynamicChallengeTitle"
Write-Host "Dynamic Mode: $DynamicMode"
Write-Host "Player: $playerUsername"
Write-Host "Team: $teamName"
