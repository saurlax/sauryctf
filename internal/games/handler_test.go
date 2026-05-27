package games_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"

	"github.com/saurlax/sauryctf/internal/games"
)

func setupTestRouter(svc games.ServiceInterface) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(func(c *gin.Context) {
		c.Set("user_id", uint(1))
		c.Next()
	})

	h := games.NewHandler(svc)
	api := r.Group("/api")
	h.RegisterRoutes(api)
	return r
}

func TestCreateGame_Success(t *testing.T) {
	svc := games.NewMockService()
	r := setupTestRouter(svc)

	body := map[string]interface{}{
		"name":       "Spring CTF",
		"description": "A fun CTF",
		"start_time": time.Now().Add(24 * time.Hour).Format(time.RFC3339),
		"end_time":   time.Now().Add(48 * time.Hour).Format(time.RFC3339),
	}
	b, _ := json.Marshal(body)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("POST", "/api/games", bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusCreated, w.Code)

	var game map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &game)
	assert.Equal(t, "Spring CTF", game["name"])
	assert.Equal(t, "draft", game["status"])
}

func TestCreateGame_MissingName(t *testing.T) {
	svc := games.NewMockService()
	r := setupTestRouter(svc)

	body := map[string]string{"description": "test"}
	b, _ := json.Marshal(body)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("POST", "/api/games", bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestGetGame_Success(t *testing.T) {
	svc := games.NewMockService()
	r := setupTestRouter(svc)

	public := true
	svc.CreateGame(games.CreateGameRequest{
		Name:      "Test Game",
		StartTime: time.Now(),
		EndTime:   time.Now().Add(time.Hour),
		IsPublic:  &public,
	}, 1)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/api/games/1", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestGetGame_NotFound(t *testing.T) {
	svc := games.NewMockService()
	r := setupTestRouter(svc)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/api/games/999", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusNotFound, w.Code)
}

func TestListGames_Filtered(t *testing.T) {
	svc := games.NewMockService()
	r := setupTestRouter(svc)

	public := true
	private := false
	svc.CreateGame(games.CreateGameRequest{
		Name: "Public Game", StartTime: time.Now(), EndTime: time.Now().Add(time.Hour), IsPublic: &public,
	}, 1)
	svc.CreateGame(games.CreateGameRequest{
		Name: "Private Game", StartTime: time.Now(), EndTime: time.Now().Add(time.Hour), IsPublic: &private,
	}, 1)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/api/games", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var games_list []map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &games_list)
	assert.Len(t, games_list, 1)
	assert.Equal(t, "Public Game", games_list[0]["name"])
}

func TestUpdateGame_Success(t *testing.T) {
	svc := games.NewMockService()
	r := setupTestRouter(svc)

	public := true
	svc.CreateGame(games.CreateGameRequest{
		Name: "Old Name", StartTime: time.Now(), EndTime: time.Now().Add(time.Hour), IsPublic: &public,
	}, 1)

	newName := "New Name"
	body := games.UpdateGameRequest{Name: &newName}
	b, _ := json.Marshal(body)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("PUT", "/api/games/1", bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var game map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &game)
	assert.Equal(t, "New Name", game["name"])
}

func TestAddChallenge_Success(t *testing.T) {
	svc := games.NewMockService()
	r := setupTestRouter(svc)

	public := true
	svc.CreateGame(games.CreateGameRequest{
		Name: "Game", StartTime: time.Now(), EndTime: time.Now().Add(time.Hour), IsPublic: &public,
	}, 1)

	body := map[string]interface{}{"challenge_id": 1}
	b, _ := json.Marshal(body)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("POST", "/api/games/1/challenges", bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestRemoveChallenge_Success(t *testing.T) {
	svc := games.NewMockService()
	r := setupTestRouter(svc)

	public := true
	svc.CreateGame(games.CreateGameRequest{
		Name: "Game", StartTime: time.Now(), EndTime: time.Now().Add(time.Hour), IsPublic: &public,
	}, 1)
	svc.AddChallenge(1, 1, 0)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("DELETE", "/api/games/1/challenges/1", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}
