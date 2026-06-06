param(
  [string]$FrontendBaseUrl = "http://127.0.0.1:3000"
)

$ErrorActionPreference = "Stop"

function Write-Step {
  param([string]$Message)
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Fail {
  param([string]$Message)
  throw $Message
}

function Assert-Contains {
  param(
    [Parameter(Mandatory = $true)][string]$Content,
    [Parameter(Mandatory = $true)][string]$Expected,
    [Parameter(Mandatory = $true)][string]$Message
  )

  if (-not $Content.Contains($Expected)) {
    Fail "$Message`nExpected to find: $Expected"
  }
}

function Assert-NotContains {
  param(
    [Parameter(Mandatory = $true)][string]$Content,
    [Parameter(Mandatory = $true)][string]$Unexpected,
    [Parameter(Mandatory = $true)][string]$Message
  )

  if ($Content.Contains($Unexpected)) {
    Fail "$Message`nUnexpected content: $Unexpected"
  }
}

function Invoke-HtmlRequest {
  param(
    [Parameter(Mandatory = $true)][string]$Url
  )

  try {
    return Invoke-WebRequest -UseBasicParsing -Method "GET" -Uri $Url
  }
  catch {
    $details = if ($_.ErrorDetails -and $_.ErrorDetails.Message) {
      $_.ErrorDetails.Message
    } elseif ($_.Exception -and $_.Exception.Message) {
      $_.Exception.Message
    } else {
      ($_ | Out-String)
    }
    Fail "HTML request failed: GET $Url`nError: $details"
  }
}

$redirectTarget = "/games/42?tab=challenges"
$encodedRedirect = [System.Uri]::EscapeDataString($redirectTarget)
$loginUrl = "$FrontendBaseUrl/login?redirect=$encodedRedirect"
$registerUrl = "$FrontendBaseUrl/register?redirect=$encodedRedirect"
$unsafeRedirect = "%2F%2Fevil.example"
$unsafeLoginUrl = "$FrontendBaseUrl/login?redirect=$unsafeRedirect"
$unsafeRegisterUrl = "$FrontendBaseUrl/register?redirect=$unsafeRedirect"

Write-Step "Checking login page redirect rendering"
$loginPage = Invoke-HtmlRequest -Url $loginUrl
Assert-Contains $loginPage.Content "/register?redirect=$encodedRedirect" "Login page did not preserve the current redirect when linking to register."

Write-Step "Checking register page redirect rendering"
$registerPage = Invoke-HtmlRequest -Url $registerUrl
Assert-Contains $registerPage.Content "/login?redirect=$encodedRedirect" "Register page did not preserve the current redirect when linking back to login."
Assert-Contains $registerPage.Content "/login?redirect=$encodedRedirect" "Register page did not preserve the current redirect in visible links."

Write-Step "Checking unsafe redirect fallback"
$unsafeLoginPage = Invoke-HtmlRequest -Url $unsafeLoginUrl
Assert-Contains $unsafeLoginPage.Content "/register?redirect=%2Fconsole" "Login page did not fall back to the default safe redirect."
Assert-NotContains $unsafeLoginPage.Content "//evil.example" "Login page should not expose an unsafe double-slash redirect."

$unsafeRegisterPage = Invoke-HtmlRequest -Url $unsafeRegisterUrl
Assert-Contains $unsafeRegisterPage.Content "/login?redirect=%2Fconsole%2Fteam" "Register page did not fall back to the default safe redirect."
Assert-NotContains $unsafeRegisterPage.Content "//evil.example" "Register page should not expose an unsafe double-slash redirect."

Write-Host ""
Write-Host "Auth redirect check passed." -ForegroundColor Green
Write-Host "Frontend: $FrontendBaseUrl"
