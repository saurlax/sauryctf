package games_test

import (
	"bytes"
	"encoding/json"
	"fmt"
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
	// 直接注册路由（对齐 oapi-codegen 生成的路由结构）
	api.GET("/games", func(c *gin.Context) {
		showAll := c.Query("all") == "true"
		h.ListGames(c, showAll)
	})
	api.POST("/games", h.CreateGame)
	api.GET("/games/:id", func(c *gin.Context) {
		var id int
		fmt.Sscan(c.Param("id"), &id)
		h.GetGame(c, id)
	})
	api.PUT("/games/:id", func(c *gin.Context) {
		var id int
		fmt.Sscan(c.Param("id"), &id)
		h.UpdateGame(c, id)
	})
	api.GET("/games/:id/challenges", func(c *gin.Context) {
		var id int
		fmt.Sscan(c.Param("id"), &id)
		h.GetGameChallenges(c, id)
	})
	api.POST("/games/:id/challenges", func(c *gin.Context) {
		var id int
		fmt.Sscan(c.Param("id"), &id)
		h.AddChallengeToGame(c, id)
	})
	api.DELETE("/games/:id/challenges/:challengeId", func(c *gin.Context) {
		var id, challengeId int
		fmt.Sscan(c.Param("id"), &id)
		fmt.Sscan(c.Param("challengeId"), &challengeId)
		h.RemoveChallengeFromGame(c, id, challengeId)
	})
	api.POST("/games/:id/challenges/:challengeId/submit", func(c *gin.Context) {
		var id, challengeId int
		fmt.Sscan(c.Param("id"), &id)
		fmt.Sscan(c.Param("challengeId"), &challengeId)
		h.SubmitGameFlag(c, id, challengeId)
	})
	api.POST("/games/:id/join", func(c *gin.Context) {
		var id int
		fmt.Sscan(c.Param("id"), &id)
		h.JoinGame(c, id)
	})
	api.GET("/games/:id/participation", func(c *gin.Context) {
		var id int
		fmt.Sscan(c.Param("id"), &id)
		h.GetGameParticipation(c, id)
	})
	api.DELETE("/games/:id/leave", func(c *gin.Context) {
		var id int
		fmt.Sscan(c.Param("id"), &id)
		h.LeaveGame(c, id)
	})
	api.GET("/games/:id/scoreboard", func(c *gin.Context) {
		var id int
		fmt.Sscan(c.Param("id"), &id)
		h.GetScoreboard(c, id)
	})
	api.GET("/games/:id/participants", func(c *gin.Context) {
		var id int
		fmt.Sscan(c.Param("id"), &id)
		h.GetParticipants(c, id)
	})
	api.PUT("/games/:id/participants/:teamId", func(c *gin.Context) {
		var id, teamId int
		fmt.Sscan(c.Param("id"), &id)
		fmt.Sscan(c.Param("teamId"), &teamId)
		h.UpdateParticipantStatus(c, id, teamId)
	})
	api.DELETE("/games/:id/participants/:teamId", func(c *gin.Context) {
		var id, teamId int
		fmt.Sscan(c.Param("id"), &id)
		fmt.Sscan(c.Param("teamId"), &teamId)
		h.RemoveParticipant(c, id, teamId)
	})
	return r
}

func TestCreateGame_Success(t *testing.T) {
	svc := games.NewMockService()
	r := setupTestRouter(svc)

	body := map[string]interface{}{
		"name":        "Spring CTF",
		"description": "A fun CTF",
		"start_time":  time.Now().Add(24 * time.Hour).Format(time.RFC3339),
		"end_time":    time.Now().Add(48 * time.Hour).Format(time.RFC3339),
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

func TestGetGameParticipation_WithTeamAndJoined(t *testing.T) {
	svc := games.NewMockService()
	svc.UserTeams[1] = &games.GameParticipationTeam{ID: 7, Name: "Blue Team"}
	svc.Participations["1-7"] = "accepted"

	r := setupTestRouter(svc)

	public := true
	svc.CreateGame(games.CreateGameRequest{
		Name: "Game", StartTime: time.Now(), EndTime: time.Now().Add(time.Hour), IsPublic: &public,
	}, 1)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/api/games/1/participation", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var response map[string]any
	json.Unmarshal(w.Body.Bytes(), &response)
	assert.Equal(t, true, response["has_team"])
	assert.Equal(t, true, response["participated"])
}

func TestGetParticipants_Success(t *testing.T) {
	svc := games.NewMockService()
	svc.UserTeams[1] = &games.GameParticipationTeam{ID: 7, Name: "Blue Team"}
	svc.Participations["1-7"] = "accepted"

	r := setupTestRouter(svc)

	public := true
	svc.CreateGame(games.CreateGameRequest{
		Name: "Game", StartTime: time.Now(), EndTime: time.Now().Add(time.Hour), IsPublic: &public,
	}, 1)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/api/games/1/participants", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var response []map[string]any
	json.Unmarshal(w.Body.Bytes(), &response)
	assert.Len(t, response, 1)
	assert.Equal(t, "Blue Team", response[0]["team_name"])
}

func TestUpdateParticipantStatus_Success(t *testing.T) {
	svc := games.NewMockService()
	svc.UserTeams[1] = &games.GameParticipationTeam{ID: 7, Name: "Blue Team"}
	svc.Participations["1-7"] = "pending"

	r := setupTestRouter(svc)

	public := true
	svc.CreateGame(games.CreateGameRequest{
		Name: "Game", StartTime: time.Now(), EndTime: time.Now().Add(time.Hour), IsPublic: &public,
	}, 1)

	body := map[string]string{"status": "accepted"}
	b, _ := json.Marshal(body)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("PUT", "/api/games/1/participants/7", bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var response map[string]any
	json.Unmarshal(w.Body.Bytes(), &response)
	assert.Equal(t, "accepted", response["status"])
}

func TestRemoveParticipant_Success(t *testing.T) {
	svc := games.NewMockService()
	svc.UserTeams[1] = &games.GameParticipationTeam{ID: 7, Name: "Blue Team"}
	svc.Participations["1-7"] = "pending"

	r := setupTestRouter(svc)

	public := true
	svc.CreateGame(games.CreateGameRequest{
		Name: "Game", StartTime: time.Now(), EndTime: time.Now().Add(time.Hour), IsPublic: &public,
	}, 1)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("DELETE", "/api/games/1/participants/7", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}
