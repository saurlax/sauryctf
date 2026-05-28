package challenges

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
	g := rg.Group("/challenges")
	g.GET("", h.ListChallenges)
	g.GET("/:id", h.GetChallenge)
	g.POST("/:id/submit", h.SubmitFlag)

	// Admin-only routes
	admin := adminRg.Group("/challenges")
	admin.POST("", h.CreateChallenge)
	admin.PUT("/:id", h.UpdateChallenge)
	admin.DELETE("/:id", h.DeleteChallenge)
}

func (h *Handler) CreateChallenge(c *gin.Context) {
	var req CreateChallengeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		return
	}

	userID, _ := c.Get("user_id")
	ch, err := h.svc.CreateChallenge(req, userID.(uint))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, ch)
}

func (h *Handler) GetChallenge(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid id"})
		return
	}

	ch, err := h.svc.GetChallenge(uint(id))
	if err != nil {
		if err.Error() == "challenge not found" {
			c.JSON(http.StatusNotFound, gin.H{"message": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, ch)
}

func (h *Handler) ListChallenges(c *gin.Context) {
	category := c.Query("category")
	showHidden := c.Query("show_hidden") == "true"

	challenges, err := h.svc.ListChallenges(category, showHidden)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, challenges)
}

func (h *Handler) UpdateChallenge(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid id"})
		return
	}

	var req UpdateChallengeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		return
	}

	ch, err := h.svc.UpdateChallenge(uint(id), req)
	if err != nil {
		if err.Error() == "challenge not found" {
			c.JSON(http.StatusNotFound, gin.H{"message": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, ch)
}

func (h *Handler) DeleteChallenge(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid id"})
		return
	}

	if err := h.svc.DeleteChallenge(uint(id)); err != nil {
		if err.Error() == "challenge not found" {
			c.JSON(http.StatusNotFound, gin.H{"message": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "deleted"})
}

func (h *Handler) SubmitFlag(c *gin.Context) {
	challengeID, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid id"})
		return
	}

	var req struct {
		Flag   string `json:"flag" binding:"required"`
		GameID uint   `json:"game_id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		return
	}

	userID, _ := c.Get("user_id")
	teamID, _ := c.Get("team_id")

	result, err := h.svc.SubmitFlag(uint(challengeID), req.GameID, userID.(uint), teamID.(uint), req.Flag)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": err.Error()})
		return
	}

	status := http.StatusOK
	if result.Correct {
		status = http.StatusOK
	} else {
		status = http.StatusForbidden
	}
	c.JSON(status, result)
}
