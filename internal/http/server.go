package http

import (
	"fmt"
	"net/http"

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
	engine.StaticFS("/attachments", http.Dir("./attachments"))

	// 初始化各模块服务和 handler
	authSvc := auth.NewService(db, jwtSecret)
	handler := NewHandler(
		auth.NewHandler(authSvc),
		teams.NewHandler(teams.NewService(db)),
		challenges.NewHandler(challenges.NewService(db)),
		games.NewHandler(games.NewService(db)),
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
	admin.GET("/games/:id/submissions", func(c *gin.Context) {
		handler.games.ListSubmissionRecords(c, mustIntParam(c, "id"))
	})

	return engine
}

func mustIntParam(c *gin.Context, key string) int {
	var value int
	_, _ = fmt.Sscan(c.Param(key), &value)
	return value
}
