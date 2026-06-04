package auth

import "github.com/saurlax/sauryctf/internal/models"

// ServiceInterface abstracts auth operations for testing and dependency injection.
type ServiceInterface interface {
	Register(username, email, password string) (*models.User, error)
	EnsureBootstrapAdmin() (*models.User, bool, error)
	BootstrapAdminAvailable() (bool, error)
	Login(username, password string) (string, *models.User, error)
	ValidateToken(token string) (*models.User, error)
	Logout(token string) error
	GetUserByID(id uint) (*models.User, error)
}
