package rbac

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/saurlax/sauryctf/internal/auth"
	"github.com/saurlax/sauryctf/internal/models"
)

func AuthMiddleware(authSvc auth.ServiceInterface) gin.HandlerFunc {
	return func(c *gin.Context) {
		token, err := c.Cookie("token")
		if err != nil || token == "" {
			// 回退到 Authorization header
			header := c.GetHeader("Authorization")
			if strings.HasPrefix(header, "Bearer ") {
				token = header[7:]
			}
		}

		if token == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "missing token"})
			return
		}

		user, err := authSvc.ValidateToken(token)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid token"})
			return
		}

		c.Set("user_id", user.ID)
		c.Set("user_role", string(user.Role))
		c.Set("user", user)
		c.Next()
	}
}

func OptionalAuthMiddleware(authSvc auth.ServiceInterface) gin.HandlerFunc {
	return func(c *gin.Context) {
		token, err := c.Cookie("token")
		if err != nil || token == "" {
			header := c.GetHeader("Authorization")
			if strings.HasPrefix(header, "Bearer ") {
				token = header[7:]
			}
		}

		if token == "" {
			c.Next()
			return
		}

		user, err := authSvc.ValidateToken(token)
		if err == nil {
			c.Set("user_id", user.ID)
			c.Set("user_role", string(user.Role))
			c.Set("user", user)
		}

		c.Next()
	}
}

func RequireRole(roles ...models.UserRole) gin.HandlerFunc {
	return func(c *gin.Context) {
		roleVal, exists := c.Get("user_role")
		if !exists {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "not authenticated"})
			return
		}

		role := models.UserRole(roleVal.(string))
		for _, allowed := range roles {
			if role == allowed {
				c.Next()
				return
			}
		}

		c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "insufficient permissions"})
	}
}
