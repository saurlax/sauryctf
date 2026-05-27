package teams

import (
	"bytes"
	"encoding/json"
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
	h := NewHandler(mock)
	// Simulate auth middleware: set user_id from query param
	api := r.Group("/api")
	api.Use(func(c *gin.Context) {
		uid := c.GetHeader("X-Test-User-ID")
		if uid == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "no user"})
			return
		}
		var id uint
		json.Unmarshal([]byte(uid), &id)
		c.Set("user_id", id)
		c.Next()
	})
	h.RegisterRoutes(api)
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
