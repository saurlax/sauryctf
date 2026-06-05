package auth

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"

	"github.com/saurlax/sauryctf/internal/models"
)

const (
	defaultAdminUsername = "admin"
	defaultAdminEmail    = "admin@sauryctf.local"
	defaultAdminPassword = "sauryctf"
)

type Service struct {
	db        *gorm.DB
	jwtSecret string
	tokenTTL  time.Duration
}

func NewService(db *gorm.DB, jwtSecret string) *Service {
	return &Service{
		db:        db,
		jwtSecret: jwtSecret,
		tokenTTL:  24 * time.Hour,
	}
}

func (s *Service) Register(username, email, password string) (*models.User, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return nil, err
	}

	user := &models.User{
		Username:     username,
		Email:        email,
		PasswordHash: string(hash),
		Role:         models.RoleUser,
		Status:       models.StatusActive,
	}

	if err := s.db.Create(user).Error; err != nil {
		return nil, err
	}
	return user, nil
}

func (s *Service) EnsureBootstrapAdmin() (*models.User, bool, error) {
	var count int64
	if err := s.db.Model(&models.User{}).Count(&count).Error; err != nil {
		return nil, false, err
	}
	if count > 0 {
		return nil, false, nil
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(defaultAdminPassword), bcrypt.DefaultCost)
	if err != nil {
		return nil, false, err
	}

	user := &models.User{
		Username:     defaultAdminUsername,
		Email:        defaultAdminEmail,
		PasswordHash: string(hash),
		Role:         models.RoleAdmin,
		Status:       models.StatusActive,
	}

	if err := s.db.Create(user).Error; err != nil {
		return nil, false, err
	}

	return user, true, nil
}

func (s *Service) BootstrapAdminAvailable() (bool, error) {
	var count int64
	if err := s.db.Model(&models.User{}).Count(&count).Error; err != nil {
		return false, err
	}

	return count == 0, nil
}

func (s *Service) Login(username, password string) (string, *models.User, error) {
	var user models.User
	if err := s.db.Where("username = ? OR email = ?", username, username).First(&user).Error; err != nil {
		return "", nil, errors.New("invalid credentials")
	}

	if user.Status == models.StatusBanned {
		return "", nil, errors.New("user is banned")
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(password)); err != nil {
		return "", nil, errors.New("invalid credentials")
	}

	token, err := s.generateToken(&user)
	if err != nil {
		return "", nil, err
	}

	// Store session
	session := &models.Session{
		UserID:    user.ID,
		Token:     token,
		ExpiresAt: time.Now().Add(s.tokenTTL),
	}
	if err := s.db.Create(session).Error; err != nil {
		return "", nil, err
	}

	return token, &user, nil
}

func (s *Service) ValidateToken(tokenStr string) (*models.User, error) {
	token, err := jwt.Parse(tokenStr, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, errors.New("unexpected signing method")
		}
		return []byte(s.jwtSecret), nil
	})
	if err != nil {
		return nil, err
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok || !token.Valid {
		return nil, errors.New("invalid token")
	}

	// Check session exists
	var session models.Session
	if err := s.db.Where("token = ?", tokenStr).First(&session).Error; err != nil {
		return nil, errors.New("session not found")
	}

	userIDFloat, ok := claims["user_id"].(float64)
	if !ok {
		return nil, errors.New("invalid token claims")
	}

	var user models.User
	if err := s.db.First(&user, uint(userIDFloat)).Error; err != nil {
		return nil, err
	}

	return &user, nil
}

func (s *Service) Logout(tokenStr string) error {
	return s.db.Where("token = ?", tokenStr).Delete(&models.Session{}).Error
}

func (s *Service) GetUserByID(id uint) (*models.User, error) {
	var user models.User
	if err := s.db.First(&user, id).Error; err != nil {
		return nil, err
	}
	return &user, nil
}

func (s *Service) ChangePassword(userID uint, currentPassword, newPassword string) error {
	var user models.User
	if err := s.db.First(&user, userID).Error; err != nil {
		return err
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(currentPassword)); err != nil {
		return errors.New("current password is incorrect")
	}

	if currentPassword == newPassword {
		return errors.New("new password must be different from current password")
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcrypt.DefaultCost)
	if err != nil {
		return err
	}

	return s.db.Model(&models.User{}).
		Where("id = ?", userID).
		Update("password_hash", string(hash)).Error
}

func (s *Service) IsUsingBootstrapPassword(userID uint) (bool, error) {
	var user models.User
	if err := s.db.First(&user, userID).Error; err != nil {
		return false, err
	}

	if user.Username != defaultAdminUsername || user.Role != models.RoleAdmin {
		return false, nil
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(defaultAdminPassword)); err != nil {
		return false, nil
	}

	return true, nil
}

func (s *Service) generateToken(user *models.User) (string, error) {
	jti, err := newTokenID()
	if err != nil {
		return "", err
	}

	claims := jwt.MapClaims{
		"user_id":  user.ID,
		"username": user.Username,
		"role":     user.Role,
		"jti":      jti,
		"iat":      time.Now().Unix(),
		"exp":      time.Now().Add(s.tokenTTL).Unix(),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(s.jwtSecret))
}

func newTokenID() (string, error) {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}
