package http

import (
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"github.com/saurlax/sauryctf/internal/auth"
	"github.com/saurlax/sauryctf/internal/challenges"
	"github.com/saurlax/sauryctf/internal/config"
	"github.com/saurlax/sauryctf/internal/games"
	"github.com/saurlax/sauryctf/internal/models"
	"github.com/saurlax/sauryctf/internal/rbac"
	"github.com/saurlax/sauryctf/internal/teams"
)

func NewServer(db *gorm.DB, cfg *config.Config) *gin.Engine {
	engine := gin.New()
	engine.Use(gin.Logger())
	engine.Use(gin.Recovery())
	engine.StaticFS("/attachments", http.Dir("./attachments"))

	// 初始化各模块服务和 handler
	authSvc := auth.NewService(db, cfg.JWTSecret)
	gameSvc := games.NewServiceWithOptions(db, instanceProvidersFromConfig(cfg), games.InstancePolicy{
		LeaseDuration:     cfg.InstanceLeaseDuration,
		ExtensionDuration: cfg.InstanceExtensionDuration,
		RenewalWindow:     cfg.InstanceRenewalWindow,
		TeamActiveLimit:   cfg.InstanceTeamActiveLimit,
	})
	handler := NewHandler(
		auth.NewHandler(authSvc),
		teams.NewHandler(teams.NewService(db)),
		challenges.NewHandler(challenges.NewService(db)),
		games.NewHandler(gameSvc),
	)

	// 使用 oapi-codegen 生成的 RegisterHandlersWithOptions 注册路由，
	// 通过 Middlewares 注入认证中间件（对设置了 BearerAuth scope 的路由生效）。
	RegisterHandlersWithOptions(engine, handler, GinServerOptions{
		Middlewares: []MiddlewareFunc{
			// 公开路由尝试识别登录态，受保护路由仍然要求严格认证。
			func(c *gin.Context) {
				if _, exists := c.Get(string(BearerAuthScopes)); exists {
					rbac.AuthMiddleware(authSvc)(c)
					return
				}

				rbac.OptionalAuthMiddleware(authSvc)(c)
			},
		},
	})

	admin := engine.Group("/api/admin")
	admin.Use(rbac.AuthMiddleware(authSvc), rbac.RequireRole(models.RoleAdmin, models.RoleSuperAdmin))
	admin.POST("/games/:id/scoreboard/export", func(c *gin.Context) {
		handler.games.ExportScoreboardPackage(c, mustIntParam(c, "id"))
	})
	admin.POST("/games/:id/writeups/export", func(c *gin.Context) {
		handler.games.ExportWriteupsPackage(c, mustIntParam(c, "id"))
	})
	admin.POST("/games/:id/submissions/export", func(c *gin.Context) {
		handler.games.ExportSubmissionsPackage(c, mustIntParam(c, "id"))
	})
	admin.GET("/games/:id/announcements", func(c *gin.Context) {
		handler.games.ListAnnouncements(c, mustIntParam(c, "id"))
	})
	admin.POST("/games/:id/announcements", func(c *gin.Context) {
		handler.games.CreateAnnouncement(c, mustIntParam(c, "id"))
	})
	admin.DELETE("/games/:id/announcements/:announcementId", func(c *gin.Context) {
		handler.games.DeleteAnnouncement(c, mustIntParam(c, "id"), mustIntParam(c, "announcementId"))
	})
	admin.GET("/games/:id/submissions", func(c *gin.Context) {
		handler.games.ListSubmissionRecords(c, mustIntParam(c, "id"))
	})
	admin.GET("/games/:id/cheat-clues", func(c *gin.Context) {
		handler.games.ListSubmissionCheatClues(c, mustIntParam(c, "id"))
	})
	admin.GET("/dashboard/summary", func(c *gin.Context) {
		handler.games.GetAdminDashboardSummary(c)
	})

	teamRoutes := engine.Group("/api/teams")
	teamRoutes.Use(rbac.AuthMiddleware(authSvc))
	teamRoutes.POST("/:teamId/transfer", func(c *gin.Context) {
		handler.TransferTeamCaptain(c, mustIntParam(c, "teamId"))
	})
	teamRoutes.POST("/:teamId/invite-code/reset", func(c *gin.Context) {
		handler.ResetTeamInviteCode(c, mustIntParam(c, "teamId"))
	})

	engine.GET("/api/games/:id/announcements", func(c *gin.Context) {
		id := mustIntParam(c, "id")
		if _, err := gameSvc.GetPublicGame(uint(id)); err != nil {
			if err.Error() == "game not found" {
				c.JSON(http.StatusNotFound, gin.H{"message": err.Error()})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"message": err.Error()})
			return
		}
		handler.games.ListAnnouncements(c, id)
	})

	return engine
}

func CleanupExpiredChallengeInstances(db *gorm.DB, cfg *config.Config, now time.Time) (int, error) {
	gameSvc := games.NewServiceWithOptions(db, instanceProvidersFromConfig(cfg), games.InstancePolicy{
		LeaseDuration:     cfg.InstanceLeaseDuration,
		ExtensionDuration: cfg.InstanceExtensionDuration,
		RenewalWindow:     cfg.InstanceRenewalWindow,
		TeamActiveLimit:   cfg.InstanceTeamActiveLimit,
	})
	return gameSvc.CleanupExpiredChallengeInstances(now)
}

func instanceProvidersFromConfig(cfg *config.Config) map[string]games.ChallengeInstanceProvider {
	if cfg == nil || !cfg.InstanceDockerEnabled {
		return nil
	}

	return map[string]games.ChallengeInstanceProvider{
		"docker": games.NewDockerCLIProvider(cfg.InstanceDockerHost),
	}
}

func mustIntParam(c *gin.Context, key string) int {
	var value int
	_, _ = fmt.Sscan(c.Param(key), &value)
	return value
}
