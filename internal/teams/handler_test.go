package teams

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"

	"github.com/saurlax/sauryctf/internal/models"
)

func setupTeamsRouter(mock *MockService) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	// 模拟认证中间件：从 X-Test-User-ID header 读取用户 ID
	r.Use(func(c *gin.Context) {
		uid := c.GetHeader("X-Test-User-ID")
		if uid == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "no user"})
			return
		}
		var id uint
		fmt.Sscan(uid, &id)
		c.Set("user_id", id)
		c.Next()
	})
	h := NewHandler(mock)
	// 直接注册路由（对齐 oapi-codegen 生成的路由结构）
	api := r.Group("/api")
	api.POST("/teams", h.CreateTeam)
	api.GET("/teams/my", h.GetMyTeam)
	api.POST("/teams/join", h.JoinTeam)
	api.POST("/teams/leave", h.LeaveTeam)
	api.POST("/teams/:teamId/transfer", func(c *gin.Context) {
		var teamId int
		fmt.Sscan(c.Param("teamId"), &teamId)
		h.TransferTeamCaptain(c, teamId)
	})
	api.DELETE("/teams/:teamId/members/:memberId", func(c *gin.Context) {
		var teamId, memberId int
		fmt.Sscan(c.Param("teamId"), &teamId)
		fmt.Sscan(c.Param("memberId"), &memberId)
		h.RemoveTeamMember(c, teamId, memberId)
	})
	return r
}

func TestHandler_CreateTeam(t *testing.T) {
	mock := NewMockService()
	r := setupTeamsRouter(mock)

	t.Run("success", func(t *testing.T) {
		body := `{"name":"AlphaTeam"}`
		req := httptest.NewRequest("POST", "/api/teams", bytes.NewBufferString(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Test-User-ID", "1")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusCreated, w.Code)
		var resp map[string]interface{}
		json.Unmarshal(w.Body.Bytes(), &resp)
		assert.NotNil(t, resp["team"])
	})

	t.Run("bad request", func(t *testing.T) {
		body := `{"name":""}`
		req := httptest.NewRequest("POST", "/api/teams", bytes.NewBufferString(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Test-User-ID", "2")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusBadRequest, w.Code)
	})
}

func TestHandler_JoinTeam(t *testing.T) {
	mock := NewMockService()
	// Pre-create a team
	mock.Teams[1] = &models.Team{ID: 1, Name: "Alpha", InviteCode: "INVITE", CaptainID: 1, Status: models.TeamStatusActive}
	mock.Members[1] = map[uint]bool{1: true}
	r := setupTeamsRouter(mock)

	t.Run("success", func(t *testing.T) {
		body := `{"invite_code":"INVITE"}`
		req := httptest.NewRequest("POST", "/api/teams/join", bytes.NewBufferString(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Test-User-ID", "2")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusOK, w.Code)
	})

	t.Run("bad request", func(t *testing.T) {
		body := `{}`
		req := httptest.NewRequest("POST", "/api/teams/join", bytes.NewBufferString(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Test-User-ID", "3")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusBadRequest, w.Code)
	})
}

func TestHandler_GetMyTeam(t *testing.T) {
	mock := NewMockService()
	mock.Teams[1] = &models.Team{ID: 1, Name: "Alpha", InviteCode: "INVITE", CaptainID: 1, Status: models.TeamStatusActive}
	mock.Members[1] = map[uint]bool{1: true}
	r := setupTeamsRouter(mock)

	t.Run("has team", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/api/teams/my", nil)
		req.Header.Set("X-Test-User-ID", "1")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusOK, w.Code)
		var resp map[string]interface{}
		json.Unmarshal(w.Body.Bytes(), &resp)
		assert.NotNil(t, resp["team"])
	})

	t.Run("no team", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/api/teams/my", nil)
		req.Header.Set("X-Test-User-ID", "99")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusNotFound, w.Code)
	})
}

func TestHandler_LeaveTeam(t *testing.T) {
	mock := NewMockService()
	mock.Teams[1] = &models.Team{ID: 1, Name: "Alpha", InviteCode: "INVITE", CaptainID: 1, Status: models.TeamStatusActive}
	mock.Members[1] = map[uint]bool{1: true, 2: true}
	r := setupTeamsRouter(mock)

	t.Run("member leaves", func(t *testing.T) {
		req := httptest.NewRequest("POST", "/api/teams/leave", nil)
		req.Header.Set("X-Test-User-ID", "2")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusOK, w.Code)
	})
}

func TestHandler_TransferCaptain(t *testing.T) {
	mock := NewMockService()
	mock.Teams[1] = &models.Team{ID: 1, Name: "Alpha", InviteCode: "INVITE", CaptainID: 1, Status: models.TeamStatusActive}
	mock.Members[1] = map[uint]bool{1: true, 2: true}
	r := setupTeamsRouter(mock)

	t.Run("success", func(t *testing.T) {
		body := `{"target_user_id":2}`
		req := httptest.NewRequest("POST", "/api/teams/1/transfer", bytes.NewBufferString(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Test-User-ID", "1")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusOK, w.Code)
		assert.Equal(t, uint(2), mock.Teams[1].CaptainID)
	})

	t.Run("bad request", func(t *testing.T) {
		body := `{}`
		req := httptest.NewRequest("POST", "/api/teams/1/transfer", bytes.NewBufferString(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Test-User-ID", "2")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusBadRequest, w.Code)
	})
}
