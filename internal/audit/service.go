package audit

import (
	"strings"

	"gorm.io/gorm"

	"github.com/saurlax/sauryctf/internal/models"
)

type Service struct {
	db *gorm.DB
}

type ServiceInterface interface {
	ListLogs(actorUserID *uint, targetType string, limit int) ([]models.AuditLog, error)
}

type LogEntry struct {
	ActorUserID   uint
	ActorUsername string
	Action        string
	TargetType    string
	TargetID      uint
	Summary       string
	Detail        string
}

func NewService(db *gorm.DB) *Service {
	return &Service{db: db}
}

func CreateLog(db *gorm.DB, entry LogEntry) error {
	log := models.AuditLog{
		ActorUserID:   entry.ActorUserID,
		ActorUsername: strings.TrimSpace(entry.ActorUsername),
		Action:        strings.TrimSpace(entry.Action),
		TargetType:    strings.TrimSpace(entry.TargetType),
		TargetID:      entry.TargetID,
		Summary:       strings.TrimSpace(entry.Summary),
		Detail:        strings.TrimSpace(entry.Detail),
	}

	return db.Create(&log).Error
}

func (s *Service) ListLogs(actorUserID *uint, targetType string, limit int) ([]models.AuditLog, error) {
	query := s.db.Model(&models.AuditLog{}).Order("created_at DESC, id DESC")

	if actorUserID != nil && *actorUserID > 0 {
		query = query.Where("actor_user_id = ?", *actorUserID)
	}

	targetType = strings.TrimSpace(targetType)
	if targetType != "" {
		query = query.Where("target_type = ?", targetType)
	}

	var logs []models.AuditLog
	if err := query.Limit(normalizeLimit(limit)).Find(&logs).Error; err != nil {
		return nil, err
	}

	return logs, nil
}

func normalizeLimit(limit int) int {
	if limit <= 0 {
		return 100
	}
	if limit > 200 {
		return 200
	}
	return limit
}
