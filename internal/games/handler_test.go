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
	api.POST("/admin/games/:id/scoreboard/export", func(c *gin.Context) {
		var id int
		fmt.Sscan(c.Param("id"), &id)
		h.ExportScoreboardPackage(c, id)
	})
	api.POST("/admin/games/:id/writeups/export", func(c *gin.Context) {
		var id int
		fmt.Sscan(c.Param("id"), &id)
		h.ExportWriteupsPackage(c, id)
	})
	api.POST("/admin/games/:id/submissions/export", func(c *gin.Context) {
		var id int
		fmt.Sscan(c.Param("id"), &id)
		h.ExportSubmissionsPackage(c, id)
	})
	api.GET("/admin/games/:id/announcements", func(c *gin.Context) {
		var id int
		fmt.Sscan(c.Param("id"), &id)
		h.ListAnnouncements(c, id)
	})
	api.POST("/admin/games/:id/announcements", func(c *gin.Context) {
		var id int
		fmt.Sscan(c.Param("id"), &id)
		h.CreateAnnouncement(c, id)
	})
	api.DELETE("/admin/games/:id/announcements/:announcementId", func(c *gin.Context) {
		var id, announcementId int
		fmt.Sscan(c.Param("id"), &id)
		fmt.Sscan(c.Param("announcementId"), &announcementId)
		h.DeleteAnnouncement(c, id, announcementId)
	})
	api.GET("/admin/games/:id/submissions", func(c *gin.Context) {
		var id int
		fmt.Sscan(c.Param("id"), &id)
		h.ListSubmissionRecords(c, id)
	})
	api.GET("/admin/games/:id/cheat-clues", func(c *gin.Context) {
		var id int
		fmt.Sscan(c.Param("id"), &id)
		h.ListSubmissionCheatClues(c, id)
	})
	api.GET("/admin/dashboard/summary", h.GetAdminDashboardSummary)
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
	api.GET("/games/:id/challenges/:challengeId/instance", func(c *gin.Context) {
		var id, challengeId int
		fmt.Sscan(c.Param("id"), &id)
		fmt.Sscan(c.Param("challengeId"), &challengeId)
		h.GetChallengeInstance(c, id, challengeId)
	})
	api.POST("/games/:id/challenges/:challengeId/instance", func(c *gin.Context) {
		var id, challengeId int
		fmt.Sscan(c.Param("id"), &id)
		fmt.Sscan(c.Param("challengeId"), &challengeId)
		h.EnsureChallengeInstance(c, id, challengeId)
	})
	api.DELETE("/games/:id/challenges/:challengeId/instance", func(c *gin.Context) {
		var id, challengeId int
		fmt.Sscan(c.Param("id"), &id)
		fmt.Sscan(c.Param("challengeId"), &challengeId)
		h.DestroyChallengeInstance(c, id, challengeId)
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
	api.GET("/games/:id/writeup", func(c *gin.Context) {
		var id int
		fmt.Sscan(c.Param("id"), &id)
		h.GetWriteup(c, id)
	})
	api.PUT("/games/:id/writeup", func(c *gin.Context) {
		var id int
		fmt.Sscan(c.Param("id"), &id)
		h.SubmitWriteup(c, id)
	})
	api.GET("/admin/games/:id/writeups", func(c *gin.Context) {
		var id int
		fmt.Sscan(c.Param("id"), &id)
		h.ListWriteups(c, id)
	})
	api.PUT("/admin/games/:id/writeups/:teamId", func(c *gin.Context) {
		var id, teamId int
		fmt.Sscan(c.Param("id"), &id)
		fmt.Sscan(c.Param("teamId"), &teamId)
		h.ReviewWriteup(c, id, teamId)
	})
	return r
}

func TestCreateGame_Success(t *testing.T) {
	svc := games.NewMockService()
	r := setupTestRouter(svc)

	writeupDeadline := time.Now().Add(72 * time.Hour).Format(time.RFC3339)
	body := map[string]interface{}{
		"name":              "Spring CTF",
		"description":       "A fun CTF",
		"divisions":         []string{"student", "open"},
		"start_time":        time.Now().Add(24 * time.Hour).Format(time.RFC3339),
		"end_time":          time.Now().Add(48 * time.Hour).Format(time.RFC3339),
		"registration_mode": "auto_accept",
		"max_team_members":  4,
		"practice_mode":     true,
		"writeup_required":  true,
		"writeup_deadline":  writeupDeadline,
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
	assert.Equal(t, true, game["practice_mode"])
	assert.Equal(t, true, game["writeup_required"])
	assert.Equal(t, writeupDeadline, game["writeup_deadline"])
	assert.Equal(t, []interface{}{"student", "open"}, game["divisions"])
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

func TestListGames_PublicViewHidesInvitationCode(t *testing.T) {
	svc := games.NewMockService()
	r := setupTestRouter(svc)

	public := true
	created, _ := svc.CreateGame(games.CreateGameRequest{
		Name:           "Invite Game",
		InvitationCode: "spring-2026",
		StartTime:      time.Now(),
		EndTime:        time.Now().Add(time.Hour),
		IsPublic:       &public,
	}, 1)
	active := "active"
	_, _ = svc.UpdateGame(created.ID, games.UpdateGameRequest{Status: &active})

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/api/games", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var gamesList []map[string]any
	assert.NoError(t, json.Unmarshal(w.Body.Bytes(), &gamesList))
	assert.Len(t, gamesList, 1)
	assert.Equal(t, true, gamesList[0]["invitation_required"])
	_, hasCode := gamesList[0]["invitation_code"]
	assert.False(t, hasCode)
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
	practiceMode := true
	writeupRequired := true
	writeupDeadline := time.Now().Add(2 * time.Hour).UTC().Truncate(time.Second)
	body := games.UpdateGameRequest{
		Name:             &newName,
		RegistrationMode: &newMode,
		MaxTeamMembers:   &newLimit,
		PracticeMode:     &practiceMode,
		WriteupRequired:  &writeupRequired,
		WriteupDeadline:  &writeupDeadline,
	}
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
	assert.Equal(t, true, game["practice_mode"])
	assert.Equal(t, true, game["writeup_required"])
	assert.Equal(t, writeupDeadline.Format(time.RFC3339), game["writeup_deadline"])
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

func TestUpdateGame_ClearWriteupDeadline_Success(t *testing.T) {
	svc := games.NewMockService()
	r := setupTestRouter(svc)

	public := true
	writeupDeadline := time.Now().Add(2 * time.Hour)
	svc.CreateGame(games.CreateGameRequest{
		Name:            "Game",
		StartTime:       time.Now(),
		EndTime:         time.Now().Add(time.Hour),
		WriteupRequired: true,
		WriteupDeadline: &writeupDeadline,
		IsPublic:        &public,
	}, 1)

	body := map[string]any{"writeup_deadline": nil}
	b, _ := json.Marshal(body)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("PUT", "/api/games/1", bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var game map[string]any
	json.Unmarshal(w.Body.Bytes(), &game)
	assert.Nil(t, game["writeup_deadline"])
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

func TestExportScoreboardPackage_Success(t *testing.T) {
	svc := games.NewMockService()
	r := setupTestRouter(svc)

	public := true
	svc.CreateGame(games.CreateGameRequest{
		Name:      "Winter CTF 2026",
		Divisions: []string{"student", "open"},
		StartTime: time.Now(),
		EndTime:   time.Now().Add(time.Hour),
		IsPublic:  &public,
	}, 1)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("POST", "/api/admin/games/1/scoreboard/export?division=student", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Equal(t, "application/zip", w.Header().Get("Content-Type"))
	assert.Contains(t, w.Header().Get("Content-Disposition"), "scoreboard-student-export.zip")

	reader, err := zip.NewReader(bytes.NewReader(w.Body.Bytes()), int64(w.Body.Len()))
	assert.NoError(t, err)
	if err != nil {
		return
	}

	fileNames := make([]string, 0, len(reader.File))
	for _, file := range reader.File {
		fileNames = append(fileNames, file.Name)
	}
	assert.ElementsMatch(t, []string{"scoreboard.json", "rankings.csv", "challenge-stats.csv"}, fileNames)
}

func TestExportWriteupsPackage_Success(t *testing.T) {
	svc := games.NewMockService()
	svc.UserTeams[1] = &games.GameParticipationTeam{ID: 7, Name: "Blue Team"}
	svc.Participations["1-7"] = "accepted"
	_, _ = svc.CreateGame(games.CreateGameRequest{
		Name:            "Writeup Export Game",
		StartTime:       time.Now(),
		EndTime:         time.Now().Add(time.Hour),
		WriteupRequired: true,
	}, 1)
	_, _ = svc.SubmitWriteup(1, 1, games.SubmitGameWriteupRequest{Content: "# Blue Team\n\nOur writeup"})

	r := setupTestRouter(svc)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("POST", "/api/admin/games/1/writeups/export", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Equal(t, "application/zip", w.Header().Get("Content-Type"))
	assert.Contains(t, w.Header().Get("Content-Disposition"), "writeups-export.zip")

	reader, err := zip.NewReader(bytes.NewReader(w.Body.Bytes()), int64(w.Body.Len()))
	assert.NoError(t, err)
	if err != nil {
		return
	}

	fileNames := make([]string, 0, len(reader.File))
	for _, file := range reader.File {
		fileNames = append(fileNames, file.Name)
	}

	assert.Contains(t, fileNames, "writeups.json")
	assert.Contains(t, fileNames, "writeups.csv")
	assert.Contains(t, fileNames, "writeups/team-7-blue-team.md")
}

func TestExportSubmissionsPackage_Success(t *testing.T) {
	svc := games.NewMockService()
	_, _ = svc.CreateGame(games.CreateGameRequest{
		Name:      "Submission Export Game",
		StartTime: time.Now(),
		EndTime:   time.Now().Add(time.Hour),
	}, 1)

	r := setupTestRouter(svc)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("POST", "/api/admin/games/1/submissions/export", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Equal(t, "application/zip", w.Header().Get("Content-Type"))
	assert.Contains(t, w.Header().Get("Content-Disposition"), "submissions-export.zip")

	reader, err := zip.NewReader(bytes.NewReader(w.Body.Bytes()), int64(w.Body.Len()))
	assert.NoError(t, err)
	if err != nil {
		return
	}

	fileNames := make([]string, 0, len(reader.File))
	for _, file := range reader.File {
		fileNames = append(fileNames, file.Name)
	}

	assert.Contains(t, fileNames, "submissions.json")
	assert.Contains(t, fileNames, "submissions.csv")
}

func TestChallengeInstanceLifecycle_Success(t *testing.T) {
	svc := games.NewMockService()
	r := setupTestRouter(svc)

	w1 := httptest.NewRecorder()
	req1, _ := http.NewRequest("GET", "/api/games/1/challenges/2/instance", nil)
	r.ServeHTTP(w1, req1)
	assert.Equal(t, http.StatusOK, w1.Code)
	assert.Contains(t, w1.Body.String(), `"status":"idle"`)
	assert.Contains(t, w1.Body.String(), `"policy":{"lease_duration_minutes":30,"extension_duration_minutes":30,"renewal_window_minutes":10,"team_active_limit":3}`)

	w2 := httptest.NewRecorder()
	req2, _ := http.NewRequest("POST", "/api/games/1/challenges/2/instance", nil)
	r.ServeHTTP(w2, req2)
	assert.Equal(t, http.StatusOK, w2.Code)
	assert.Contains(t, w2.Body.String(), `"status":"running"`)
	assert.Contains(t, w2.Body.String(), `"policy":{"lease_duration_minutes":30,"extension_duration_minutes":30,"renewal_window_minutes":10,"team_active_limit":3}`)

	w3 := httptest.NewRecorder()
	req3, _ := http.NewRequest("DELETE", "/api/games/1/challenges/2/instance", nil)
	r.ServeHTTP(w3, req3)
	assert.Equal(t, http.StatusOK, w3.Code)
	assert.Contains(t, w3.Body.String(), `"status":"idle"`)
}

func TestListSubmissionRecords_Success(t *testing.T) {
	svc := games.NewMockService()
	_, _ = svc.CreateGame(games.CreateGameRequest{
		Name:      "Submission Monitor Game",
		StartTime: time.Now(),
		EndTime:   time.Now().Add(time.Hour),
	}, 1)
	_, _ = svc.SubmitFlag(1, 3, 1, 7, "wrong_flag")
	_, _ = svc.SubmitFlag(1, 3, 1, 7, "correct_flag")

	r := setupTestRouter(svc)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/api/admin/games/1/submissions", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var response []map[string]any
	assert.NoError(t, json.Unmarshal(w.Body.Bytes(), &response))
	assert.Len(t, response, 2)
	assert.Equal(t, "accepted", response[0]["result"])
	assert.Equal(t, "wrong_flag", response[1]["result"])
}

func TestListSubmissionRecords_SupportsTypeAndCountQuery(t *testing.T) {
	svc := games.NewMockService()
	_, _ = svc.CreateGame(games.CreateGameRequest{
		Name:      "Submission Filter Game",
		StartTime: time.Now(),
		EndTime:   time.Now().Add(time.Hour),
	}, 1)
	_, _ = svc.SubmitFlag(1, 3, 1, 7, "wrong_flag")
	_, _ = svc.SubmitFlag(1, 3, 1, 7, "correct_flag")

	r := setupTestRouter(svc)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/api/admin/games/1/submissions?type=wrong_flag&count=1", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var response []map[string]any
	assert.NoError(t, json.Unmarshal(w.Body.Bytes(), &response))
	assert.Len(t, response, 1)
	assert.Equal(t, "wrong_flag", response[0]["result"])
}

func TestListSubmissionCheatClues_Success(t *testing.T) {
	svc := games.NewMockService()
	_, _ = svc.CreateGame(games.CreateGameRequest{
		Name:      "Cheat Clue Game",
		StartTime: time.Now(),
		EndTime:   time.Now().Add(time.Hour),
	}, 1)
	svc.CheatClues[1] = []games.GameSubmissionCheatClue{
		{
			SubmittedFlag:   "test-flag",
			ChallengeID:     3,
			ChallengeTitle:  "Mock Challenge",
			FirstSeenAt:     time.Now().Add(-time.Minute),
			LastSeenAt:      time.Now(),
			TeamCount:       2,
			SubmissionCount: 3,
			Teams:           []string{"Blue Team", "Red Team"},
		},
	}

	r := setupTestRouter(svc)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/api/admin/games/1/cheat-clues", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var response []map[string]any
	assert.NoError(t, json.Unmarshal(w.Body.Bytes(), &response))
	assert.Len(t, response, 1)
	assert.Equal(t, "test-flag", response[0]["submitted_flag"])
	assert.Equal(t, float64(2), response[0]["team_count"])
}

func TestCreateAnnouncement_Success(t *testing.T) {
	svc := games.NewMockService()
	r := setupTestRouter(svc)

	public := true
	_, _ = svc.CreateGame(games.CreateGameRequest{
		Name: "Announcement Game", StartTime: time.Now(), EndTime: time.Now().Add(time.Hour), IsPublic: &public,
	}, 1)

	body := map[string]any{"content": "比赛将在 10 分钟后开始，请提前检查网络。"}
	b, _ := json.Marshal(body)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("POST", "/api/admin/games/1/announcements", bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusCreated, w.Code)

	var response map[string]any
	assert.NoError(t, json.Unmarshal(w.Body.Bytes(), &response))
	assert.Equal(t, "比赛将在 10 分钟后开始，请提前检查网络。", response["content"])
}

func TestListAnnouncements_Success(t *testing.T) {
	svc := games.NewMockService()
	r := setupTestRouter(svc)

	public := true
	_, _ = svc.CreateGame(games.CreateGameRequest{
		Name: "Announcement Game", StartTime: time.Now(), EndTime: time.Now().Add(time.Hour), IsPublic: &public,
	}, 1)
	svc.Announcements[1] = []games.GameAnnouncementResponse{
		{ID: 2, GameID: 1, Content: "第二条公告", CreatedBy: 1, CreatedAt: time.Now()},
		{ID: 1, GameID: 1, Content: "第一条公告", CreatedBy: 1, CreatedAt: time.Now().Add(-time.Minute)},
	}

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/api/admin/games/1/announcements", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var response []map[string]any
	assert.NoError(t, json.Unmarshal(w.Body.Bytes(), &response))
	assert.Len(t, response, 2)
	assert.Equal(t, "第二条公告", response[0]["content"])
}

func TestDeleteAnnouncement_Success(t *testing.T) {
	svc := games.NewMockService()
	r := setupTestRouter(svc)

	public := true
	_, _ = svc.CreateGame(games.CreateGameRequest{
		Name: "Announcement Game", StartTime: time.Now(), EndTime: time.Now().Add(time.Hour), IsPublic: &public,
	}, 1)
	svc.Announcements[1] = []games.GameAnnouncementResponse{
		{ID: 1, GameID: 1, Content: "待删除公告", CreatedBy: 1, CreatedAt: time.Now()},
	}

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("DELETE", "/api/admin/games/1/announcements/1", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Empty(t, svc.Announcements[1])
}

func TestGetAdminDashboardSummary_Success(t *testing.T) {
	svc := games.NewMockService()
	r := setupTestRouter(svc)

	public := true
	_, err := svc.CreateGame(games.CreateGameRequest{
		Name:      "Summary Game",
		StartTime: time.Now().Add(time.Hour),
		EndTime:   time.Now().Add(2 * time.Hour),
		IsPublic:  &public,
	}, 1)
	assert.NoError(t, err)
	svc.Submissions[1] = []games.GameSubmissionRecord{
		{
			ID:             1,
			GameID:         1,
			ChallengeID:    3,
			ChallengeTitle: "Web 101",
			TeamID:         7,
			TeamName:       "Blue Team",
			Result:         "accepted",
			SubmittedAt:    time.Now(),
		},
	}
	svc.CheatClues[1] = []games.GameSubmissionCheatClue{
		{
			SubmittedFlag:   "flag{shared}",
			ChallengeID:     3,
			ChallengeTitle:  "Web 101",
			TeamCount:       2,
			SubmissionCount: 3,
			LastSeenAt:      time.Now(),
		},
	}

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/api/admin/dashboard/summary", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Body.String(), `"games"`)
	assert.Contains(t, w.Body.String(), `"Summary Game"`)
	assert.Contains(t, w.Body.String(), `"recent_submissions"`)
	assert.Contains(t, w.Body.String(), `"cheat_clues"`)
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
		PracticeMode:     true,
		WriteupRequired:  true,
		WriteupDeadline:  func() *time.Time { v := time.Now().Add(24 * time.Hour).UTC().Truncate(time.Second); return &v }(),
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
	assert.Equal(t, true, response["practice_mode"])
	assert.Equal(t, true, response["writeup_required"])

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

func TestGetScoreboard_SupportsDivisionQuery(t *testing.T) {
	svc := games.NewMockService()
	r := setupTestRouter(svc)

	public := true
	_, _ = svc.CreateGame(games.CreateGameRequest{
		Name:      "Division Game",
		Divisions: []string{"student", "open"},
		StartTime: time.Now(),
		EndTime:   time.Now().Add(time.Hour),
		IsPublic:  &public,
	}, 1)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/api/games/1/scoreboard?division=student", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var response map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &response)
	assert.Equal(t, "student", response["division"])
	assert.Equal(t, []interface{}{"student", "open"}, response["divisions"])
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
				ID:            11,
				Title:         "Web 101",
				Description:   "full statement",
				Category:      "web",
				Hints:         "[\"hint\"]",
				Attachments:   "[\"https://example.com/web.zip\"]",
				ContainerSpec: "{\"connection\":{\"url\":\"http://127.0.0.1:8081\"}}",
				Score:         100,
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
	assert.Equal(t, "", response[0]["container_spec"])
}

func TestGetGameChallenges_ExposesContentForAcceptedTeamAfterStart(t *testing.T) {
	svc := games.NewMockService()
	svc.UserTeams[1] = &games.GameParticipationTeam{ID: 7, Name: "Blue Team"}
	svc.Participations["1-7"] = "accepted"
	svc.ChallengesByGame = map[uint][]games.GameChallengeDetail{
		1: {
			{
				ID:            11,
				Title:         "Web 101",
				Description:   "full statement",
				Category:      "web",
				Hints:         "[\"hint\"]",
				Attachments:   "[\"https://example.com/web.zip\"]",
				ContainerSpec: "{\"connection\":{\"url\":\"http://127.0.0.1:8081\"}}",
				Score:         100,
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
	assert.Equal(t, "{\"connection\":{\"url\":\"http://127.0.0.1:8081\"}}", response[0]["container_spec"])
}

func TestGetAdminGameChallenges_ExposesFullContentForManagement(t *testing.T) {
	svc := games.NewMockService()
	svc.ChallengesByGame = map[uint][]games.GameChallengeDetail{
		1: {
			{
				ID:            11,
				Title:         "Hidden Admin Challenge",
				Description:   "full statement",
				Category:      "web",
				Hints:         "[\"hint\"]",
				Attachments:   "[\"https://example.com/web.zip\"]",
				ContainerSpec: "{\"connection\":{\"url\":\"http://127.0.0.1:8081\"}}",
				Score:         100,
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
	assert.Equal(t, "{\"connection\":{\"url\":\"http://127.0.0.1:8081\"}}", response[0]["container_spec"])
}

func TestSubmitWriteup_Success(t *testing.T) {
	svc := games.NewMockService()
	svc.UserTeams[1] = &games.GameParticipationTeam{ID: 7, Name: "Blue Team"}
	svc.Participations["1-7"] = "accepted"
	r := setupTestRouter(svc)

	public := true
	svc.CreateGame(games.CreateGameRequest{
		Name:            "Writeup Game",
		StartTime:       time.Now(),
		EndTime:         time.Now().Add(time.Hour),
		WriteupRequired: true,
		IsPublic:        &public,
	}, 1)

	body := map[string]string{"content": "our writeup"}
	b, _ := json.Marshal(body)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("PUT", "/api/games/1/writeup", bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var response map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &response)
	assert.Equal(t, "submitted", response["status"])
	assert.Equal(t, "our writeup", response["content"])
}

func TestReviewWriteup_Success(t *testing.T) {
	svc := games.NewMockService()
	svc.UserTeams[1] = &games.GameParticipationTeam{ID: 7, Name: "Blue Team"}
	svc.Participations["1-7"] = "accepted"
	r := setupTestRouter(svc)

	public := true
	svc.CreateGame(games.CreateGameRequest{
		Name:            "Writeup Review Game",
		StartTime:       time.Now(),
		EndTime:         time.Now().Add(time.Hour),
		WriteupRequired: true,
		IsPublic:        &public,
	}, 1)
	_, _ = svc.SubmitWriteup(1, 1, games.SubmitGameWriteupRequest{Content: "initial writeup"})

	body := map[string]string{"status": "approved", "remark": "looks good"}
	b, _ := json.Marshal(body)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("PUT", "/api/admin/games/1/writeups/7", bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var response map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &response)
	assert.Equal(t, "approved", response["status"])
	assert.Equal(t, "looks good", response["review_remark"])
}
