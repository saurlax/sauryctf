package teams

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

type CreateTeamRequest struct {
	Name string `json:"name" binding:"required,min=2,max=128"`
}

type JoinTeamRequest struct {
	InviteCode string `json:"invite_code" binding:"required"`
}

func (h *Handler) CreateTeam(c *gin.Context) {
	var req CreateTeamRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	userID := c.MustGet("user_id").(uint)

	team, err := h.svc.CreateTeam(req.Name, userID)
	if err != nil {
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"team": team})
}

func (h *Handler) JoinTeam(c *gin.Context) {
	var req JoinTeamRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	userID := c.MustGet("user_id").(uint)

	if err := h.svc.JoinTeam(req.InviteCode, userID); err != nil {
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "joined team"})
}

func (h *Handler) LeaveTeam(c *gin.Context) {
	userID := c.MustGet("user_id").(uint)

	team, err := h.svc.GetUserTeam(userID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not in any team"})
		return
	}

	if err := h.svc.LeaveTeam(team.ID, userID); err != nil {
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "left team"})
}

func (h *Handler) GetMyTeam(c *gin.Context) {
	userID := c.MustGet("user_id").(uint)

	team, err := h.svc.GetUserTeam(userID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not in any team"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"team": team})
}

func (h *Handler) RemoveMember(c *gin.Context) {
	userID := c.MustGet("user_id").(uint)

	teamID, err := strconv.ParseUint(c.Param("team_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid team_id"})
		return
	}

	memberID, err := strconv.ParseUint(c.Param("member_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid member_id"})
		return
	}

	if err := h.svc.RemoveMember(uint(teamID), uint(memberID), userID); err != nil {
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "member removed"})
}

func (h *Handler) RegisterRoutes(rg *gin.RouterGroup) {
	teams := rg.Group("/teams")
	{
		teams.POST("", h.CreateTeam)
		teams.POST("/join", h.JoinTeam)
		teams.POST("/leave", h.LeaveTeam)
		teams.GET("/my", h.GetMyTeam)
		teams.DELETE("/:team_id/members/:member_id", h.RemoveMember)
	}
}
