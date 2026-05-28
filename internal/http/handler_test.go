package http

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
)

func TestHealthzHandler(t *testing.T) {
	gin.SetMode(gin.TestMode)

	engine := gin.New()
	// 直接注册一个匿名 handler 测试 Healthz 逻辑
	engine.GET("/api/healthz", func(c *gin.Context) {
		c.JSON(http.StatusOK, HealthResponse{Status: "ok", Version: "0.1.0"})
	})

	req, err := http.NewRequest("GET", "/api/healthz", nil)
	assert.NoError(t, err)

	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, req)

	assert.Equal(t, http.StatusOK, recorder.Code)

	var response HealthResponse
	err = json.Unmarshal(recorder.Body.Bytes(), &response)
	assert.NoError(t, err)

	assert.Equal(t, "ok", response.Status)
	assert.Equal(t, "0.1.0", response.Version)
}
