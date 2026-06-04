package games

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gin-gonic/gin/binding"
)

type Handler struct {
	svc ServiceInterface
}

func NewHandler(svc ServiceInterface) *Handler {
	return &Handler{svc: svc}
}

func (h *Handler) CreateGame(c *gin.Context) {
	var req CreateGameRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		return
	}

	userID, _ := c.Get("user_id")
	game, err := h.svc.CreateGame(req, userID.(uint))
	if err != nil {
		switch err.Error() {
		case "invalid registration mode", "invalid max team members", "invalid game timeline", "invalid scoreboard freeze time":
			c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"message": err.Error()})
		}
		return
	}
	c.JSON(http.StatusCreated, game)
}

func (h *Handler) GetGame(c *gin.Context, id int) {
	showAll := c.Query("all") == "true"

	var (
		game *GameResponse
		err  error
	)
	if showAll {
		game, err = h.svc.GetGame(uint(id))
	} else {
		game, err = h.svc.GetPublicGame(uint(id))
	}
	if err != nil {
		if err.Error() == "game not found" {
			c.JSON(http.StatusNotFound, gin.H{"message": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, game)
}

func (h *Handler) ListGames(c *gin.Context, showAll bool) {
	games, err := h.svc.ListGames(showAll)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, games)
}

func (h *Handler) UpdateGame(c *gin.Context, id int) {
	var req UpdateGameRequest
	if err := c.ShouldBindBodyWith(&req, binding.JSON); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		return
	}
	var raw map[string]any
	if err := c.ShouldBindBodyWith(&raw, binding.JSON); err == nil {
		if value, ok := raw["scoreboard_freeze_at"]; ok && value == nil {
			req.ClearScoreboardFreeze = true
		}
	}

	game, err := h.svc.UpdateGame(uint(id), req)
	if err != nil {
		switch err.Error() {
		case "game not found":
			c.JSON(http.StatusNotFound, gin.H{"message": err.Error()})
		case "invalid registration mode", "invalid max team members", "invalid game timeline", "invalid scoreboard freeze time":
			c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"message": err.Error()})
		}
		return
	}
	c.JSON(http.StatusOK, game)
}

func (h *Handler) AddChallengeToGame(c *gin.Context, id int) {
	var req struct {
		ChallengeID   uint `json:"challenge_id" binding:"required"`
		ScoreOverride int  `json:"score_override"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		return
	}

	if err := h.svc.AddChallenge(uint(id), req.ChallengeID, req.ScoreOverride); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "added"})
}

func (h *Handler) RemoveChallengeFromGame(c *gin.Context, id int, challengeId int) {
	if err := h.svc.RemoveChallenge(uint(id), uint(challengeId)); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "removed"})
}

func (h *Handler) JoinGame(c *gin.Context, id int) {
	var req struct {
		TeamID uint `json:"team_id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		return
	}

	userID := c.MustGet("user_id").(uint)
	if err := h.svc.JoinGame(uint(id), req.TeamID, userID); err != nil {
		c.JSON(http.StatusConflict, gin.H{"message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "joined"})
}

func (h *Handler) LeaveGame(c *gin.Context, id int) {
	var req struct {
		TeamID uint `json:"team_id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		return
	}

	userID := c.MustGet("user_id").(uint)
	if err := h.svc.LeaveGame(uint(id), req.TeamID, userID); err != nil {
		c.JSON(http.StatusConflict, gin.H{"message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "left"})
}

func (h *Handler) GetGameChallenges(c *gin.Context, id int) {
	var challenges []GameChallengeDetail
	var err error

	game, gameErr := h.svc.GetGame(uint(id))
	if gameErr != nil {
		if gameErr.Error() == "game not found" {
			c.JSON(http.StatusNotFound, gin.H{"message": gameErr.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"message": gameErr.Error()})
		return
	}

	userID := c.MustGet("user_id").(uint)
	userRole, _ := c.Get("user_role")
	participation, statusErr := h.svc.GetParticipationStatus(uint(id), userID)
	if statusErr != nil {
		if statusErr.Error() == "game not found" {
			c.JSON(http.StatusNotFound, gin.H{"message": statusErr.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"message": statusErr.Error()})
		return
	}

	if participation.HasTeam && participation.Participated && participation.Team != nil {
		challenges, err = h.svc.GetGameChallengesForTeam(uint(id), participation.Team.ID)
	} else {
		challenges, err = h.svc.GetGameChallenges(uint(id))
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": err.Error()})
		return
	}

	canViewContent := false
	if role, ok := userRole.(string); ok && (role == "admin" || role == "super_admin") {
		canViewContent = true
	}
	if participation.Status == "accepted" && !time.Now().Before(game.StartTime) {
		canViewContent = true
	}
	if !canViewContent {
		challenges = redactChallengeContent(challenges)
	}

	c.JSON(http.StatusOK, challenges)
}

func (h *Handler) GetAdminGameChallenges(c *gin.Context, id int) {
	challenges, err := h.svc.GetAdminGameChallenges(uint(id))
	if err != nil {
		if err.Error() == "game not found" {
			c.JSON(http.StatusNotFound, gin.H{"message": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"message": err.Error()})
		return
	}

	c.JSON(http.StatusOK, challenges)
}

func redactChallengeContent(challenges []GameChallengeDetail) []GameChallengeDetail {
	result := make([]GameChallengeDetail, len(challenges))
	copy(result, challenges)
	for i := range result {
		result[i].Description = ""
		result[i].Hints = ""
		result[i].Attachments = ""
	}
	return result
}

func (h *Handler) SubmitGameFlag(c *gin.Context, id int, challengeId int) {
	var req struct {
		Flag   string `json:"flag" binding:"required"`
		TeamID uint   `json:"team_id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		return
	}

	userID := c.MustGet("user_id").(uint)
	result, err := h.svc.SubmitFlag(uint(id), uint(challengeId), userID, req.TeamID, req.Flag)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		return
	}

	if result.Correct {
		c.JSON(http.StatusOK, result)
	} else {
		c.JSON(http.StatusForbidden, result)
	}
}

func (h *Handler) GetScoreboard(c *gin.Context, id int) {
	scoreboard, err := h.svc.GetScoreboard(uint(id))
	if err != nil {
		if err.Error() == "game not found" {
			c.JSON(http.StatusNotFound, gin.H{"message": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, scoreboard)
}

func (h *Handler) GetParticipants(c *gin.Context, id int) {
	participants, err := h.svc.GetParticipants(uint(id))
	if err != nil {
		if err.Error() == "game not found" {
			c.JSON(http.StatusNotFound, gin.H{"message": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"message": err.Error()})
		return
	}

	c.JSON(http.StatusOK, participants)
}

func (h *Handler) UpdateParticipantStatus(c *gin.Context, id int, teamId int) {
	var req struct {
		Status string `json:"status" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		return
	}

	participant, err := h.svc.UpdateParticipationStatus(uint(id), uint(teamId), req.Status)
	if err != nil {
		switch err.Error() {
		case "game not found", "participation not found":
			c.JSON(http.StatusNotFound, gin.H{"message": err.Error()})
		case "invalid participation status":
			c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"message": err.Error()})
		}
		return
	}

	c.JSON(http.StatusOK, participant)
}

func (h *Handler) RemoveParticipant(c *gin.Context, id int, teamId int) {
	if err := h.svc.RemoveParticipation(uint(id), uint(teamId)); err != nil {
		switch err.Error() {
		case "game not found", "participation not found":
			c.JSON(http.StatusNotFound, gin.H{"message": err.Error()})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"message": err.Error()})
		}
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "removed"})
}

func (h *Handler) GetGameParticipation(c *gin.Context, id int) {
	userID := c.MustGet("user_id").(uint)

	participation, err := h.svc.GetParticipationStatus(uint(id), userID)
	if err != nil {
		if err.Error() == "game not found" {
			c.JSON(http.StatusNotFound, gin.H{"message": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"message": err.Error()})
		return
	}

	c.JSON(http.StatusOK, participation)
}
