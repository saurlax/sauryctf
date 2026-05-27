package http

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

type HealthzResponse struct {
	Status  string `json:"status"`
	Version string `json:"version"`
}

func HealthzHandler(c *gin.Context) {
	c.JSON(http.StatusOK, HealthzResponse{
		Status:  "ok",
		Version: "0.1.0",
	})
}
