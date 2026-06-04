package games

import (
	"time"

	"github.com/saurlax/sauryctf/internal/models"
)

// ServiceInterface defines the game management contract.
type ServiceInterface interface {
	CreateGame(req CreateGameRequest, createdBy uint) (*GameResponse, error)
	GetGame(id uint) (*GameResponse, error)
	GetPublicGame(id uint) (*GameResponse, error)
	ListGames(showAll bool) ([]GameResponse, error)
	UpdateGame(id uint, req UpdateGameRequest) (*GameResponse, error)
	AddChallenge(gameID uint, challengeID uint, scoreOverride int) error
	RemoveChallenge(gameID uint, challengeID uint) error
	// Participation
	JoinGame(gameID uint, teamID uint, userID uint) error
	LeaveGame(gameID uint, teamID uint, userID uint) error
	GetParticipation(gameID uint, teamID uint) (*models.Participation, error)
	GetParticipationStatus(gameID uint, userID uint) (*GameParticipationResponse, error)
	// Challenges in game
	GetGameChallenges(gameID uint) ([]GameChallengeDetail, error)
	GetGameChallengesForTeam(gameID uint, teamID uint) ([]GameChallengeDetail, error)
	// Flag submission (game-scoped, replaces the standalone submit)
	SubmitFlag(gameID uint, challengeID uint, userID uint, teamID uint, flag string) (*SubmitResult, error)
	// Scoreboard
	GetScoreboard(gameID uint) (*ScoreboardResponse, error)
	GetParticipants(gameID uint) ([]GameParticipantEntry, error)
	UpdateParticipationStatus(gameID uint, teamID uint, status string) (*GameParticipantEntry, error)
	RemoveParticipation(gameID uint, teamID uint) error
}

type CreateGameRequest struct {
	Name             string    `json:"name" binding:"required"`
	Description      string    `json:"description"`
	Notice           string    `json:"notice"`
	StartTime        time.Time `json:"start_time" binding:"required"`
	EndTime          time.Time `json:"end_time" binding:"required"`
	ScoreboardFreezeAt *time.Time `json:"scoreboard_freeze_at"`
	RegistrationMode string    `json:"registration_mode"`
	MaxTeamMembers   int       `json:"max_team_members"`
	IsPublic         *bool     `json:"is_public"`
}

type UpdateGameRequest struct {
	Name             *string    `json:"name"`
	Description      *string    `json:"description"`
	Notice           *string    `json:"notice"`
	StartTime        *time.Time `json:"start_time"`
	EndTime          *time.Time `json:"end_time"`
	ClearScoreboardFreeze bool  `json:"-"`
	ScoreboardFreezeAt *time.Time `json:"scoreboard_freeze_at"`
	Status           *string    `json:"status"`
	RegistrationMode *string    `json:"registration_mode"`
	MaxTeamMembers   *int       `json:"max_team_members"`
	IsPublic         *bool      `json:"is_public"`
}

type GameResponse struct {
	ID               uint      `json:"id"`
	Name             string    `json:"name"`
	Description      string    `json:"description"`
	Notice           string    `json:"notice"`
	StartTime        time.Time `json:"start_time"`
	EndTime          time.Time `json:"end_time"`
	ScoreboardFreezeAt *time.Time `json:"scoreboard_freeze_at"`
	Status           string    `json:"status"`
	RegistrationMode string    `json:"registration_mode"`
	MaxTeamMembers   int       `json:"max_team_members"`
	IsPublic         bool      `json:"is_public"`
	CreatedBy        uint      `json:"created_by"`
	CreatedAt        time.Time `json:"created_at"`
}

type ChallengeInGame struct {
	GameID        uint `json:"game_id"`
	ChallengeID   uint `json:"challenge_id"`
	ScoreOverride int  `json:"score_override"`
}

// GameChallengeDetail is returned to players: challenge info + their solve status.
type GameChallengeDetail struct {
	ID          uint   `json:"id"`
	Title       string `json:"title"`
	Description string `json:"description"`
	Category    string `json:"category"`
	Type        string `json:"type"`
	Difficulty  string `json:"difficulty"`
	Hints       string `json:"hints"`
	Attachments string `json:"attachments"`
	Score       int    `json:"score"`  // effective score (override or base)
	Solved      bool   `json:"solved"` // whether this team solved it
	SolveCount  int    `json:"solve_count"`
	BloodTeam   string `json:"blood_team,omitempty"` // first blood team name
}

type SubmitResult struct {
	Correct   bool   `json:"correct"`
	Score     int    `json:"score,omitempty"`
	BloodType string `json:"blood_type,omitempty"`
	Message   string `json:"message"`
}

// ScoreboardEntry is one team's row in the scoreboard.
type ScoreboardEntry struct {
	Rank       int       `json:"rank"`
	TeamID     uint      `json:"team_id"`
	TeamName   string    `json:"team_name"`
	Score      int       `json:"score"`
	SolveCount int       `json:"solve_count"`
	LastSolve  time.Time `json:"last_solve"`
}

type ScoreboardChallengeStat struct {
	ID          uint   `json:"id"`
	Title       string `json:"title"`
	Category    string `json:"category"`
	Score       int    `json:"score"`
	SolvedCount int    `json:"solved_count"`
	BloodTeam   string `json:"blood_team,omitempty"`
}

type ScoreboardResponse struct {
	GameID            uint                      `json:"game_id"`
	IsFrozen          bool                      `json:"is_frozen"`
	FreezeTime        *time.Time                `json:"freeze_time,omitempty"`
	Entries           []ScoreboardEntry         `json:"entries"`
	Challenges        []ScoreboardChallengeStat `json:"challenges"`
}

type GameParticipantEntry struct {
	TeamID     uint      `json:"team_id"`
	TeamName   string    `json:"team_name"`
	Status     string    `json:"status"`
	JoinedAt   time.Time `json:"joined_at"`
	Score      int       `json:"score"`
	SolveCount int       `json:"solve_count"`
}

type GameParticipationTeam struct {
	ID   uint   `json:"id"`
	Name string `json:"name"`
}

type GameParticipationResponse struct {
	HasTeam      bool                   `json:"has_team"`
	Participated bool                   `json:"participated"`
	Status       string                 `json:"status,omitempty"`
	Team         *GameParticipationTeam `json:"team,omitempty"`
}
