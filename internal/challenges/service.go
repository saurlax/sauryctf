package challenges

import (
	"errors"
	"fmt"
	"time"

	"gorm.io/gorm"

	"github.com/saurlax/sauryctf/internal/audit"
	"github.com/saurlax/sauryctf/internal/models"
	"github.com/saurlax/sauryctf/internal/scoring"
)

type Service struct {
	db *gorm.DB
}

func NewService(db *gorm.DB) *Service {
	return &Service{db: db}
}

func (s *Service) CreateChallenge(req CreateChallengeRequest, createdBy uint) (*models.Challenge, error) {
	ch := &models.Challenge{
		Title:         req.Title,
		Description:   req.Description,
		Category:      models.ChallengeCategory(req.Category),
		Type:          models.ChallengeType(req.Type),
		Difficulty:    models.DifficultyLevel(req.Difficulty),
		Flag:          req.Flag,
		FlagFormat:    req.FlagFormat,
		BaseScore:     req.BaseScore,
		MinScore:      req.MinScore,
		DecayRate:     req.DecayRate,
		MaxAttempts:   req.MaxAttempts,
		Hints:         req.Hints,
		Attachments:   req.Attachments,
		ContainerSpec: req.ContainerSpec,
		CreatedBy:     createdBy,
	}

	// Apply defaults
	if ch.Type == "" {
		ch.Type = models.TypeStatic
	}
	if ch.Difficulty == "" {
		ch.Difficulty = models.DifficultyEasy
	}
	if ch.BaseScore == 0 {
		ch.BaseScore = 100
	}
	if ch.MinScore == 0 {
		ch.MinScore = 10
	}
	if ch.DecayRate == 0 {
		ch.DecayRate = 0.1
	}
	if req.IsVisible != nil {
		ch.IsVisible = *req.IsVisible
	} else {
		ch.IsVisible = true
	}

	if err := s.db.Select(
		"Title", "Description", "Category", "Type", "Difficulty",
		"Flag", "FlagFormat", "BaseScore", "MinScore", "DecayRate",
		"MaxAttempts", "Hints", "Attachments", "ContainerSpec",
		"IsVisible", "CreatedBy",
	).Create(ch).Error; err != nil {
		return nil, err
	}
	if err := s.writeAuditLog(createdBy, "admin.challenge.create", "challenge", ch.ID, fmt.Sprintf("创建题目 %s", ch.Title), fmt.Sprintf(`{"category":"%s","type":"%s"}`, ch.Category, ch.Type)); err != nil {
		return nil, err
	}
	return ch, nil
}

func (s *Service) GetChallenge(id uint) (*models.Challenge, error) {
	var ch models.Challenge
	if err := s.db.First(&ch, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errors.New("challenge not found")
		}
		return nil, err
	}
	return &ch, nil
}

func (s *Service) ListChallenges(category string, showHidden bool) ([]models.Challenge, error) {
	var challenges []models.Challenge
	q := s.db.Model(&models.Challenge{})
	if !showHidden {
		q = q.Where("is_visible = ?", true)
	}
	if category != "" {
		q = q.Where("category = ?", category)
	}
	if err := q.Order("id ASC").Find(&challenges).Error; err != nil {
		return nil, err
	}
	return challenges, nil
}

func (s *Service) UpdateChallenge(id uint, req UpdateChallengeRequest, updatedBy ...uint) (*models.Challenge, error) {
	ch, err := s.GetChallenge(id)
	if err != nil {
		return nil, err
	}

	updates := map[string]interface{}{}
	if req.Title != nil {
		updates["title"] = *req.Title
	}
	if req.Description != nil {
		updates["description"] = *req.Description
	}
	if req.Category != nil {
		updates["category"] = *req.Category
	}
	if req.Type != nil {
		updates["type"] = *req.Type
	}
	if req.Difficulty != nil {
		updates["difficulty"] = *req.Difficulty
	}
	if req.Flag != nil {
		updates["flag"] = *req.Flag
	}
	if req.FlagFormat != nil {
		updates["flag_format"] = *req.FlagFormat
	}
	if req.BaseScore != nil {
		updates["base_score"] = *req.BaseScore
	}
	if req.MinScore != nil {
		updates["min_score"] = *req.MinScore
	}
	if req.DecayRate != nil {
		updates["decay_rate"] = *req.DecayRate
	}
	if req.MaxAttempts != nil {
		updates["max_attempts"] = *req.MaxAttempts
	}
	if req.Hints != nil {
		updates["hints"] = *req.Hints
	}
	if req.Attachments != nil {
		updates["attachments"] = *req.Attachments
	}
	if req.ContainerSpec != nil {
		updates["container_spec"] = *req.ContainerSpec
	}
	if req.IsVisible != nil {
		updates["is_visible"] = *req.IsVisible
	}

	if len(updates) > 0 {
		if err := s.db.Model(ch).Updates(updates).Error; err != nil {
			return nil, err
		}
	}

	updated, err := s.GetChallenge(id)
	if err != nil {
		return nil, err
	}
	if actorUserID := firstActorID(updatedBy...); actorUserID > 0 {
		if err := s.writeAuditLog(actorUserID, "admin.challenge.update", "challenge", updated.ID, fmt.Sprintf("更新题目 %s", updated.Title), fmt.Sprintf(`{"category":"%s","type":"%s","visible":%t}`, updated.Category, updated.Type, updated.IsVisible)); err != nil {
			return nil, err
		}
	}

	return updated, nil
}

func (s *Service) DeleteChallenge(id uint, deletedBy ...uint) error {
	ch, err := s.GetChallenge(id)
	if err != nil {
		return err
	}

	result := s.db.Delete(&models.Challenge{}, id)
	if result.RowsAffected == 0 {
		return errors.New("challenge not found")
	}
	if result.Error != nil {
		return result.Error
	}

	if actorUserID := firstActorID(deletedBy...); actorUserID > 0 {
		return s.writeAuditLog(actorUserID, "admin.challenge.delete", "challenge", ch.ID, fmt.Sprintf("删除题目 %s", ch.Title), fmt.Sprintf(`{"category":"%s","type":"%s"}`, ch.Category, ch.Type))
	}

	return nil
}

func (s *Service) writeAuditLog(actorUserID uint, action string, targetType string, targetID uint, summary string, detail string) error {
	var actor models.User
	if err := s.db.Select("id", "username").First(&actor, actorUserID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		return err
	}

	return audit.CreateLog(s.db, audit.LogEntry{
		ActorUserID:   actor.ID,
		ActorUsername: actor.Username,
		Action:        action,
		TargetType:    targetType,
		TargetID:      targetID,
		Summary:       summary,
		Detail:        detail,
	})
}

func firstActorID(actorUserIDs ...uint) uint {
	if len(actorUserIDs) == 0 {
		return 0
	}
	return actorUserIDs[0]
}

func (s *Service) SubmitFlag(challengeID uint, gameID uint, userID uint, teamID uint, flag string) (*SubmitResult, error) {
	ch, err := s.GetChallenge(challengeID)
	if err != nil {
		return nil, err
	}

	// Check if already solved by this team in this game
	var existing models.Solve
	err = s.db.Where("challenge_id = ? AND team_id = ? AND game_id = ?",
		challengeID, teamID, gameID).First(&existing).Error
	if err == nil {
		return &SubmitResult{
			Correct: false,
			Message: "already solved by your team",
		}, nil
	}

	// Check flag
	if flag != ch.Flag {
		return &SubmitResult{
			Correct: false,
			Message: "wrong flag",
		}, nil
	}

	// Calculate score with shared dynamic scoring.
	solveCount := int64(0)
	s.db.Model(&models.Solve{}).Where("challenge_id = ? AND game_id = ?",
		challengeID, gameID).Count(&solveCount)

	bloodType := scoring.BloodType(int(solveCount))
	score := scoring.ComputeScore(*ch, int(solveCount))

	solve := &models.Solve{
		ChallengeID: challengeID,
		UserID:      userID,
		TeamID:      teamID,
		GameID:      gameID,
		Score:       score,
		BloodType:   bloodType,
		SolvedAt:    time.Now(),
	}

	if err := s.db.Create(solve).Error; err != nil {
		return nil, err
	}

	return &SubmitResult{
		Correct:   true,
		Score:     score,
		BloodType: bloodType,
		Message:   "correct",
	}, nil
}
