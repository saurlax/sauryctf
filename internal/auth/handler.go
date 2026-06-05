package auth

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

type Handler struct {
	svc ServiceInterface
}

func NewHandler(svc ServiceInterface) *Handler {
	return &Handler{svc: svc}
}

type RegisterRequest struct {
	Username string `json:"username" binding:"required,min=3,max=64"`
	Email    string `json:"email" binding:"required,email"`
	Password string `json:"password" binding:"required,min=6"`
}

type LoginRequest struct {
	Username string `json:"username" binding:"required"`
	Password string `json:"password" binding:"required"`
}

type ChangePasswordRequest struct {
	CurrentPassword string `json:"current_password" binding:"required,min=6"`
	NewPassword     string `json:"new_password" binding:"required,min=6"`
}

type AuthResponse struct {
	Token string    `json:"token"`
	User  *UserInfo `json:"user"`
}

type UserInfo struct {
	ID       uint   `json:"id"`
	Username string `json:"username"`
	Email    string `json:"email"`
	Role     string `json:"role"`
	Status   string `json:"status"`
}

type AuthSetupStatusResponse struct {
	BootstrapAdminAvailable   bool   `json:"bootstrap_admin_available"`
	DefaultAdminUsername      string `json:"default_admin_username,omitempty"`
	DefaultAdminPassword      string `json:"default_admin_password,omitempty"`
	PasswordChangeRecommended bool   `json:"password_change_recommended,omitempty"`
}

type ErrorResponse struct {
	Message string `json:"message"`
}

// Register godoc
// @Summary      Register a new user
// @Tags         auth
// @Accept       json
// @Produce      json
// @Param        body  body      RegisterRequest  true  "Registration info"
// @Success      201   {object}  AuthResponse
// @Failure      400   {object}  ErrorResponse
// @Failure      409   {object}  ErrorResponse
// @Router       /auth/register [post]
func (h *Handler) Register(c *gin.Context) {
	var req RegisterRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		return
	}

	user, err := h.svc.Register(req.Username, req.Email, req.Password)
	if err != nil {
		c.JSON(http.StatusConflict, gin.H{"message": err.Error()})
		return
	}

	// Auto-login after registration
	token, _, err := h.svc.Login(req.Username, req.Password)
	if err != nil {
		// Registration succeeded but auto-login failed; still return user
		c.JSON(http.StatusCreated, gin.H{"user": user})
		return
	}

	setAuthCookie(c, token)
	c.JSON(http.StatusCreated, gin.H{"user": user})
}

// Login godoc
// @Summary      Login with username or email
// @Tags         auth
// @Accept       json
// @Produce      json
// @Param        body  body      LoginRequest  true  "Login credentials"
// @Success      200   {object}  AuthResponse
// @Failure      400   {object}  ErrorResponse
// @Failure      401   {object}  ErrorResponse
// @Router       /auth/login [post]
func (h *Handler) Login(c *gin.Context) {
	var req LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		return
	}

	token, user, err := h.svc.Login(req.Username, req.Password)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"message": err.Error()})
		return
	}

	setAuthCookie(c, token)
	c.JSON(http.StatusOK, gin.H{"user": user})
}

// Logout godoc
// @Summary      Logout (invalidate session)
// @Tags         auth
// @Security     BearerAuth
// @Produce      json
// @Success      200  {object}  map[string]string
// @Failure      400  {object}  ErrorResponse
// @Router       /auth/logout [post]
func (h *Handler) Logout(c *gin.Context) {
	token, err := c.Cookie("token")
	if err != nil || token == "" {
		c.JSON(http.StatusBadRequest, gin.H{"message": "missing token cookie"})
		return
	}

	if err := h.svc.Logout(token); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "failed to logout"})
		return
	}

	clearAuthCookie(c)
	c.JSON(http.StatusOK, gin.H{"message": "logged out"})
}

// Me godoc
// @Summary      Get current user info
// @Tags         auth
// @Security     BearerAuth
// @Produce      json
// @Success      200  {object}  map[string]UserInfo
// @Failure      401  {object}  ErrorResponse
// @Failure      404  {object}  ErrorResponse
// @Router       /auth/me [get]
func (h *Handler) GetMe(c *gin.Context) {
	userID := c.MustGet("user_id").(uint)

	user, err := h.svc.GetUserByID(userID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"message": "user not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"user": user})
}

func (h *Handler) SetupStatus(c *gin.Context) {
	available, err := h.svc.BootstrapAdminAvailable()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": err.Error()})
		return
	}

	resp := AuthSetupStatusResponse{
		BootstrapAdminAvailable: available,
	}
	if available {
		resp.DefaultAdminUsername = defaultAdminUsername
		resp.DefaultAdminPassword = defaultAdminPassword
	}
	if userIDValue, exists := c.Get("user_id"); exists {
		if userID, ok := userIDValue.(uint); ok {
			recommended, err := h.svc.IsUsingBootstrapPassword(userID)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"message": err.Error()})
				return
			}
			resp.PasswordChangeRecommended = recommended
		}
	}

	c.JSON(http.StatusOK, resp)
}

func (h *Handler) ChangePassword(c *gin.Context) {
	var req ChangePasswordRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		return
	}

	userID := c.MustGet("user_id").(uint)

	if err := h.svc.ChangePassword(userID, req.CurrentPassword, req.NewPassword); err != nil {
		c.JSON(http.StatusConflict, gin.H{"message": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "password updated"})
}

func (h *Handler) RegisterRoutes(rg *gin.RouterGroup) {
	auth := rg.Group("/auth")
	{
		auth.GET("/setup-status", h.SetupStatus)
		auth.POST("/register", h.Register)
		auth.POST("/login", h.Login)
		auth.POST("/logout", h.Logout)
		auth.GET("/me", h.GetMe)
		auth.POST("/change-password", h.ChangePassword)
	}
}

// setAuthCookie sets the JWT token as an HttpOnly cookie.
func setAuthCookie(c *gin.Context, token string) {
	c.SetCookie("token", token, 86400, "/", "", false, true)
}

// clearAuthCookie clears the auth cookie.
func clearAuthCookie(c *gin.Context) {
	c.SetCookie("token", "", -1, "/", "", false, true)
}
