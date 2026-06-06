package challenges

import "github.com/saurlax/sauryctf/internal/models"

// ServiceInterface defines the challenge management contract.
type ServiceInterface interface {
	CreateChallenge(req CreateChallengeRequest, createdBy uint) (*models.Challenge, error)
	GetChallenge(id uint) (*models.Challenge, error)
	ListChallenges(category string, showHidden bool) ([]models.Challenge, error)
	UpdateChallenge(id uint, req UpdateChallengeRequest, updatedBy ...uint) (*models.Challenge, error)
	DeleteChallenge(id uint, deletedBy ...uint) error
	SubmitFlag(challengeID uint, gameID uint, userID uint, teamID uint, flag string) (*SubmitResult, error)
}

type CreateChallengeRequest struct {
	Title         string  `json:"title" binding:"required"`
	Description   string  `json:"description"`
	Category      string  `json:"category" binding:"required"`
	Type          string  `json:"type"`
	Difficulty    string  `json:"difficulty"`
	Flag          string  `json:"flag" binding:"required"`
	FlagFormat    string  `json:"flag_format"`
	BaseScore     int     `json:"base_score"`
	MinScore      int     `json:"min_score"`
	DecayRate     float64 `json:"decay_rate"`
	MaxAttempts   int     `json:"max_attempts"`
	Hints         string  `json:"hints"`
	Attachments   string  `json:"attachments"`
	ContainerSpec string  `json:"container_spec"`
	IsVisible     *bool   `json:"is_visible"`
}

type UpdateChallengeRequest struct {
	Title         *string  `json:"title"`
	Description   *string  `json:"description"`
	Category      *string  `json:"category"`
	Type          *string  `json:"type"`
	Difficulty    *string  `json:"difficulty"`
	Flag          *string  `json:"flag"`
	FlagFormat    *string  `json:"flag_format"`
	BaseScore     *int     `json:"base_score"`
	MinScore      *int     `json:"min_score"`
	DecayRate     *float64 `json:"decay_rate"`
	MaxAttempts   *int     `json:"max_attempts"`
	Hints         *string  `json:"hints"`
	Attachments   *string  `json:"attachments"`
	ContainerSpec *string  `json:"container_spec"`
	IsVisible     *bool    `json:"is_visible"`
}

type SubmitResult struct {
	Correct   bool   `json:"correct"`
	Score     int    `json:"score,omitempty"`
	BloodType string `json:"blood_type,omitempty"`
	Message   string `json:"message"`
}
