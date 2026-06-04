package games_test

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
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
	api.DELETE("/admin/games/:id", func(c *gin.Context) {
		var id int
		fmt.Sscan(c.Param("id"), &id)
		h.DeleteGame(c, id)
	})
	api.POST("/admin/games/import", h.ImportGamePackage)
	api.POST("/admin/games/:id/export", func(c *gin.Context) {
		var id int
		fmt.Sscan(c.Param("id"), &id)
		h.ExportGamePackage(c, id)
	})
	api.GET("/games/:id/challenges", func(c *gin.Context) {
		var id int
		fmt.Sscan(c.Param("id"), &id)
		h.GetGameChallenges(c, id)
	})
	api.GET("/admin/games/:id/challenges", func(c *gin.Context) {
		var id int
		fmt.Sscan(c.Param("id"), &id)
		h.GetAdminGameChallenges(c, id)
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
		"name":              "Spring CTF",
		"description":       "A fun CTF",
		"start_time":        time.Now().Add(24 * time.Hour).Format(time.RFC3339),
		"end_time":          time.Now().Add(48 * time.Hour).Format(time.RFC3339),
		"registration_mode": "auto_accept",
		"max_team_members":  4,
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
	assert.Equal(t, "auto_accept", game["registration_mode"])
	assert.Equal(t, float64(4), game["max_team_members"])
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

func TestCreateGame_InvalidTimeline(t *testing.T) {
	svc := games.NewMockService()
	r := setupTestRouter(svc)

	body := map[string]any{
		"name":       "Broken Timeline",
		"start_time": time.Now().Add(2 * time.Hour).Format(time.RFC3339),
		"end_time":   time.Now().Add(time.Hour).Format(time.RFC3339),
	}
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
	created, _ := svc.CreateGame(games.CreateGameRequest{
		Name:      "Test Game",
		StartTime: time.Now(),
		EndTime:   time.Now().Add(time.Hour),
		IsPublic:  &public,
	}, 1)
	active := "active"
	_, _ = svc.UpdateGame(created.ID, games.UpdateGameRequest{Status: &active})

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/api/games/1", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestGetGame_HidesDraftGameFromPublic(t *testing.T) {
	svc := games.NewMockService()
	r := setupTestRouter(svc)

	public := true
	created, _ := svc.CreateGame(games.CreateGameRequest{
		Name:      "Draft Game",
		StartTime: time.Now(),
		EndTime:   time.Now().Add(time.Hour),
		IsPublic:  &public,
	}, 1)
	draft := "draft"
	_, _ = svc.UpdateGame(created.ID, games.UpdateGameRequest{Status: &draft})

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/api/games/1", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusNotFound, w.Code)
}

func TestGetGame_AllowsAdminStyleLookupWithAllQuery(t *testing.T) {
	svc := games.NewMockService()
	r := setupTestRouter(svc)

	public := false
	created, _ := svc.CreateGame(games.CreateGameRequest{
		Name:      "Private Draft Game",
		StartTime: time.Now(),
		EndTime:   time.Now().Add(time.Hour),
		IsPublic:  &public,
	}, 1)
	draft := "draft"
	_, _ = svc.UpdateGame(created.ID, games.UpdateGameRequest{Status: &draft})

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/api/games/1?all=true", nil)
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
	created, _ := svc.CreateGame(games.CreateGameRequest{
		Name: "Draft Public Game", StartTime: time.Now(), EndTime: time.Now().Add(time.Hour), IsPublic: &public,
	}, 1)
	draft := "draft"
	_, _ = svc.UpdateGame(created.ID, games.UpdateGameRequest{Status: &draft})
	active := "active"
	_, _ = svc.UpdateGame(1, games.UpdateGameRequest{Status: &active})
	_, _ = svc.UpdateGame(2, games.UpdateGameRequest{Status: &active})

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
	newMode := games.RegistrationModeAutoAccept
	newLimit := 2
	body := games.UpdateGameRequest{Name: &newName, RegistrationMode: &newMode, MaxTeamMembers: &newLimit}
	b, _ := json.Marshal(body)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("PUT", "/api/games/1", bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var game map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &game)
	assert.Equal(t, "New Name", game["name"])
	assert.Equal(t, "auto_accept", game["registration_mode"])
	assert.Equal(t, float64(2), game["max_team_members"])
}

func TestUpdateGame_ClearScoreboardFreeze_Success(t *testing.T) {
	svc := games.NewMockService()
	r := setupTestRouter(svc)

	public := true
	freezeAt := time.Now().Add(time.Hour)
	svc.CreateGame(games.CreateGameRequest{
		Name:               "Game",
		StartTime:          time.Now(),
		EndTime:            time.Now().Add(time.Hour),
		ScoreboardFreezeAt: &freezeAt,
		IsPublic:           &public,
	}, 1)

	body := map[string]any{"scoreboard_freeze_at": nil}
	b, _ := json.Marshal(body)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("PUT", "/api/games/1", bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var game map[string]any
	json.Unmarshal(w.Body.Bytes(), &game)
	assert.Nil(t, game["scoreboard_freeze_at"])
}

func TestDeleteGame_Success(t *testing.T) {
	svc := games.NewMockService()
	r := setupTestRouter(svc)

	public := true
	svc.CreateGame(games.CreateGameRequest{
		Name:      "Delete Me",
		StartTime: time.Now(),
		EndTime:   time.Now().Add(time.Hour),
		IsPublic:  &public,
	}, 1)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("DELETE", "/api/admin/games/1", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	w2 := httptest.NewRecorder()
	req2, _ := http.NewRequest("GET", "/api/games/1?all=true", nil)
	r.ServeHTTP(w2, req2)
	assert.Equal(t, http.StatusNotFound, w2.Code)
}

func TestExportGamePackage_Success(t *testing.T) {
	svc := games.NewMockService()
	svc.ChallengesByGame = map[uint][]games.GameChallengeDetail{
		1: {
			{
				ID:          11,
				Title:       "Exported Challenge",
				Description: "full statement",
				Category:    "web",
				Type:        "static",
				Difficulty:  "easy",
				Hints:       "[\"hint\"]",
				Attachments: "[\"https://example.com/web.zip\"]",
				Score:       100,
			},
		},
	}
	r := setupTestRouter(svc)

	public := true
	svc.CreateGame(games.CreateGameRequest{
		Name:      "Winter CTF 2026",
		StartTime: time.Now(),
		EndTime:   time.Now().Add(time.Hour),
		IsPublic:  &public,
	}, 1)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("POST", "/api/admin/games/1/export", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Equal(t, "application/zip", w.Header().Get("Content-Type"))
	assert.Contains(t, w.Header().Get("Content-Disposition"), "attachment; filename=\"game-1-winter-ctf-2026-export.zip\"")

	reader, err := zip.NewReader(bytes.NewReader(w.Body.Bytes()), int64(w.Body.Len()))
	assert.NoError(t, err)
	if err != nil {
		return
	}
	assert.Len(t, reader.File, 1)
	assert.Equal(t, "game.json", reader.File[0].Name)

	file, err := reader.File[0].Open()
	assert.NoError(t, err)
	if err != nil {
		return
	}
	defer file.Close()

	data, err := io.ReadAll(file)
	assert.NoError(t, err)
	assert.Contains(t, string(data), "\"version\":\"sauryctf.export.v2\"")
	assert.Contains(t, string(data), "\"name\":\"Winter CTF 2026\"")
	assert.Contains(t, string(data), "\"title\":\"Exported Challenge\"")
}

func TestImportGamePackage_Success(t *testing.T) {
	svc := games.NewMockService()
	r := setupTestRouter(svc)

	public := true
	svc.CreateGame(games.CreateGameRequest{
		Name:             "Winter CTF 2026",
		Description:      "source desc",
		Notice:           "source notice",
		StartTime:        time.Now(),
		EndTime:          time.Now().Add(time.Hour),
		RegistrationMode: games.RegistrationModeAutoAccept,
		MaxTeamMembers:   4,
		IsPublic:         &public,
	}, 1)
	svc.ChallengesByGame[1] = []games.GameChallengeDetail{
		{
			ID:          11,
			Title:       "Exported Challenge",
			Description: "full statement",
			Category:    "web",
			Type:        "static",
			Difficulty:  "easy",
			Hints:       "[\"hint\"]",
			Attachments: "[\"https://example.com/web.zip\"]",
			Score:       100,
		},
	}

	exported, _, err := svc.ExportGamePackage(1)
	assert.NoError(t, err)
	if err != nil {
		return
	}

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("file", "game-export.zip")
	assert.NoError(t, err)
	if err != nil {
		return
	}
	_, err = part.Write(exported)
	assert.NoError(t, err)
	assert.NoError(t, writer.Close())

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("POST", "/api/admin/games/import", &body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusCreated, w.Code)

	var response map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &response)
	assert.Equal(t, "Winter CTF 2026", response["name"])
	assert.Equal(t, "draft", response["status"])

	importedChallenges, err := svc.GetAdminGameChallenges(2)
	assert.NoError(t, err)
	assert.Len(t, importedChallenges, 1)
	assert.Equal(t, "Exported Challenge", importedChallenges[0].Title)
}

func TestImportGamePackage_MissingFile(t *testing.T) {
	svc := games.NewMockService()
	r := setupTestRouter(svc)

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	assert.NoError(t, writer.Close())

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("POST", "/api/admin/games/import", &body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
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

func TestGetGameChallenges_RedactsContentBeforeAcceptedStart(t *testing.T) {
	svc := games.NewMockService()
	svc.UserTeams[1] = &games.GameParticipationTeam{ID: 7, Name: "Blue Team"}
	svc.Participations["1-7"] = "pending"
	svc.ChallengesByGame = map[uint][]games.GameChallengeDetail{
		1: {
			{
				ID:          11,
				Title:       "Web 101",
				Description: "full statement",
				Category:    "web",
				Hints:       "[\"hint\"]",
				Attachments: "[\"https://example.com/web.zip\"]",
				Score:       100,
			},
		},
	}

	r := setupTestRouter(svc)

	public := true
	start := time.Now().Add(time.Hour)
	end := start.Add(time.Hour)
	active := "active"
	created, _ := svc.CreateGame(games.CreateGameRequest{
		Name:      "Upcoming Game",
		StartTime: start,
		EndTime:   end,
		IsPublic:  &public,
	}, 1)
	_, _ = svc.UpdateGame(created.ID, games.UpdateGameRequest{Status: &active})

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/api/games/1/challenges", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var response []map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &response)
	assert.Len(t, response, 1)
	assert.Equal(t, "", response[0]["description"])
	assert.Equal(t, "", response[0]["hints"])
	assert.Equal(t, "", response[0]["attachments"])
}

func TestGetGameChallenges_ExposesContentForAcceptedTeamAfterStart(t *testing.T) {
	svc := games.NewMockService()
	svc.UserTeams[1] = &games.GameParticipationTeam{ID: 7, Name: "Blue Team"}
	svc.Participations["1-7"] = "accepted"
	svc.ChallengesByGame = map[uint][]games.GameChallengeDetail{
		1: {
			{
				ID:          11,
				Title:       "Web 101",
				Description: "full statement",
				Category:    "web",
				Hints:       "[\"hint\"]",
				Attachments: "[\"https://example.com/web.zip\"]",
				Score:       100,
			},
		},
	}

	r := setupTestRouter(svc)

	public := true
	start := time.Now().Add(-time.Hour)
	end := time.Now().Add(time.Hour)
	active := "active"
	created, _ := svc.CreateGame(games.CreateGameRequest{
		Name:      "Running Game",
		StartTime: start,
		EndTime:   end,
		IsPublic:  &public,
	}, 1)
	_, _ = svc.UpdateGame(created.ID, games.UpdateGameRequest{Status: &active})

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/api/games/1/challenges", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var response []map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &response)
	assert.Len(t, response, 1)
	assert.Equal(t, "full statement", response[0]["description"])
	assert.Equal(t, "[\"hint\"]", response[0]["hints"])
	assert.Equal(t, "[\"https://example.com/web.zip\"]", response[0]["attachments"])
}

func TestGetAdminGameChallenges_ExposesFullContentForManagement(t *testing.T) {
	svc := games.NewMockService()
	svc.ChallengesByGame = map[uint][]games.GameChallengeDetail{
		1: {
			{
				ID:          11,
				Title:       "Hidden Admin Challenge",
				Description: "full statement",
				Category:    "web",
				Hints:       "[\"hint\"]",
				Attachments: "[\"https://example.com/web.zip\"]",
				Score:       100,
			},
		},
	}

	r := setupTestRouter(svc)

	public := true
	svc.CreateGame(games.CreateGameRequest{
		Name:      "Manage Game",
		StartTime: time.Now().Add(time.Hour),
		EndTime:   time.Now().Add(2 * time.Hour),
		IsPublic:  &public,
	}, 1)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/api/admin/games/1/challenges", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var response []map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &response)
	assert.Len(t, response, 1)
	assert.Equal(t, "full statement", response[0]["description"])
	assert.Equal(t, "[\"hint\"]", response[0]["hints"])
	assert.Equal(t, "[\"https://example.com/web.zip\"]", response[0]["attachments"])
}
