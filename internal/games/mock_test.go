package games

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/saurlax/sauryctf/internal/models"
)

type MockService struct {
	mu               sync.Mutex
	Games            map[uint]*GameResponse
	GameChs          map[string]bool // "gameID-challengeID"
	ChallengesByGame map[uint][]GameChallengeDetail
	Participations   map[string]models.ParticipationStatus // "gameID-teamID"
	UserTeams        map[uint]*GameParticipationTeam
	nextID           uint
}

func NewMockService() *MockService {
	return &MockService{
		Games:            make(map[uint]*GameResponse),
		GameChs:          make(map[string]bool),
		ChallengesByGame: make(map[uint][]GameChallengeDetail),
		Participations:   make(map[string]models.ParticipationStatus),
		UserTeams:        make(map[uint]*GameParticipationTeam),
		nextID:           1,
	}
}

func (m *MockService) CreateGame(req CreateGameRequest, createdBy uint) (*GameResponse, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if err := validateGameTimeline(req.StartTime, req.EndTime, req.ScoreboardFreezeAt); err != nil {
		return nil, err
	}

	isPublic := false
	if req.IsPublic != nil {
		isPublic = *req.IsPublic
	}
	game := &GameResponse{
		ID:                 m.nextID,
		Name:               req.Name,
		Description:        req.Description,
		Notice:             req.Notice,
		StartTime:          req.StartTime,
		EndTime:            req.EndTime,
		ScoreboardFreezeAt: req.ScoreboardFreezeAt,
		Status:             "draft",
		RegistrationMode:   RegistrationModeReview,
		MaxTeamMembers:     req.MaxTeamMembers,
		IsPublic:           isPublic,
		CreatedBy:          createdBy,
		CreatedAt:          time.Now(),
	}
	if req.RegistrationMode != "" {
		game.RegistrationMode = req.RegistrationMode
	}
	m.Games[game.ID] = game
	m.nextID++
	return game, nil
}

func (m *MockService) GetGame(id uint) (*GameResponse, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	game, ok := m.Games[id]
	if !ok {
		return nil, fmt.Errorf("game not found")
	}
	return game, nil
}

func (m *MockService) GetPublicGame(id uint) (*GameResponse, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	game, ok := m.Games[id]
	if !ok || !game.IsPublic || game.Status == "draft" {
		return nil, fmt.Errorf("game not found")
	}
	return game, nil
}

func (m *MockService) ListGames(showAll bool) ([]GameResponse, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	var result []GameResponse
	for _, g := range m.Games {
		if !showAll && (!g.IsPublic || g.Status == "draft") {
			continue
		}
		result = append(result, *g)
	}
	return result, nil
}

func (m *MockService) UpdateGame(id uint, req UpdateGameRequest) (*GameResponse, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	game, ok := m.Games[id]
	if !ok {
		return nil, fmt.Errorf("game not found")
	}
	nextStartTime := game.StartTime
	if req.StartTime != nil {
		nextStartTime = *req.StartTime
	}
	nextEndTime := game.EndTime
	if req.EndTime != nil {
		nextEndTime = *req.EndTime
	}
	nextFreezeAt := game.ScoreboardFreezeAt
	if req.ClearScoreboardFreeze {
		nextFreezeAt = nil
	}
	if req.ScoreboardFreezeAt != nil {
		nextFreezeAt = req.ScoreboardFreezeAt
	}
	if err := validateGameTimeline(nextStartTime, nextEndTime, nextFreezeAt); err != nil {
		return nil, err
	}
	if req.Name != nil {
		game.Name = *req.Name
	}
	if req.Description != nil {
		game.Description = *req.Description
	}
	if req.Notice != nil {
		game.Notice = *req.Notice
	}
	if req.Status != nil {
		game.Status = *req.Status
	}
	if req.ScoreboardFreezeAt != nil {
		game.ScoreboardFreezeAt = req.ScoreboardFreezeAt
	}
	if req.ClearScoreboardFreeze {
		game.ScoreboardFreezeAt = nil
	}
	if req.RegistrationMode != nil {
		game.RegistrationMode = *req.RegistrationMode
	}
	if req.MaxTeamMembers != nil {
		game.MaxTeamMembers = *req.MaxTeamMembers
	}
	if req.IsPublic != nil {
		game.IsPublic = *req.IsPublic
	}
	return game, nil
}

func (m *MockService) DeleteGame(id uint) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if _, ok := m.Games[id]; !ok {
		return fmt.Errorf("game not found")
	}

	delete(m.Games, id)
	delete(m.ChallengesByGame, id)
	prefix := fmt.Sprintf("%d-", id)
	for key := range m.Participations {
		if strings.HasPrefix(key, prefix) {
			delete(m.Participations, key)
		}
	}
	return nil
}

func (m *MockService) ExportGamePackage(id uint) ([]byte, string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	game, ok := m.Games[id]
	if !ok {
		return nil, "", fmt.Errorf("game not found")
	}

	payload, err := json.Marshal(ExportGamePackage{
		Version:     "sauryctf.export.v1",
		GeneratedAt: time.Now(),
		Game: ExportGameMetadata{
			ID:                 game.ID,
			Name:               game.Name,
			Description:        game.Description,
			Notice:             game.Notice,
			StartTime:          game.StartTime,
			EndTime:            game.EndTime,
			ScoreboardFreezeAt: game.ScoreboardFreezeAt,
			Status:             game.Status,
			RegistrationMode:   game.RegistrationMode,
			MaxTeamMembers:     game.MaxTeamMembers,
			IsPublic:           game.IsPublic,
		},
		Challenges: m.exportChallenges(id),
	})
	if err != nil {
		return nil, "", err
	}

	var archive bytes.Buffer
	writer := zip.NewWriter(&archive)
	file, err := writer.Create("game.json")
	if err != nil {
		return nil, "", err
	}
	if _, err := file.Write(payload); err != nil {
		return nil, "", err
	}
	if err := writer.Close(); err != nil {
		return nil, "", err
	}

	return archive.Bytes(), fmt.Sprintf("game-%d-%s-export.zip", game.ID, sanitizeExportName(game.Name)), nil
}

func (m *MockService) ImportGamePackage(data []byte, createdBy uint) (*GameResponse, error) {
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, fmt.Errorf("invalid import package")
	}

	var gameFile *zip.File
	for _, file := range reader.File {
		if file.Name == "game.json" {
			gameFile = file
			break
		}
	}
	if gameFile == nil {
		return nil, fmt.Errorf("game.json not found in import package")
	}

	fileReader, err := gameFile.Open()
	if err != nil {
		return nil, err
	}
	defer fileReader.Close()

	var pkg ExportGamePackage
	if err := json.NewDecoder(fileReader).Decode(&pkg); err != nil {
		return nil, fmt.Errorf("invalid game.json")
	}
	if pkg.Version != "sauryctf.export.v1" {
		return nil, fmt.Errorf("unsupported import package version")
	}

	imported, err := m.CreateGame(CreateGameRequest{
		Name:               pkg.Game.Name,
		Description:        pkg.Game.Description,
		Notice:             pkg.Game.Notice,
		StartTime:          pkg.Game.StartTime,
		EndTime:            pkg.Game.EndTime,
		ScoreboardFreezeAt: pkg.Game.ScoreboardFreezeAt,
		RegistrationMode:   pkg.Game.RegistrationMode,
		MaxTeamMembers:     pkg.Game.MaxTeamMembers,
		IsPublic:           &pkg.Game.IsPublic,
	}, createdBy)
	if err != nil {
		return nil, err
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	m.ChallengesByGame[imported.ID] = make([]GameChallengeDetail, 0, len(pkg.Challenges))
	for _, item := range pkg.Challenges {
		m.ChallengesByGame[imported.ID] = append(m.ChallengesByGame[imported.ID], GameChallengeDetail{
			ID:          item.ID,
			Title:       item.Title,
			Description: item.Description,
			Category:    item.Category,
			Type:        item.Type,
			Difficulty:  item.Difficulty,
			Hints:       item.Hints,
			Attachments: item.Attachments,
			Score: func() int {
				if item.ScoreOverride > 0 {
					return item.ScoreOverride
				}
				return item.BaseScore
			}(),
		})
	}

	return imported, nil
}

func (m *MockService) AddChallenge(gameID uint, challengeID uint, scoreOverride int) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if _, ok := m.Games[gameID]; !ok {
		return fmt.Errorf("game not found")
	}
	key := fmt.Sprintf("%d-%d", gameID, challengeID)
	m.GameChs[key] = true
	return nil
}

func (m *MockService) RemoveChallenge(gameID uint, challengeID uint) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	key := fmt.Sprintf("%d-%d", gameID, challengeID)
	if !m.GameChs[key] {
		return fmt.Errorf("challenge not in game")
	}
	delete(m.GameChs, key)
	return nil
}

func (m *MockService) JoinGame(gameID uint, teamID uint, userID uint) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if _, ok := m.Games[gameID]; !ok {
		return fmt.Errorf("game not found")
	}
	key := fmt.Sprintf("%d-%d", gameID, teamID)
	if _, exists := m.Participations[key]; exists {
		return fmt.Errorf("team already joined this game")
	}
	status := models.ParticipationPending
	if game, ok := m.Games[gameID]; ok && game.RegistrationMode == RegistrationModeAutoAccept {
		status = models.ParticipationAccepted
	}
	m.Participations[key] = status
	return nil
}

func (m *MockService) LeaveGame(gameID uint, teamID uint, userID uint) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	key := fmt.Sprintf("%d-%d", gameID, teamID)
	if _, exists := m.Participations[key]; !exists {
		return fmt.Errorf("not joined this game")
	}
	delete(m.Participations, key)
	return nil
}

func (m *MockService) GetParticipation(gameID uint, teamID uint) (*models.Participation, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	key := fmt.Sprintf("%d-%d", gameID, teamID)
	status, exists := m.Participations[key]
	if !exists {
		return nil, fmt.Errorf("participation not found")
	}
	return &models.Participation{GameID: gameID, TeamID: teamID, Status: status}, nil
}

func (m *MockService) GetParticipationStatus(gameID uint, userID uint) (*GameParticipationResponse, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if _, ok := m.Games[gameID]; !ok {
		return nil, fmt.Errorf("game not found")
	}

	team := m.UserTeams[userID]
	if team == nil {
		return &GameParticipationResponse{
			HasTeam:      false,
			Participated: false,
		}, nil
	}

	key := fmt.Sprintf("%d-%d", gameID, team.ID)
	status, participated := m.Participations[key]
	return &GameParticipationResponse{
		HasTeam:      true,
		Participated: participated,
		Status:       string(status),
		Team:         team,
	}, nil
}

func (m *MockService) GetGameChallenges(gameID uint) ([]GameChallengeDetail, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if _, ok := m.Games[gameID]; !ok {
		return nil, fmt.Errorf("game not found")
	}
	return append([]GameChallengeDetail(nil), m.ChallengesByGame[gameID]...), nil
}

func (m *MockService) GetAdminGameChallenges(gameID uint) ([]GameChallengeDetail, error) {
	return m.GetGameChallenges(gameID)
}

func (m *MockService) GetGameChallengesForTeam(gameID uint, teamID uint) ([]GameChallengeDetail, error) {
	return m.GetGameChallenges(gameID)
}

func (m *MockService) SubmitFlag(gameID uint, challengeID uint, userID uint, teamID uint, flag string) (*SubmitResult, error) {
	if flag == "correct_flag" {
		return &SubmitResult{Correct: true, Score: 100, Message: "correct"}, nil
	}
	return &SubmitResult{Correct: false, Message: "wrong flag"}, nil
}

func (m *MockService) GetScoreboard(gameID uint) (*ScoreboardResponse, error) {
	if _, ok := m.Games[gameID]; !ok {
		return nil, fmt.Errorf("game not found")
	}
	return &ScoreboardResponse{GameID: gameID, Entries: []ScoreboardEntry{}}, nil
}

func (m *MockService) GetParticipants(gameID uint) ([]GameParticipantEntry, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if _, ok := m.Games[gameID]; !ok {
		return nil, fmt.Errorf("game not found")
	}

	var result []GameParticipantEntry
	for userID, team := range m.UserTeams {
		key := fmt.Sprintf("%d-%d", gameID, team.ID)
		status, exists := m.Participations[key]
		if !exists {
			continue
		}
		result = append(result, GameParticipantEntry{
			TeamID:     team.ID,
			TeamName:   team.Name,
			Status:     string(status),
			JoinedAt:   time.Now(),
			Score:      0,
			SolveCount: 0,
		})
		_ = userID
	}

	return result, nil
}

func (m *MockService) UpdateParticipationStatus(gameID uint, teamID uint, status string) (*GameParticipantEntry, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	key := fmt.Sprintf("%d-%d", gameID, teamID)
	if _, ok := m.Participations[key]; !ok {
		return nil, fmt.Errorf("participation not found")
	}

	nextStatus := models.ParticipationStatus(status)
	switch nextStatus {
	case models.ParticipationPending, models.ParticipationAccepted, models.ParticipationRejected:
	default:
		return nil, fmt.Errorf("invalid participation status")
	}

	m.Participations[key] = nextStatus

	for _, team := range m.UserTeams {
		if team.ID == teamID {
			return &GameParticipantEntry{
				TeamID:     team.ID,
				TeamName:   team.Name,
				Status:     string(nextStatus),
				JoinedAt:   time.Now(),
				Score:      0,
				SolveCount: 0,
			}, nil
		}
	}

	return nil, fmt.Errorf("participation not found")
}

func (m *MockService) RemoveParticipation(gameID uint, teamID uint) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	key := fmt.Sprintf("%d-%d", gameID, teamID)
	if _, ok := m.Participations[key]; !ok {
		return fmt.Errorf("participation not found")
	}

	delete(m.Participations, key)
	return nil
}

func (m *MockService) exportChallenges(gameID uint) []ExportedGameChallenge {
	items := m.ChallengesByGame[gameID]
	result := make([]ExportedGameChallenge, 0, len(items))
	for _, item := range items {
		result = append(result, ExportedGameChallenge{
			ID:          item.ID,
			Title:       item.Title,
			Description: item.Description,
			Category:    item.Category,
			Type:        item.Type,
			Difficulty:  item.Difficulty,
			Hints:       item.Hints,
			Attachments: item.Attachments,
			BaseScore:   item.Score,
			IsVisible:   true,
		})
	}
	return result
}
