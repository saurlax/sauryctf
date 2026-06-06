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
	h.ListLogsWithFilters(c, nil, c.Query("target_type"), c.Query("limit"))
}

func (h *Handler) ListLogsWithFilters(c *gin.Context, actorUserIDParam *int, targetType string, limitRaw string) {
	var actorUserID *uint
	if actorUserIDParam != nil {
		parsed := uint(*actorUserIDParam)
		actorUserID = &parsed
	} else if value := c.Query("actor_user_id"); value != "" {
		var parsed uint
		if _, err := fmt.Sscan(value, &parsed); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"message": "invalid actor_user_id"})
			return
		}
		actorUserID = &parsed
	}

	limit := 100
	if limitRaw != "" {
		if _, err := fmt.Sscan(limitRaw, &limit); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"message": "invalid limit"})
			return
		}
	} else if value := c.Query("limit"); value != "" {
		if _, err := fmt.Sscan(value, &limit); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"message": "invalid limit"})
			return
		}
	}

	if targetType == "" {
		targetType = c.Query("target_type")
	}

	logs, err := h.svc.ListLogs(actorUserID, targetType, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": err.Error()})
		return
	}

	c.JSON(http.StatusOK, logs)
}
