package http

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/saurlax/sauryctf/internal/auth"
	"github.com/saurlax/sauryctf/internal/db"
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

func TestServer_BootstrapAdminLoginFlow(t *testing.T) {
	server := setupHTTPTestServer(t)
	defer server.Close()

	loginBody := bytes.NewBufferString(`{"username":"admin","password":"sauryctf"}`)
	loginReq, err := http.NewRequest(http.MethodPost, server.URL+"/api/auth/login", loginBody)
	require.NoError(t, err)
	loginReq.Header.Set("Content-Type", "application/json")

	loginResp, err := http.DefaultClient.Do(loginReq)
	require.NoError(t, err)
	defer loginResp.Body.Close()

	require.Equal(t, http.StatusOK, loginResp.StatusCode)
	require.NotEmpty(t, loginResp.Cookies())

	var tokenCookie *http.Cookie
	for _, cookie := range loginResp.Cookies() {
		if cookie.Name == "token" {
			tokenCookie = cookie
			break
		}
	}
	require.NotNil(t, tokenCookie)
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

	loginBody := bytes.NewBufferString(`{"username":"admin","password":"sauryctf"}`)
	loginReq, err := http.NewRequest(http.MethodPost, server.URL+"/api/auth/login", loginBody)
	require.NoError(t, err)
	loginReq.Header.Set("Content-Type", "application/json")

	loginResp, err := http.DefaultClient.Do(loginReq)
	require.NoError(t, err)
	defer loginResp.Body.Close()
	require.Equal(t, http.StatusOK, loginResp.StatusCode)
	require.NotEmpty(t, loginResp.Cookies())

	var tokenCookie *http.Cookie
	for _, cookie := range loginResp.Cookies() {
		if cookie.Name == "token" {
			tokenCookie = cookie
			break
		}
	}
	require.NotNil(t, tokenCookie)

	start := time.Now().Add(time.Hour).UTC().Truncate(time.Second)
	end := start.Add(24 * time.Hour)
	payload := map[string]any{
		"name":       "Bootstrap Smoke Game",
		"start_time": start.Format(time.RFC3339),
		"end_time":   end.Format(time.RFC3339),
		"is_public":  true,
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

	require.Equal(t, http.StatusCreated, createResp.StatusCode)

	var gamePayload struct {
		ID        uint   `json:"id"`
		Name      string `json:"name"`
		CreatedBy uint   `json:"created_by"`
		Status    string `json:"status"`
	}
	require.NoError(t, json.NewDecoder(createResp.Body).Decode(&gamePayload))
	assert.NotZero(t, gamePayload.ID)
	assert.Equal(t, "Bootstrap Smoke Game", gamePayload.Name)
	assert.Equal(t, uint(1), gamePayload.CreatedBy)
	assert.Equal(t, "draft", gamePayload.Status)
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
