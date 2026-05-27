package games

import "time"

// ServiceInterface defines the game management contract.
type ServiceInterface interface {
	CreateGame(req CreateGameRequest, createdBy uint) (*GameResponse, error)
	GetGame(id uint) (*GameResponse, error)
	ListGames(showAll bool) ([]GameResponse, error)
	UpdateGame(id uint, req UpdateGameRequest) (*GameResponse, error)
	AddChallenge(gameID uint, challengeID uint, scoreOverride int) error
	RemoveChallenge(gameID uint, challengeID uint) error
}

type CreateGameRequest struct {
	Name        string    `json:"name" binding:"required"`
	Description string    `json:"description"`
	StartTime   time.Time `json:"start_time" binding:"required"`
	EndTime     time.Time `json:"end_time" binding:"required"`
	IsPublic    *bool     `json:"is_public"`
}

type UpdateGameRequest struct {
	Name        *string    `json:"name"`
	Description *string    `json:"description"`
	StartTime   *time.Time `json:"start_time"`
	EndTime     *time.Time `json:"end_time"`
	Status      *string    `json:"status"`
	IsPublic    *bool      `json:"is_public"`
}

type GameResponse struct {
	ID          uint      `json:"id"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	StartTime   time.Time `json:"start_time"`
	EndTime     time.Time `json:"end_time"`
	Status      string    `json:"status"`
	IsPublic    bool      `json:"is_public"`
	CreatedBy   uint      `json:"created_by"`
	CreatedAt   time.Time `json:"created_at"`
}

type ChallengeInGame struct {
	GameID        uint `json:"game_id"`
	ChallengeID   uint `json:"challenge_id"`
	ScoreOverride int  `json:"score_override"`
}
