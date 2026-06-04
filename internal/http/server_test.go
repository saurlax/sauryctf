package http

import (
	"bytes"
	"encoding/json"
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
