package audit

import (
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"
)

type Handler struct {
	svc ServiceInterface
}

func NewHandler(svc ServiceInterface) *Handler {
	return &Handler{svc: svc}
}

func (h *Handler) ListLogs(c *gin.Context) {
	var actorUserID *uint
	if value := c.Query("actor_user_id"); value != "" {
		var parsed uint
		if _, err := fmt.Sscan(value, &parsed); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"message": "invalid actor_user_id"})
			return
		}
		actorUserID = &parsed
	}

	limit := 100
	if value := c.Query("limit"); value != "" {
		if _, err := fmt.Sscan(value, &limit); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"message": "invalid limit"})
			return
		}
	}

	logs, err := h.svc.ListLogs(actorUserID, c.Query("target_type"), limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": err.Error()})
		return
	}

	c.JSON(http.StatusOK, logs)
}
