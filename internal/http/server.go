package http

import (
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"github.com/saurlax/sauryctf/internal/auth"
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

	// Protected routes
	api := engine.Group("/api")
	api.Use(rbac.AuthMiddleware(authSvc))

	// Teams
	teamsSvc := teams.NewService(db)
	teamsHandler := teams.NewHandler(teamsSvc)
	teamsHandler.RegisterRoutes(api)

	return engine
}
