package games

import (
	"time"

	"github.com/saurlax/sauryctf/internal/models"
)

const (
	ExportPackageVersionV1 = "sauryctf.export.v1"
	ExportPackageVersionV2 = "sauryctf.export.v2"
)

type ChallengeInstanceRuntimeSpec struct {
	Provider  string
	Image     string
	LaunchURL string
	Host      string
	Port      string
	Command   string
	Note      string
}

type ChallengeInstanceProviderRequest struct {
	GameID        uint
	ChallengeID   uint
	TeamID        uint
	UserID        uint
	Now           time.Time
	LeaseDuration time.Duration
	Runtime       ChallengeInstanceRuntimeSpec
	Existing      *models.GameInstanceLease
}

type ChallengeInstanceLeaseState struct {
	Status        string
	Provider      string
	Image         string
	LaunchURL     string
	Host          string
	Port          string
	Command       string
	Note          string
	StartedAt     time.Time
	LastRenewedAt time.Time
	ExpiresAt     time.Time
}

type ChallengeInstanceProvider interface {
	EnsureLease(req ChallengeInstanceProviderRequest) (*ChallengeInstanceLeaseState, error)
}

type InstancePolicy struct {
	LeaseDuration time.Duration
	RenewalWindow time.Duration
}

// ServiceInterface defines the game management contract.
type ServiceInterface interface {
	CreateGame(req CreateGameRequest, createdBy uint) (*GameResponse, error)
	GetGame(id uint) (*GameResponse, error)
	GetPublicGame(id uint) (*GameResponse, error)
	ListGames(showAll bool) ([]GameResponse, error)
	UpdateGame(id uint, req UpdateGameRequest) (*GameResponse, error)
	DeleteGame(id uint) error
	ExportGamePackage(id uint) ([]byte, string, error)
	ExportScoreboardPackage(id uint, division string) ([]byte, string, error)
	ExportWriteupsPackage(id uint) ([]byte, string, error)
	ExportSubmissionsPackage(id uint) ([]byte, string, error)
	ListAnnouncements(gameID uint) ([]GameAnnouncementResponse, error)
	CreateAnnouncement(gameID uint, createdBy uint, req CreateGameAnnouncementRequest) (*GameAnnouncementResponse, error)
	DeleteAnnouncement(gameID uint, announcementID uint) error
	ListSubmissionRecords(gameID uint, submissionType string, limit int) ([]GameSubmissionRecord, error)
	ListSubmissionCheatClues(gameID uint, limit int) ([]GameSubmissionCheatClue, error)
	GetAdminDashboardSummary(limit int) (*AdminDashboardSummaryResponse, error)
	ImportGamePackage(data []byte, createdBy uint) (*GameResponse, error)
	AddChallenge(gameID uint, challengeID uint, scoreOverride int) error
	RemoveChallenge(gameID uint, challengeID uint) error
	// Participation
	JoinGame(gameID uint, teamID uint, userID uint, invitationCode string) error
	LeaveGame(gameID uint, teamID uint, userID uint) error
	GetParticipation(gameID uint, teamID uint) (*models.Participation, error)
	GetParticipationStatus(gameID uint, userID uint) (*GameParticipationResponse, error)
	// Challenges in game
	GetGameChallenges(gameID uint) ([]GameChallengeDetail, error)
	GetAdminGameChallenges(gameID uint) ([]GameChallengeDetail, error)
	GetGameChallengesForTeam(gameID uint, teamID uint) ([]GameChallengeDetail, error)
	GetChallengeInstance(gameID uint, challengeID uint, userID uint) (*ChallengeInstanceResponse, error)
	EnsureChallengeInstance(gameID uint, challengeID uint, userID uint) (*ChallengeInstanceResponse, error)
	DestroyChallengeInstance(gameID uint, challengeID uint, userID uint) (*ChallengeInstanceResponse, error)
	// Flag submission (game-scoped, replaces the standalone submit)
	SubmitFlag(gameID uint, challengeID uint, userID uint, teamID uint, flag string) (*SubmitResult, error)
	// Scoreboard
	GetScoreboard(gameID uint, division string) (*ScoreboardResponse, error)
	GetParticipants(gameID uint) ([]GameParticipantEntry, error)
	UpdateParticipationStatus(gameID uint, teamID uint, status string, division *string) (*GameParticipantEntry, error)
	RemoveParticipation(gameID uint, teamID uint) error
	GetWriteup(gameID uint, userID uint) (*GameWriteupResponse, error)
	SubmitWriteup(gameID uint, userID uint, req SubmitGameWriteupRequest) (*GameWriteupResponse, error)
	ListWriteups(gameID uint) ([]GameWriteupResponse, error)
	ReviewWriteup(gameID uint, teamID uint, reviewerID uint, req ReviewGameWriteupRequest) (*GameWriteupResponse, error)
}

type CreateGameRequest struct {
	Name               string     `json:"name" binding:"required"`
	Description        string     `json:"description"`
	Notice             string     `json:"notice"`
	InvitationCode     string     `json:"invitation_code"`
	Divisions          []string   `json:"divisions"`
	StartTime          time.Time  `json:"start_time" binding:"required"`
	EndTime            time.Time  `json:"end_time" binding:"required"`
	ScoreboardFreezeAt *time.Time `json:"scoreboard_freeze_at"`
	RegistrationMode   string     `json:"registration_mode"`
	MaxTeamMembers     int        `json:"max_team_members"`
	PracticeMode       bool       `json:"practice_mode"`
	WriteupRequired    bool       `json:"writeup_required"`
	WriteupDeadline    *time.Time `json:"writeup_deadline"`
	IsPublic           *bool      `json:"is_public"`
}

type UpdateGameRequest struct {
	Name                  *string    `json:"name"`
	Description           *string    `json:"description"`
	Notice                *string    `json:"notice"`
	InvitationCode        *string    `json:"invitation_code"`
	Divisions             *[]string  `json:"divisions"`
	StartTime             *time.Time `json:"start_time"`
	EndTime               *time.Time `json:"end_time"`
	ClearScoreboardFreeze bool       `json:"-"`
	ScoreboardFreezeAt    *time.Time `json:"scoreboard_freeze_at"`
	Status                *string    `json:"status"`
	RegistrationMode      *string    `json:"registration_mode"`
	MaxTeamMembers        *int       `json:"max_team_members"`
	PracticeMode          *bool      `json:"practice_mode"`
	WriteupRequired       *bool      `json:"writeup_required"`
	ClearWriteupDeadline  bool       `json:"-"`
	WriteupDeadline       *time.Time `json:"writeup_deadline"`
	IsPublic              *bool      `json:"is_public"`
}

type GameResponse struct {
	ID                 uint       `json:"id"`
	Name               string     `json:"name"`
	Description        string     `json:"description"`
	Notice             string     `json:"notice"`
	InvitationCode     string     `json:"invitation_code,omitempty"`
	InvitationRequired bool       `json:"invitation_required"`
	Divisions          []string   `json:"divisions"`
	StartTime          time.Time  `json:"start_time"`
	EndTime            time.Time  `json:"end_time"`
	ScoreboardFreezeAt *time.Time `json:"scoreboard_freeze_at"`
	Status             string     `json:"status"`
	RegistrationMode   string     `json:"registration_mode"`
	MaxTeamMembers     int        `json:"max_team_members"`
	PracticeMode       bool       `json:"practice_mode"`
	WriteupRequired    bool       `json:"writeup_required"`
	WriteupDeadline    *time.Time `json:"writeup_deadline"`
	IsPublic           bool       `json:"is_public"`
	CreatedBy          uint       `json:"created_by"`
	CreatedAt          time.Time  `json:"created_at"`
}

type ChallengeInGame struct {
	GameID        uint `json:"game_id"`
	ChallengeID   uint `json:"challenge_id"`
	ScoreOverride int  `json:"score_override"`
}

// GameChallengeDetail is returned to players: challenge info + their solve status.
type GameChallengeDetail struct {
	ID              uint   `json:"id"`
	Title           string `json:"title"`
	Description     string `json:"description"`
	Category        string `json:"category"`
	Type            string `json:"type"`
	Difficulty      string `json:"difficulty"`
	Hints           string `json:"hints"`
	Attachments     string `json:"attachments"`
	ContainerSpec   string `json:"container_spec"`
	Score           int    `json:"score"`  // effective score (override or base)
	Solved          bool   `json:"solved"` // whether this team solved it
	SolveCount      int    `json:"solve_count"`
	BloodTeam       string `json:"blood_team,omitempty"`        // first blood team name
	SecondBloodTeam string `json:"second_blood_team,omitempty"` // second blood team name
	ThirdBloodTeam  string `json:"third_blood_team,omitempty"`  // third blood team name
}

type ChallengeInstanceResponse struct {
	GameID         uint       `json:"game_id"`
	ChallengeID    uint       `json:"challenge_id"`
	TeamID         uint       `json:"team_id"`
	Status         string     `json:"status"`
	Provider       string     `json:"provider,omitempty"`
	Image          string     `json:"image,omitempty"`
	LaunchURL      string     `json:"launch_url,omitempty"`
	Host           string     `json:"host,omitempty"`
	Port           string     `json:"port,omitempty"`
	Command        string     `json:"command,omitempty"`
	Note           string     `json:"note,omitempty"`
	StartedAt      *time.Time `json:"started_at,omitempty"`
	LastRenewedAt  *time.Time `json:"last_renewed_at,omitempty"`
	ExpiresAt      *time.Time `json:"expires_at,omitempty"`
	SecondsLeft    int        `json:"seconds_left"`
	CanStart       bool       `json:"can_start"`
	CanRenew       bool       `json:"can_renew"`
	Message        string     `json:"message"`
}

type SubmitResult struct {
	Correct   bool   `json:"correct"`
	Score     int    `json:"score,omitempty"`
	BloodType string `json:"blood_type,omitempty"`
	IsPractice bool  `json:"is_practice,omitempty"`
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
	ID              uint   `json:"id"`
	Title           string `json:"title"`
	Category        string `json:"category"`
	Score           int    `json:"score"`
	SolvedCount     int    `json:"solved_count"`
	BloodTeam       string `json:"blood_team,omitempty"`
	SecondBloodTeam string `json:"second_blood_team,omitempty"`
	ThirdBloodTeam  string `json:"third_blood_team,omitempty"`
}

type ScoreboardResponse struct {
	GameID     uint                      `json:"game_id"`
	Division   string                    `json:"division,omitempty"`
	Divisions  []string                  `json:"divisions"`
	IsFrozen   bool                      `json:"is_frozen"`
	FreezeTime *time.Time                `json:"freeze_time,omitempty"`
	Entries    []ScoreboardEntry         `json:"entries"`
	Challenges []ScoreboardChallengeStat `json:"challenges"`
}

type GameParticipantEntry struct {
	TeamID     uint      `json:"team_id"`
	TeamName   string    `json:"team_name"`
	Status     string    `json:"status"`
	Division   string    `json:"division"`
	JoinedAt   time.Time `json:"joined_at"`
	Score      int       `json:"score"`
	SolveCount int       `json:"solve_count"`
}

type GameParticipationTeam struct {
	ID   uint   `json:"id"`
	Name string `json:"name"`
}

type GameParticipationResponse struct {
	HasTeam              bool                   `json:"has_team"`
	Participated         bool                   `json:"participated"`
	Status               string                 `json:"status,omitempty"`
	Division             string                 `json:"division,omitempty"`
	Divisions            []string               `json:"divisions"`
	Team                 *GameParticipationTeam `json:"team,omitempty"`
	WriteupRequired      bool                   `json:"writeup_required"`
	WriteupSubmitted     bool                   `json:"writeup_submitted"`
	WriteupStatus        string                 `json:"writeup_status,omitempty"`
	WriteupDeadline      *time.Time             `json:"writeup_deadline,omitempty"`
	WriteupDeadlinePassed bool                  `json:"writeup_deadline_passed"`
	MissingWriteup       bool                   `json:"missing_writeup"`
}

type SubmitGameWriteupRequest struct {
	Content string `json:"content" binding:"required"`
}

type ReviewGameWriteupRequest struct {
	Status string `json:"status" binding:"required"`
	Remark string `json:"remark"`
}

type CreateGameAnnouncementRequest struct {
	Content string `json:"content" binding:"required"`
}

type GameAnnouncementResponse struct {
	ID        uint      `json:"id"`
	GameID    uint      `json:"game_id"`
	Content   string    `json:"content"`
	CreatedBy uint      `json:"created_by"`
	CreatedAt time.Time `json:"created_at"`
}

type GameWriteupResponse struct {
	GameID       uint       `json:"game_id"`
	TeamID       uint       `json:"team_id"`
	TeamName     string     `json:"team_name"`
	SubmittedBy  uint       `json:"submitted_by"`
	Content      string     `json:"content"`
	Status       string     `json:"status"`
	ReviewerID   *uint      `json:"reviewer_id,omitempty"`
	ReviewRemark string     `json:"review_remark"`
	SubmittedAt  time.Time  `json:"submitted_at"`
	ReviewedAt   *time.Time `json:"reviewed_at,omitempty"`
	CanSubmit    bool       `json:"can_submit"`
}

type GameSubmissionRecord struct {
	ID             uint      `json:"id"`
	GameID         uint      `json:"game_id"`
	ChallengeID    uint      `json:"challenge_id"`
	ChallengeTitle string    `json:"challenge_title"`
	Category       string    `json:"category"`
	UserID         uint      `json:"user_id"`
	Username       string    `json:"username"`
	TeamID         uint      `json:"team_id"`
	TeamName       string    `json:"team_name"`
	SubmittedFlag  string    `json:"submitted_flag"`
	Result         string    `json:"result"`
	Message        string    `json:"message"`
	IsCorrect      bool      `json:"is_correct"`
	IsPractice     bool      `json:"is_practice"`
	Score          int       `json:"score"`
	BloodType      string    `json:"blood_type"`
	SubmittedAt    time.Time `json:"submitted_at"`
}

type GameSubmissionCheatClue struct {
	SubmittedFlag  string    `json:"submitted_flag"`
	ChallengeID    uint      `json:"challenge_id"`
	ChallengeTitle string    `json:"challenge_title"`
	FirstSeenAt    time.Time `json:"first_seen_at"`
	LastSeenAt     time.Time `json:"last_seen_at"`
	TeamCount      int       `json:"team_count"`
	SubmissionCount int      `json:"submission_count"`
	Teams          []string  `json:"teams"`
}

type AdminDashboardSummaryResponse struct {
	Games               []AdminDashboardGameSummary       `json:"games"`
	PendingParticipants []AdminDashboardParticipantEntry  `json:"pending_participants"`
	PendingWriteups     []AdminDashboardWriteupEntry      `json:"pending_writeups"`
	LatestAnnouncements []AdminDashboardAnnouncementEntry `json:"latest_announcements"`
	RecentSubmissions   []AdminDashboardSubmissionEntry   `json:"recent_submissions"`
	CheatClues          []AdminDashboardCheatClueEntry    `json:"cheat_clues"`
}

type AdminDashboardGameSummary struct {
	ID               uint      `json:"id"`
	Name             string    `json:"name"`
	StartTime        time.Time `json:"start_time"`
	EndTime          time.Time `json:"end_time"`
	Status           string    `json:"status"`
	IsPublic         bool      `json:"is_public"`
	RegistrationMode string    `json:"registration_mode"`
	PracticeMode     bool      `json:"practice_mode"`
	WriteupRequired  bool      `json:"writeup_required"`
}

type AdminDashboardParticipantEntry struct {
	GameID     uint      `json:"game_id"`
	GameName   string    `json:"game_name"`
	TeamID     uint      `json:"team_id"`
	TeamName   string    `json:"team_name"`
	Status     string    `json:"status"`
	Division   string    `json:"division"`
	JoinedAt   time.Time `json:"joined_at"`
	Score      int       `json:"score"`
	SolveCount int       `json:"solve_count"`
}

type AdminDashboardWriteupEntry struct {
	GameID      uint      `json:"game_id"`
	GameName    string    `json:"game_name"`
	TeamID      uint      `json:"team_id"`
	TeamName    string    `json:"team_name"`
	SubmittedBy uint      `json:"submitted_by"`
	Status      string    `json:"status"`
	SubmittedAt time.Time `json:"submitted_at"`
}

type AdminDashboardAnnouncementEntry struct {
	ID        uint      `json:"id"`
	GameID    uint      `json:"game_id"`
	GameName  string    `json:"game_name"`
	Content   string    `json:"content"`
	CreatedBy uint      `json:"created_by"`
	CreatedAt time.Time `json:"created_at"`
}

type AdminDashboardSubmissionEntry struct {
	GameID         uint      `json:"game_id"`
	GameName       string    `json:"game_name"`
	ChallengeID    uint      `json:"challenge_id"`
	ChallengeTitle string    `json:"challenge_title"`
	TeamID         uint      `json:"team_id"`
	TeamName       string    `json:"team_name"`
	Result         string    `json:"result"`
	SubmittedAt    time.Time `json:"submitted_at"`
}

type AdminDashboardCheatClueEntry struct {
	GameID          uint      `json:"game_id"`
	GameName        string    `json:"game_name"`
	ChallengeID     uint      `json:"challenge_id"`
	ChallengeTitle  string    `json:"challenge_title"`
	SubmittedFlag   string    `json:"submitted_flag"`
	TeamCount       int       `json:"team_count"`
	SubmissionCount int       `json:"submission_count"`
	LastSeenAt      time.Time `json:"last_seen_at"`
}

type ExportGamePackage struct {
	Version     string                  `json:"version"`
	GeneratedAt time.Time               `json:"generated_at"`
	Game        ExportGameMetadata      `json:"game"`
	Challenges  []ExportedGameChallenge `json:"challenges"`
}

type ExportGameMetadata struct {
	ID                 uint       `json:"id"`
	Name               string     `json:"name"`
	Description        string     `json:"description"`
	Notice             string     `json:"notice"`
	InvitationCode     string     `json:"invitation_code,omitempty"`
	Divisions          []string   `json:"divisions"`
	StartTime          time.Time  `json:"start_time"`
	EndTime            time.Time  `json:"end_time"`
	ScoreboardFreezeAt *time.Time `json:"scoreboard_freeze_at,omitempty"`
	Status             string     `json:"status"`
	RegistrationMode   string     `json:"registration_mode"`
	MaxTeamMembers     int        `json:"max_team_members"`
	PracticeMode       bool       `json:"practice_mode"`
	WriteupRequired    bool       `json:"writeup_required"`
	WriteupDeadline    *time.Time `json:"writeup_deadline,omitempty"`
	IsPublic           bool       `json:"is_public"`
}

type ExportedGameChallenge struct {
	ID            uint    `json:"id"`
	Title         string  `json:"title"`
	Description   string  `json:"description"`
	Category      string  `json:"category"`
	Type          string  `json:"type"`
	Difficulty    string  `json:"difficulty"`
	Flag          string  `json:"flag"`
	FlagFormat    string  `json:"flag_format"`
	Hints         string  `json:"hints"`
	Attachments   string  `json:"attachments"`
	ContainerSpec string  `json:"container_spec"`
	BaseScore     int     `json:"base_score"`
	MinScore      int     `json:"min_score"`
	DecayRate     float64 `json:"decay_rate"`
	MaxAttempts   int     `json:"max_attempts"`
	IsVisible     bool    `json:"is_visible"`
	ScoreOverride int     `json:"score_override"`
	EmbeddedAttachments []ExportedAttachmentFile `json:"embedded_attachments,omitempty"`
}

type ExportedAttachmentFile struct {
	Name        string `json:"name"`
	ZipPath     string `json:"zip_path"`
	OriginalURL string `json:"original_url"`
}
