package http

import (
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"github.com/saurlax/sauryctf/internal/auth"
	"github.com/saurlax/sauryctf/internal/challenges"
	"github.com/saurlax/sauryctf/internal/games"
	"github.com/saurlax/sauryctf/internal/models"
	"github.com/saurlax/sauryctf/internal/rbac"
	"github.com/saurlax/sauryctf/internal/teams"
)

func NewServer(db *gorm.DB, jwtSecret string) *gin.Engine {
	engine := gin.New()

	engine.Use(gin.Logger())
	engine.Use(gin.Recovery())

	// Health check
	engine.GET("/api/healthz", HealthzHandler)

	// Auth (public)
	authSvc := auth.NewService(db, jwtSecret)
	authHandler := auth.NewHandler(authSvc)
	authHandler.RegisterRoutes(engine.Group("/api"))

	// Protected routes (any authenticated user)
	api := engine.Group("/api")
	api.Use(rbac.AuthMiddleware(authSvc))

	// Admin routes (admin + super_admin only)
	adminAPI := engine.Group("/api")
	adminAPI.Use(rbac.AuthMiddleware(authSvc))
	adminAPI.Use(rbac.RequireRole(models.RoleAdmin, models.RoleSuperAdmin))

	// Teams
	teamsSvc := teams.NewService(db)
	teamsHandler := teams.NewHandler(teamsSvc)
	teamsHandler.RegisterRoutes(api)

	// Challenges
	challengesSvc := challenges.NewService(db)
	challengesHandler := challenges.NewHandler(challengesSvc)
	challengesHandler.RegisterRoutes(api, adminAPI)

	// Games
	gamesSvc := games.NewService(db)
	gamesHandler := games.NewHandler(gamesSvc)
	gamesHandler.RegisterRoutes(api, adminAPI)

	return engine
}
