package http

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/saurlax/sauryctf/internal/auth"
	"github.com/saurlax/sauryctf/internal/db"
	"github.com/saurlax/sauryctf/internal/games"
	"github.com/saurlax/sauryctf/internal/models"
)

func setupHTTPTestServer(t *testing.T) *httptest.Server {
	t.Helper()

	database, err := db.ConnectTest()
	require.NoError(t, err)
	require.NoError(t, db.Migrate(database))
	db.CleanTables(database)

	authSvc := auth.NewService(database, "test-secret")
	_, _, err = authSvc.EnsureBootstrapAdmin()
	require.NoError(t, err)

	engine := NewServer(database, "test-secret")
	return httptest.NewServer(engine)
}

func loginBootstrapAdmin(t *testing.T, serverURL string) *http.Cookie {
	t.Helper()

	loginBody := bytes.NewBufferString(`{"username":"admin","password":"sauryctf"}`)
	loginReq, err := http.NewRequest(http.MethodPost, serverURL+"/api/auth/login", loginBody)
	require.NoError(t, err)
	loginReq.Header.Set("Content-Type", "application/json")

	loginResp, err := http.DefaultClient.Do(loginReq)
	require.NoError(t, err)
	defer loginResp.Body.Close()

	require.Equal(t, http.StatusOK, loginResp.StatusCode)
	require.NotEmpty(t, loginResp.Cookies())

	for _, cookie := range loginResp.Cookies() {
		if cookie.Name == "token" {
			return cookie
		}
	}

	t.Fatal("missing token cookie")
	return nil
}

func createSmokeGame(t *testing.T, serverURL string, tokenCookie *http.Cookie, payload map[string]any) *games.GameResponse {
	t.Helper()

	body, err := json.Marshal(payload)
	require.NoError(t, err)

	createReq, err := http.NewRequest(http.MethodPost, serverURL+"/api/games", bytes.NewReader(body))
	require.NoError(t, err)
	createReq.Header.Set("Content-Type", "application/json")
	createReq.AddCookie(tokenCookie)

	createResp, err := http.DefaultClient.Do(createReq)
	require.NoError(t, err)
	defer createResp.Body.Close()

	require.Equal(t, http.StatusCreated, createResp.StatusCode)

	var gamePayload games.GameResponse
	require.NoError(t, json.NewDecoder(createResp.Body).Decode(&gamePayload))
	return &gamePayload
}

func createSmokeChallenge(t *testing.T, serverURL string, tokenCookie *http.Cookie, payload map[string]any) *models.Challenge {
	t.Helper()

	body, err := json.Marshal(payload)
	require.NoError(t, err)

	createReq, err := http.NewRequest(http.MethodPost, serverURL+"/api/challenges", bytes.NewReader(body))
	require.NoError(t, err)
	createReq.Header.Set("Content-Type", "application/json")
	createReq.AddCookie(tokenCookie)

	createResp, err := http.DefaultClient.Do(createReq)
	require.NoError(t, err)
	defer createResp.Body.Close()

	require.Equal(t, http.StatusCreated, createResp.StatusCode)

	var challenge models.Challenge
	require.NoError(t, json.NewDecoder(createResp.Body).Decode(&challenge))
	return &challenge
}

func idPath(id uint) string {
	return strconv.FormatUint(uint64(id), 10)
}

func TestServer_BootstrapAdminLoginFlow(t *testing.T) {
	server := setupHTTPTestServer(t)
	defer server.Close()

	tokenCookie := loginBootstrapAdmin(t, server.URL)
	assert.NotEmpty(t, tokenCookie.Value)
	assert.Equal(t, "/", tokenCookie.Path)
	assert.True(t, tokenCookie.HttpOnly)

	meReq, err := http.NewRequest(http.MethodGet, server.URL+"/api/auth/me", nil)
	require.NoError(t, err)
	meReq.AddCookie(tokenCookie)

	meResp, err := http.DefaultClient.Do(meReq)
	require.NoError(t, err)
	defer meResp.Body.Close()

	require.Equal(t, http.StatusOK, meResp.StatusCode)

	var mePayload struct {
		User models.User `json:"user"`
	}
	require.NoError(t, json.NewDecoder(meResp.Body).Decode(&mePayload))
	assert.Equal(t, "admin", mePayload.User.Username)
	assert.Equal(t, models.RoleAdmin, mePayload.User.Role)
	assert.Equal(t, models.StatusActive, mePayload.User.Status)

	logoutReq, err := http.NewRequest(http.MethodPost, server.URL+"/api/auth/logout", nil)
	require.NoError(t, err)
	logoutReq.AddCookie(tokenCookie)

	logoutResp, err := http.DefaultClient.Do(logoutReq)
	require.NoError(t, err)
	defer logoutResp.Body.Close()

	require.Equal(t, http.StatusOK, logoutResp.StatusCode)

	meAfterLogoutReq, err := http.NewRequest(http.MethodGet, server.URL+"/api/auth/me", nil)
	require.NoError(t, err)
	meAfterLogoutReq.AddCookie(tokenCookie)

	meAfterLogoutResp, err := http.DefaultClient.Do(meAfterLogoutReq)
	require.NoError(t, err)
	defer meAfterLogoutResp.Body.Close()

	assert.Equal(t, http.StatusUnauthorized, meAfterLogoutResp.StatusCode)
}

func TestServer_BootstrapAdminCanCreateGame(t *testing.T) {
	server := setupHTTPTestServer(t)
	defer server.Close()

	tokenCookie := loginBootstrapAdmin(t, server.URL)

	start := time.Now().Add(time.Hour).UTC().Truncate(time.Second)
	end := start.Add(24 * time.Hour)
	gamePayload := createSmokeGame(t, server.URL, tokenCookie, map[string]any{
		"name":       "Bootstrap Smoke Game",
		"start_time": start.Format(time.RFC3339),
		"end_time":   end.Format(time.RFC3339),
		"is_public":  true,
	})

	assert.NotZero(t, gamePayload.ID)
	assert.Equal(t, "Bootstrap Smoke Game", gamePayload.Name)
	assert.Equal(t, uint(1), gamePayload.CreatedBy)
	assert.Equal(t, "draft", gamePayload.Status)
}

func TestServer_AdminContestSetupSmokePath(t *testing.T) {
	server := setupHTTPTestServer(t)
	defer server.Close()

	tokenCookie := loginBootstrapAdmin(t, server.URL)

	start := time.Now().Add(2 * time.Hour).UTC().Truncate(time.Second)
	end := start.Add(6 * time.Hour)
	game := createSmokeGame(t, server.URL, tokenCookie, map[string]any{
		"name":        "Public Smoke Game",
		"description": "smoke path",
		"start_time":  start.Format(time.RFC3339),
		"end_time":    end.Format(time.RFC3339),
		"is_public":   true,
	})
	require.Equal(t, "draft", game.Status)

	publicListBeforeResp, err := http.Get(server.URL + "/api/games")
	require.NoError(t, err)
	defer publicListBeforeResp.Body.Close()
	require.Equal(t, http.StatusOK, publicListBeforeResp.StatusCode)

	var publicListBefore []games.GameResponse
	require.NoError(t, json.NewDecoder(publicListBeforeResp.Body).Decode(&publicListBefore))
	assert.Empty(t, publicListBefore)

	publicDetailBeforeResp, err := http.Get(server.URL + "/api/games/" + idPath(game.ID))
	require.NoError(t, err)
	defer publicDetailBeforeResp.Body.Close()
	assert.Equal(t, http.StatusNotFound, publicDetailBeforeResp.StatusCode)

	challenge := createSmokeChallenge(t, server.URL, tokenCookie, map[string]any{
		"title":       "Smoke Challenge",
		"description": "Find the flag",
		"category":    "misc",
		"type":        "static",
		"flag":        "flag{sauryctf-smoke}",
		"base_score":  500,
		"is_visible":  true,
	})

	attachBody, err := json.Marshal(map[string]any{
		"challenge_id": challenge.ID,
	})
	require.NoError(t, err)

	attachReq, err := http.NewRequest(http.MethodPost, server.URL+"/api/games/"+idPath(game.ID)+"/challenges", bytes.NewReader(attachBody))
	require.NoError(t, err)
	attachReq.Header.Set("Content-Type", "application/json")
	attachReq.AddCookie(tokenCookie)

	attachResp, err := http.DefaultClient.Do(attachReq)
	require.NoError(t, err)
	defer attachResp.Body.Close()
	require.Equal(t, http.StatusOK, attachResp.StatusCode)

	updateBody, err := json.Marshal(map[string]any{
		"status": "active",
	})
	require.NoError(t, err)

	updateReq, err := http.NewRequest(http.MethodPut, server.URL+"/api/games/"+idPath(game.ID), bytes.NewReader(updateBody))
	require.NoError(t, err)
	updateReq.Header.Set("Content-Type", "application/json")
	updateReq.AddCookie(tokenCookie)

	updateResp, err := http.DefaultClient.Do(updateReq)
	require.NoError(t, err)
	defer updateResp.Body.Close()
	require.Equal(t, http.StatusOK, updateResp.StatusCode)

	var updatedGame games.GameResponse
	require.NoError(t, json.NewDecoder(updateResp.Body).Decode(&updatedGame))
	assert.Equal(t, "active", updatedGame.Status)
	assert.True(t, updatedGame.IsPublic)

	publicListAfterResp, err := http.Get(server.URL + "/api/games")
	require.NoError(t, err)
	defer publicListAfterResp.Body.Close()
	require.Equal(t, http.StatusOK, publicListAfterResp.StatusCode)

	var publicListAfter []games.GameResponse
	require.NoError(t, json.NewDecoder(publicListAfterResp.Body).Decode(&publicListAfter))
	require.Len(t, publicListAfter, 1)
	assert.Equal(t, game.ID, publicListAfter[0].ID)
	assert.Equal(t, "active", publicListAfter[0].Status)

	publicDetailAfterResp, err := http.Get(server.URL + "/api/games/" + idPath(game.ID))
	require.NoError(t, err)
	defer publicDetailAfterResp.Body.Close()
	require.Equal(t, http.StatusOK, publicDetailAfterResp.StatusCode)

	var publicGame games.GameResponse
	require.NoError(t, json.NewDecoder(publicDetailAfterResp.Body).Decode(&publicGame))
	assert.Equal(t, game.ID, publicGame.ID)
	assert.True(t, publicGame.IsPublic)
	assert.Equal(t, "active", publicGame.Status)

	publicChallengesReq, err := http.NewRequest(http.MethodGet, server.URL+"/api/games/"+idPath(game.ID)+"/challenges", nil)
	require.NoError(t, err)
	publicChallengesReq.AddCookie(tokenCookie)

	publicChallengesResp, err := http.DefaultClient.Do(publicChallengesReq)
	require.NoError(t, err)
	defer publicChallengesResp.Body.Close()
	require.Equal(t, http.StatusOK, publicChallengesResp.StatusCode)

	var publicChallenges []games.GameChallengeDetail
	require.NoError(t, json.NewDecoder(publicChallengesResp.Body).Decode(&publicChallenges))
	require.Len(t, publicChallenges, 1)
	assert.Equal(t, challenge.ID, publicChallenges[0].ID)
	assert.Equal(t, "Smoke Challenge", publicChallenges[0].Title)
	assert.Equal(t, "misc", publicChallenges[0].Category)
	assert.Equal(t, 500, publicChallenges[0].Score)
	assert.Equal(t, "Find the flag", publicChallenges[0].Description)
}

func TestServer_PublicVisitorCanBrowsePublicGameMetadata(t *testing.T) {
	server := setupHTTPTestServer(t)
	defer server.Close()

	tokenCookie := loginBootstrapAdmin(t, server.URL)

	start := time.Now().Add(-2 * time.Hour).UTC().Truncate(time.Second)
	end := time.Now().Add(4 * time.Hour).UTC().Truncate(time.Second)
	game := createSmokeGame(t, server.URL, tokenCookie, map[string]any{
		"name":        "Visitor Public Game",
		"description": "public visitor flow",
		"start_time":  start.Format(time.RFC3339),
		"end_time":    end.Format(time.RFC3339),
		"is_public":   true,
	})

	challenge := createSmokeChallenge(t, server.URL, tokenCookie, map[string]any{
		"title":       "Visitor Challenge",
		"description": "Visible only after join",
		"category":    "web",
		"type":        "static",
		"flag":        "flag{visitor-flow}",
		"base_score":  300,
		"hints":       `["hint one"]`,
		"attachments": `["/attachments/example.txt"]`,
		"container_spec": `{"connection":{"url":"http://127.0.0.1:8081","note":"private instance"}}`,
		"is_visible":  true,
	})

	attachBody, err := json.Marshal(map[string]any{
		"challenge_id": challenge.ID,
	})
	require.NoError(t, err)

	attachReq, err := http.NewRequest(http.MethodPost, server.URL+"/api/games/"+idPath(game.ID)+"/challenges", bytes.NewReader(attachBody))
	require.NoError(t, err)
	attachReq.Header.Set("Content-Type", "application/json")
	attachReq.AddCookie(tokenCookie)

	attachResp, err := http.DefaultClient.Do(attachReq)
	require.NoError(t, err)
	defer attachResp.Body.Close()
	require.Equal(t, http.StatusOK, attachResp.StatusCode)

	updateBody, err := json.Marshal(map[string]any{
		"status": "active",
	})
	require.NoError(t, err)

	updateReq, err := http.NewRequest(http.MethodPut, server.URL+"/api/games/"+idPath(game.ID), bytes.NewReader(updateBody))
	require.NoError(t, err)
	updateReq.Header.Set("Content-Type", "application/json")
	updateReq.AddCookie(tokenCookie)

	updateResp, err := http.DefaultClient.Do(updateReq)
	require.NoError(t, err)
	defer updateResp.Body.Close()
	require.Equal(t, http.StatusOK, updateResp.StatusCode)

	publicDetailResp, err := http.Get(server.URL + "/api/games/" + idPath(game.ID))
	require.NoError(t, err)
	defer publicDetailResp.Body.Close()
	require.Equal(t, http.StatusOK, publicDetailResp.StatusCode)

	var publicGame games.GameResponse
	require.NoError(t, json.NewDecoder(publicDetailResp.Body).Decode(&publicGame))
	assert.Equal(t, "Visitor Public Game", publicGame.Name)
	assert.Equal(t, "active", publicGame.Status)
	assert.True(t, publicGame.IsPublic)

	publicChallengesResp, err := http.Get(server.URL + "/api/games/" + idPath(game.ID) + "/challenges")
	require.NoError(t, err)
	defer publicChallengesResp.Body.Close()
	require.Equal(t, http.StatusOK, publicChallengesResp.StatusCode)

	var publicChallenges []games.GameChallengeDetail
	require.NoError(t, json.NewDecoder(publicChallengesResp.Body).Decode(&publicChallenges))
	require.Len(t, publicChallenges, 1)
	assert.Equal(t, "Visitor Challenge", publicChallenges[0].Title)
	assert.Equal(t, "web", publicChallenges[0].Category)
	assert.Equal(t, 300, publicChallenges[0].Score)
	assert.Empty(t, publicChallenges[0].Description)
	assert.Empty(t, publicChallenges[0].Hints)
	assert.Empty(t, publicChallenges[0].ContainerSpec)
	assert.Empty(t, publicChallenges[0].Attachments)
}

func TestServer_AdminDashboardSummary(t *testing.T) {
	server := setupHTTPTestServer(t)
	defer server.Close()

	tokenCookie := loginBootstrapAdmin(t, server.URL)

	start := time.Now().Add(2 * time.Hour).UTC().Truncate(time.Second)
	end := start.Add(2 * time.Hour)
	game := createSmokeGame(t, server.URL, tokenCookie, map[string]any{
		"name":        "Dashboard Summary Game",
		"description": "summary fixture",
		"start_time":  start.Format(time.RFC3339),
		"end_time":    end.Format(time.RFC3339),
		"is_public":   true,
	})

	announcementBody := bytes.NewBufferString(`{"content":"summary announcement"}`)
	announcementReq, err := http.NewRequest(http.MethodPost, server.URL+"/api/admin/games/"+idPath(game.ID)+"/announcements", announcementBody)
	require.NoError(t, err)
	announcementReq.Header.Set("Content-Type", "application/json")
	announcementReq.AddCookie(tokenCookie)

	announcementResp, err := http.DefaultClient.Do(announcementReq)
	require.NoError(t, err)
	defer announcementResp.Body.Close()
	require.Equal(t, http.StatusCreated, announcementResp.StatusCode)

	summaryReq, err := http.NewRequest(http.MethodGet, server.URL+"/api/admin/dashboard/summary", nil)
	require.NoError(t, err)
	summaryReq.AddCookie(tokenCookie)

	summaryResp, err := http.DefaultClient.Do(summaryReq)
	require.NoError(t, err)
	defer summaryResp.Body.Close()
	require.Equal(t, http.StatusOK, summaryResp.StatusCode)

	var payload struct {
		Games               []games.AdminDashboardGameSummary       `json:"games"`
		LatestAnnouncements []games.AdminDashboardAnnouncementEntry `json:"latest_announcements"`
	}
	require.NoError(t, json.NewDecoder(summaryResp.Body).Decode(&payload))
	require.NotEmpty(t, payload.Games)
	assert.Equal(t, "Dashboard Summary Game", payload.Games[0].Name)
	require.NotEmpty(t, payload.LatestAnnouncements)
	assert.Equal(t, "summary announcement", payload.LatestAnnouncements[0].Content)
}

func TestServer_NormalUserCannotCreateGame(t *testing.T) {
	server := setupHTTPTestServer(t)
	defer server.Close()

	registerBody := bytes.NewBufferString(`{"username":"alice","email":"alice@example.com","password":"password123"}`)
	registerReq, err := http.NewRequest(http.MethodPost, server.URL+"/api/auth/register", registerBody)
	require.NoError(t, err)
	registerReq.Header.Set("Content-Type", "application/json")

	registerResp, err := http.DefaultClient.Do(registerReq)
	require.NoError(t, err)
	defer registerResp.Body.Close()
	require.Equal(t, http.StatusCreated, registerResp.StatusCode)

	var tokenCookie *http.Cookie
	for _, cookie := range registerResp.Cookies() {
		if cookie.Name == "token" {
			tokenCookie = cookie
			break
		}
	}
	require.NotNil(t, tokenCookie)

	start := time.Now().Add(time.Hour).UTC().Truncate(time.Second)
	end := start.Add(2 * time.Hour)
	payload := map[string]any{
		"name":       "Forbidden Game",
		"start_time": start.Format(time.RFC3339),
		"end_time":   end.Format(time.RFC3339),
	}
	body, err := json.Marshal(payload)
	require.NoError(t, err)

	createReq, err := http.NewRequest(http.MethodPost, server.URL+"/api/games", bytes.NewReader(body))
	require.NoError(t, err)
	createReq.Header.Set("Content-Type", "application/json")
	createReq.AddCookie(tokenCookie)

	createResp, err := http.DefaultClient.Do(createReq)
	require.NoError(t, err)
	defer createResp.Body.Close()

	assert.Equal(t, http.StatusForbidden, createResp.StatusCode)
}

func TestServer_DoesNotBootstrapAdminWhenUsersExist(t *testing.T) {
	database, err := db.ConnectTest()
	require.NoError(t, err)
	require.NoError(t, db.Migrate(database))
	db.CleanTables(database)

	authSvc := auth.NewService(database, "test-secret")
	_, err = authSvc.Register("alice", "alice@example.com", "password123")
	require.NoError(t, err)

	user, created, err := authSvc.EnsureBootstrapAdmin()
	require.NoError(t, err)
	assert.False(t, created)
	assert.Nil(t, user)

	var count int64
	require.NoError(t, database.Model(&models.User{}).Count(&count).Error)
	assert.EqualValues(t, 1, count)
}

func TestServer_AdminCanExportImportAndDeleteGamePackage(t *testing.T) {
	server := setupHTTPTestServer(t)
	defer server.Close()

	tokenCookie := loginBootstrapAdmin(t, server.URL)

	start := time.Now().Add(30 * time.Minute).UTC().Truncate(time.Second)
	end := start.Add(2 * time.Hour)
	writeupDeadline := end.Add(24 * time.Hour)
	game := createSmokeGame(t, server.URL, tokenCookie, map[string]any{
		"name":               "Portable Smoke Game",
		"description":        "export import delete smoke",
		"notice":             "ship it",
		"start_time":         start.Format(time.RFC3339),
		"end_time":           end.Format(time.RFC3339),
		"registration_mode":  "auto_accept",
		"max_team_members":   4,
		"practice_mode":      true,
		"writeup_required":   true,
		"writeup_deadline":   writeupDeadline.Format(time.RFC3339),
		"divisions":          []string{"student", "open"},
		"is_public":          false,
	})

	challenge := createSmokeChallenge(t, server.URL, tokenCookie, map[string]any{
		"title":        "Portable Challenge",
		"description":  "archive me",
		"category":     "misc",
		"type":         "static",
		"difficulty":   "easy",
		"flag":         "flag{portable-smoke}",
		"base_score":   400,
		"min_score":    50,
		"decay_rate":   0.2,
		"hints":        "[\"take the zip\"]",
		"attachments":  "[\"https://example.com/portable.zip\"]",
		"is_visible":   true,
	})

	attachBody, err := json.Marshal(map[string]any{
		"challenge_id":   challenge.ID,
		"score_override": 275,
	})
	require.NoError(t, err)

	attachReq, err := http.NewRequest(http.MethodPost, server.URL+"/api/games/"+idPath(game.ID)+"/challenges", bytes.NewReader(attachBody))
	require.NoError(t, err)
	attachReq.Header.Set("Content-Type", "application/json")
	attachReq.AddCookie(tokenCookie)

	attachResp, err := http.DefaultClient.Do(attachReq)
	require.NoError(t, err)
	defer attachResp.Body.Close()
	require.Equal(t, http.StatusOK, attachResp.StatusCode)

	exportReq, err := http.NewRequest(http.MethodPost, server.URL+"/api/admin/games/"+idPath(game.ID)+"/export", nil)
	require.NoError(t, err)
	exportReq.AddCookie(tokenCookie)

	exportResp, err := http.DefaultClient.Do(exportReq)
	require.NoError(t, err)
	defer exportResp.Body.Close()
	require.Equal(t, http.StatusOK, exportResp.StatusCode)
	require.Equal(t, "application/zip", exportResp.Header.Get("Content-Type"))
	assert.Contains(t, exportResp.Header.Get("Content-Disposition"), "attachment; filename=")

	exportedBytes, err := io.ReadAll(exportResp.Body)
	require.NoError(t, err)
	require.NotEmpty(t, exportedBytes)

	zipReader, err := zip.NewReader(bytes.NewReader(exportedBytes), int64(len(exportedBytes)))
	require.NoError(t, err)
	require.NotEmpty(t, zipReader.File)

	var gameJSONFile *zip.File
	for _, file := range zipReader.File {
		if file.Name == "game.json" {
			gameJSONFile = file
			break
		}
	}
	require.NotNil(t, gameJSONFile)

	gameJSONReader, err := gameJSONFile.Open()
	require.NoError(t, err)
	defer gameJSONReader.Close()

	var exportedPayload struct {
		Version    string `json:"version"`
		Game       struct {
			Name             string    `json:"name"`
			RegistrationMode string    `json:"registration_mode"`
			MaxTeamMembers   int       `json:"max_team_members"`
			PracticeMode     bool      `json:"practice_mode"`
			WriteupRequired  bool      `json:"writeup_required"`
			WriteupDeadline  time.Time `json:"writeup_deadline"`
			IsPublic         bool      `json:"is_public"`
			Divisions        []string  `json:"divisions"`
		} `json:"game"`
		Challenges []struct {
			Title         string `json:"title"`
			Attachments   string `json:"attachments"`
			ScoreOverride int    `json:"score_override"`
		} `json:"challenges"`
	}
	require.NoError(t, json.NewDecoder(gameJSONReader).Decode(&exportedPayload))
	assert.Equal(t, "sauryctf.export.v2", exportedPayload.Version)
	assert.Equal(t, "Portable Smoke Game", exportedPayload.Game.Name)
	assert.Equal(t, "auto_accept", exportedPayload.Game.RegistrationMode)
	assert.Equal(t, 4, exportedPayload.Game.MaxTeamMembers)
	assert.True(t, exportedPayload.Game.PracticeMode)
	assert.True(t, exportedPayload.Game.WriteupRequired)
	assert.False(t, exportedPayload.Game.IsPublic)
	assert.Equal(t, []string{"student", "open"}, exportedPayload.Game.Divisions)
	require.Len(t, exportedPayload.Challenges, 1)
	assert.Equal(t, "Portable Challenge", exportedPayload.Challenges[0].Title)
	assert.Equal(t, 275, exportedPayload.Challenges[0].ScoreOverride)

	var importBody bytes.Buffer
	importWriter := multipart.NewWriter(&importBody)
	importFileWriter, err := importWriter.CreateFormFile("file", "portable-smoke.zip")
	require.NoError(t, err)
	_, err = importFileWriter.Write(exportedBytes)
	require.NoError(t, err)
	require.NoError(t, importWriter.Close())

	importReq, err := http.NewRequest(http.MethodPost, server.URL+"/api/admin/games/import", &importBody)
	require.NoError(t, err)
	importReq.Header.Set("Content-Type", importWriter.FormDataContentType())
	importReq.AddCookie(tokenCookie)

	importResp, err := http.DefaultClient.Do(importReq)
	require.NoError(t, err)
	defer importResp.Body.Close()
	require.Equal(t, http.StatusCreated, importResp.StatusCode)

	var importedGame games.GameResponse
	require.NoError(t, json.NewDecoder(importResp.Body).Decode(&importedGame))
	assert.NotEqual(t, game.ID, importedGame.ID)
	assert.Equal(t, "Portable Smoke Game", importedGame.Name)
	assert.Equal(t, "draft", importedGame.Status)
	assert.Equal(t, "auto_accept", importedGame.RegistrationMode)
	assert.Equal(t, 4, importedGame.MaxTeamMembers)
	assert.True(t, importedGame.PracticeMode)
	assert.True(t, importedGame.WriteupRequired)
	require.NotNil(t, importedGame.WriteupDeadline)
	assert.False(t, importedGame.IsPublic)
	assert.Equal(t, []string{"student", "open"}, importedGame.Divisions)

	importedChallengesReq, err := http.NewRequest(http.MethodGet, server.URL+"/api/admin/games/"+idPath(importedGame.ID)+"/challenges", nil)
	require.NoError(t, err)
	importedChallengesReq.AddCookie(tokenCookie)

	importedChallengesResp, err := http.DefaultClient.Do(importedChallengesReq)
	require.NoError(t, err)
	defer importedChallengesResp.Body.Close()
	require.Equal(t, http.StatusOK, importedChallengesResp.StatusCode)

	var importedChallenges []games.GameChallengeDetail
	require.NoError(t, json.NewDecoder(importedChallengesResp.Body).Decode(&importedChallenges))
	require.Len(t, importedChallenges, 1)
	assert.Equal(t, "Portable Challenge", importedChallenges[0].Title)
	assert.Equal(t, 275, importedChallenges[0].Score)

	deleteReq, err := http.NewRequest(http.MethodDelete, server.URL+"/api/admin/games/"+idPath(game.ID), nil)
	require.NoError(t, err)
	deleteReq.AddCookie(tokenCookie)

	deleteResp, err := http.DefaultClient.Do(deleteReq)
	require.NoError(t, err)
	defer deleteResp.Body.Close()
	require.Equal(t, http.StatusOK, deleteResp.StatusCode)

	deletedGameReq, err := http.NewRequest(http.MethodGet, server.URL+"/api/games/"+idPath(game.ID)+"?all=true", nil)
	require.NoError(t, err)
	deletedGameReq.AddCookie(tokenCookie)
	deletedGameResp, err := http.DefaultClient.Do(deletedGameReq)
	require.NoError(t, err)
	defer deletedGameResp.Body.Close()
	require.Equal(t, http.StatusNotFound, deletedGameResp.StatusCode)
}
