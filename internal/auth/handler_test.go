package auth

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

func setupAuthRouter(mock *MockService) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	h := NewHandler(mock)

	api := r.Group("/api")
	// Public routes
	api.POST("/auth/register", h.Register)
	api.POST("/auth/login", h.Login)

	// Protected routes (simulate auth middleware)
	protected := api.Group("")
	protected.Use(func(c *gin.Context) {
		token := c.GetHeader("Authorization")
		if len(token) > 7 && token[:7] == "Bearer " {
			token = token[7:]
		}
		user, err := mock.ValidateToken(token)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid token"})
			return
		}
		c.Set("user_id", user.ID)
		c.Set("user_role", string(user.Role))
		c.Next()
	})
	protected.POST("/auth/logout", h.Logout)
	protected.GET("/auth/me", h.Me)

	return r
}

func TestHandler_Register(t *testing.T) {
	mock := NewMockService()
	r := setupAuthRouter(mock)

	t.Run("success", func(t *testing.T) {
		body := `{"username":"alice","email":"alice@test.com","password":"123456"}`
		req := httptest.NewRequest("POST", "/api/auth/register", bytes.NewBufferString(body))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusCreated, w.Code)
		var resp map[string]interface{}
		json.Unmarshal(w.Body.Bytes(), &resp)
		assert.NotNil(t, resp["user"])
	})

	t.Run("bad request", func(t *testing.T) {
		body := `{"username":"a"}`
		req := httptest.NewRequest("POST", "/api/auth/register", bytes.NewBufferString(body))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusBadRequest, w.Code)
	})

	t.Run("duplicate", func(t *testing.T) {
		body := `{"username":"alice","email":"alice@test.com","password":"123456"}`
		req := httptest.NewRequest("POST", "/api/auth/register", bytes.NewBufferString(body))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusConflict, w.Code)
	})
}

func TestHandler_Login(t *testing.T) {
	mock := NewMockService()
	mock.Users["alice@test.com"] = &models.User{ID: 1, Username: "alice", Email: "alice@test.com", Role: models.RoleUser, Status: models.StatusActive}
	r := setupAuthRouter(mock)

	t.Run("success", func(t *testing.T) {
		body := `{"email":"alice@test.com","password":"123456"}`
		req := httptest.NewRequest("POST", "/api/auth/login", bytes.NewBufferString(body))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusOK, w.Code)
		var resp map[string]interface{}
		json.Unmarshal(w.Body.Bytes(), &resp)
		assert.NotEmpty(t, resp["token"])
	})

	t.Run("bad request", func(t *testing.T) {
		body := `{"email":"bad"}`
		req := httptest.NewRequest("POST", "/api/auth/login", bytes.NewBufferString(body))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusBadRequest, w.Code)
	})

	t.Run("wrong credentials", func(t *testing.T) {
		body := `{"email":"nobody@test.com","password":"123456"}`
		req := httptest.NewRequest("POST", "/api/auth/login", bytes.NewBufferString(body))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusUnauthorized, w.Code)
	})
}

func TestHandler_Me(t *testing.T) {
	mock := NewMockService()
	user := &models.User{ID: 1, Username: "alice", Email: "alice@test.com", Role: models.RoleUser, Status: models.StatusActive}
	mock.Users["alice@test.com"] = user
	token := "mock-token-alice@test.com"
	mock.Tokens[token] = user
	r := setupAuthRouter(mock)

	t.Run("success", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/api/auth/me", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusOK, w.Code)
	})

	t.Run("no token", func(t *testing.T) {
		// Me requires auth middleware, which won't be set without it
		// Just test without Authorization header — handler checks c.Get("user_id")
		req := httptest.NewRequest("GET", "/api/auth/me", nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusUnauthorized, w.Code)
	})
}
