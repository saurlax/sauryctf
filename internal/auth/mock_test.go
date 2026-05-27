package auth

import (
	"github.com/stretchr/testify/assert"

	"github.com/saurlax/sauryctf/internal/models"
)

// Compile-time check: MockService implements ServiceInterface.
var _ ServiceInterface = (*MockService)(nil)

// MockService is a fake implementation of ServiceInterface for handler tests.
type MockService struct {
	Users    map[string]*models.User // keyed by email
	Tokens   map[string]*models.User // keyed by token
	NextID   uint
	FailWith error // if set, all methods return this error
}

func NewMockService() *MockService {
	return &MockService{
		Users:  make(map[string]*models.User),
		Tokens: make(map[string]*models.User),
		NextID: 1,
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
	return user, nil
}

func (m *MockService) Login(email, password string) (string, *models.User, error) {
	if m.FailWith != nil {
		return "", nil, m.FailWith
	}
	user, ok := m.Users[email]
	if !ok {
		return "", nil, assert.AnError
	}
	token := "mock-token-" + email
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
