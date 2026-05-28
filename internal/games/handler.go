package games

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
)

type Handler struct {
	svc ServiceInterface
}

func NewHandler(svc ServiceInterface) *Handler {
	return &Handler{svc: svc}
}

func (h *Handler) RegisterRoutes(rg *gin.RouterGroup, adminRg *gin.RouterGroup) {
	// Public (authenticated) routes
	g := rg.Group("/games")
	g.GET("", h.ListGames)
	g.GET("/:id", h.GetGame)
	g.GET("/:id/challenges", h.GetGameChallenges)
	g.GET("/:id/scoreboard", h.GetScoreboard)
	g.POST("/:id/join", h.JoinGame)
	g.DELETE("/:id/leave", h.LeaveGame)
	g.POST("/:id/challenges/:challenge_id/submit", h.SubmitFlag)

	// Admin-only routes
	admin := adminRg.Group("/games")
	admin.POST("", h.CreateGame)
	admin.PUT("/:id", h.UpdateGame)
	admin.POST("/:id/challenges", h.AddChallenge)
	admin.DELETE("/:id/challenges/:challenge_id", h.RemoveChallenge)
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
		c.JSON(http.StatusInternalServerError, gin.H{"message": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, game)
}

func (h *Handler) GetGame(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid id"})
		return
	}

	game, err := h.svc.GetGame(uint(id))
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

func (h *Handler) ListGames(c *gin.Context) {
	showAll := c.Query("all") == "true"
	games, err := h.svc.ListGames(showAll)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, games)
}

func (h *Handler) UpdateGame(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid id"})
		return
	}

	var req UpdateGameRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		return
	}

	game, err := h.svc.UpdateGame(uint(id), req)
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

func (h *Handler) AddChallenge(c *gin.Context) {
	gameID, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid game id"})
		return
	}

	var req struct {
		ChallengeID   uint `json:"challenge_id" binding:"required"`
		ScoreOverride int  `json:"score_override"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		return
	}

	if err := h.svc.AddChallenge(uint(gameID), req.ChallengeID, req.ScoreOverride); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "added"})
}

func (h *Handler) RemoveChallenge(c *gin.Context) {
	gameID, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid game id"})
		return
	}

	challengeID, err := strconv.ParseUint(c.Param("challenge_id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid challenge id"})
		return
	}

	if err := h.svc.RemoveChallenge(uint(gameID), uint(challengeID)); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "removed"})
}

func (h *Handler) JoinGame(c *gin.Context) {
	gameID, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid id"})
		return
	}

	var req struct {
		TeamID uint `json:"team_id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		return
	}

	userID := c.MustGet("user_id").(uint)
	if err := h.svc.JoinGame(uint(gameID), req.TeamID, userID); err != nil {
		c.JSON(http.StatusConflict, gin.H{"message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "joined"})
}

func (h *Handler) LeaveGame(c *gin.Context) {
	gameID, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid id"})
		return
	}

	var req struct {
		TeamID uint `json:"team_id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		return
	}

	userID := c.MustGet("user_id").(uint)
	if err := h.svc.LeaveGame(uint(gameID), req.TeamID, userID); err != nil {
		c.JSON(http.StatusConflict, gin.H{"message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "left"})
}

func (h *Handler) GetGameChallenges(c *gin.Context) {
	gameID, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid id"})
		return
	}

	challenges, err := h.svc.GetGameChallenges(uint(gameID))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, challenges)
}

func (h *Handler) SubmitFlag(c *gin.Context) {
	gameID, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid game id"})
		return
	}

	challengeID, err := strconv.ParseUint(c.Param("challenge_id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid challenge id"})
		return
	}

	var req struct {
		Flag   string `json:"flag" binding:"required"`
		TeamID uint   `json:"team_id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		return
	}

	userID := c.MustGet("user_id").(uint)
	result, err := h.svc.SubmitFlag(uint(gameID), uint(challengeID), userID, req.TeamID, req.Flag)
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

func (h *Handler) GetScoreboard(c *gin.Context) {
	gameID, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid id"})
		return
	}

	scoreboard, err := h.svc.GetScoreboard(uint(gameID))
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
