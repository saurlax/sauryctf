package auth

import (
	"github.com/stretchr/testify/assert"

	"github.com/saurlax/sauryctf/internal/models"
)

// Compile-time check: MockService implements ServiceInterface.
var _ ServiceInterface = (*MockService)(nil)

// MockService is a fake implementation of ServiceInterface for handler tests.
type MockService struct {
	Users                    map[string]*models.User // keyed by email
	Tokens                   map[string]*models.User // keyed by token
	Passwords                map[uint]string
	BootstrapPasswordInUseBy map[uint]bool
	NextID                   uint
	FailWith                 error // if set, all methods return this error
}

func NewMockService() *MockService {
	return &MockService{
		Users:                    make(map[string]*models.User),
		Tokens:                   make(map[string]*models.User),
		Passwords:                make(map[uint]string),
		BootstrapPasswordInUseBy: make(map[uint]bool),
		NextID:                   1,
	}
}

func (m *MockService) Register(username, email, password string) (*models.User, error) {
	if m.FailWith != nil {
		return nil, m.FailWith
	}
	if _, exists := m.Users[email]; exists {
		return nil, assert.AnError
	}
	user := &models.User{
		ID:       m.NextID,
		Username: username,
		Email:    email,
		Role:     models.RoleUser,
		Status:   models.StatusActive,
	}
	m.NextID++
	m.Users[email] = user
	m.Passwords[user.ID] = password
	return user, nil
}

func (m *MockService) EnsureBootstrapAdmin() (*models.User, bool, error) {
	if m.FailWith != nil {
		return nil, false, m.FailWith
	}
	for _, user := range m.Users {
		_ = user
		return nil, false, nil
	}
	user := &models.User{
		ID:       m.NextID,
		Username: defaultAdminUsername,
		Email:    defaultAdminEmail,
		Role:     models.RoleAdmin,
		Status:   models.StatusActive,
	}
	m.NextID++
	m.Users[user.Email] = user
	m.Passwords[user.ID] = defaultAdminPassword
	m.BootstrapPasswordInUseBy[user.ID] = true
	return user, true, nil
}

func (m *MockService) BootstrapAdminAvailable() (bool, error) {
	if m.FailWith != nil {
		return false, m.FailWith
	}

	return len(m.Users) == 0, nil
}

func (m *MockService) Login(username, password string) (string, *models.User, error) {
	if m.FailWith != nil {
		return "", nil, m.FailWith
	}
	// Search by username or email
	var user *models.User
	for _, u := range m.Users {
		if u.Username == username || u.Email == username {
			user = u
			break
		}
	}
	if user == nil {
		return "", nil, assert.AnError
	}
	if expectedPassword, ok := m.Passwords[user.ID]; ok && expectedPassword != password {
		return "", nil, assert.AnError
	}
	token := "mock-token-" + user.Username
	m.Tokens[token] = user
	return token, user, nil
}

func (m *MockService) ValidateToken(token string) (*models.User, error) {
	if m.FailWith != nil {
		return nil, m.FailWith
	}
	user, ok := m.Tokens[token]
	if !ok {
		return nil, assert.AnError
	}
	return user, nil
}

func (m *MockService) Logout(token string) error {
	if m.FailWith != nil {
		return m.FailWith
	}
	delete(m.Tokens, token)
	return nil
}

func (m *MockService) GetUserByID(id uint) (*models.User, error) {
	if m.FailWith != nil {
		return nil, m.FailWith
	}
	for _, u := range m.Users {
		if u.ID == id {
			return u, nil
		}
	}
	return nil, assert.AnError
}

func (m *MockService) ChangePassword(userID uint, currentPassword, newPassword string) error {
	if m.FailWith != nil {
		return m.FailWith
	}
	if expectedPassword, ok := m.Passwords[userID]; ok {
		if expectedPassword != currentPassword {
			return assert.AnError
		}
		if currentPassword == newPassword {
			return assert.AnError
		}
	}
	m.Passwords[userID] = newPassword
	delete(m.BootstrapPasswordInUseBy, userID)
	return nil
}

func (m *MockService) IsUsingBootstrapPassword(userID uint) (bool, error) {
	if m.FailWith != nil {
		return false, m.FailWith
	}
	return m.BootstrapPasswordInUseBy[userID], nil
}

func (m *MockService) ListUsers() ([]models.User, error) {
	if m.FailWith != nil {
		return nil, m.FailWith
	}
	users := make([]models.User, 0, len(m.Users))
	for _, user := range m.Users {
		users = append(users, *user)
	}
	return users, nil
}

func (m *MockService) UpdateUserAccount(targetUserID, requesterID uint, role models.UserRole, status models.UserStatus) (*models.User, error) {
	if m.FailWith != nil {
		return nil, m.FailWith
	}

	var requester *models.User
	var target *models.User
	for _, user := range m.Users {
		if user.ID == requesterID {
			requester = user
		}
		if user.ID == targetUserID {
			target = user
		}
	}
	if requester == nil || target == nil {
		return nil, assert.AnError
	}
	if requester.ID == target.ID && status == models.StatusBanned {
		return nil, assert.AnError
	}
	if requester.Role != models.RoleSuperAdmin {
		if target.Role == models.RoleSuperAdmin || role == models.RoleSuperAdmin {
			return nil, assert.AnError
		}
	}

	target.Role = role
	target.Status = status
	return target, nil
}
