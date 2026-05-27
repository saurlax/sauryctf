package games

import (
	"errors"

	"gorm.io/gorm"

	"github.com/saurlax/sauryctf/internal/models"
)

type Service struct {
	db *gorm.DB
}

func NewService(db *gorm.DB) *Service {
	return &Service{db: db}
}

func (s *Service) CreateGame(req CreateGameRequest, createdBy uint) (*GameResponse, error) {
	game := &models.Game{
		Name:        req.Name,
		Description: req.Description,
		StartTime:   req.StartTime,
		EndTime:     req.EndTime,
		Status:      "draft",
		CreatedBy:   createdBy,
	}
	if req.IsPublic != nil {
		game.IsPublic = *req.IsPublic
	}

	if err := s.db.Select(
		"Name", "Description", "StartTime", "EndTime", "Status", "IsPublic", "CreatedBy",
	).Create(game).Error; err != nil {
		return nil, err
	}

	return toResponse(game), nil
}

func (s *Service) GetGame(id uint) (*GameResponse, error) {
	var game models.Game
	if err := s.db.First(&game, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errors.New("game not found")
		}
		return nil, err
	}
	return toResponse(&game), nil
}

func (s *Service) ListGames(showAll bool) ([]GameResponse, error) {
	var games []models.Game
	q := s.db.Model(&models.Game{})
	if !showAll {
		q = q.Where("is_public = ?", true)
	}
	if err := q.Order("start_time DESC").Find(&games).Error; err != nil {
		return nil, err
	}

	result := make([]GameResponse, len(games))
	for i, g := range games {
		result[i] = *toResponse(&g)
	}
	return result, nil
}

func (s *Service) UpdateGame(id uint, req UpdateGameRequest) (*GameResponse, error) {
	var game models.Game
	if err := s.db.First(&game, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errors.New("game not found")
		}
		return nil, err
	}

	updates := map[string]interface{}{}
	if req.Name != nil {
		updates["name"] = *req.Name
	}
	if req.Description != nil {
		updates["description"] = *req.Description
	}
	if req.StartTime != nil {
		updates["start_time"] = *req.StartTime
	}
	if req.EndTime != nil {
		updates["end_time"] = *req.EndTime
	}
	if req.Status != nil {
		updates["status"] = *req.Status
	}
	if req.IsPublic != nil {
		updates["is_public"] = *req.IsPublic
	}

	if len(updates) > 0 {
		if err := s.db.Model(&game).Updates(updates).Error; err != nil {
			return nil, err
		}
	}

	return s.GetGame(id)
}

func (s *Service) AddChallenge(gameID uint, challengeID uint, scoreOverride int) error {
	// Verify game exists
	var game models.Game
	if err := s.db.First(&game, gameID).Error; err != nil {
		return errors.New("game not found")
	}

	// Verify challenge exists
	var ch models.Challenge
	if err := s.db.First(&ch, challengeID).Error; err != nil {
		return errors.New("challenge not found")
	}

	gc := &models.GameChallenge{
		GameID:        gameID,
		ChallengeID:   challengeID,
		ScoreOverride: scoreOverride,
	}
	return s.db.Create(gc).Error
}

func (s *Service) RemoveChallenge(gameID uint, challengeID uint) error {
	result := s.db.Where("game_id = ? AND challenge_id = ?", gameID, challengeID).
		Delete(&models.GameChallenge{})
	if result.RowsAffected == 0 {
		return errors.New("challenge not in game")
	}
	return result.Error
}

func toResponse(g *models.Game) *GameResponse {
	return &GameResponse{
		ID:          g.ID,
		Name:        g.Name,
		Description: g.Description,
		StartTime:   g.StartTime,
		EndTime:     g.EndTime,
		Status:      g.Status,
		IsPublic:    g.IsPublic,
		CreatedBy:   g.CreatedBy,
		CreatedAt:   g.CreatedAt,
	}
}
