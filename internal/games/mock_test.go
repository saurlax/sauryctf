package games

import (
	"fmt"
	"sync"
	"time"

	"github.com/saurlax/sauryctf/internal/models"
)

type MockService struct {
	mu              sync.Mutex
	Games           map[uint]*GameResponse
	GameChs         map[string]bool // "gameID-challengeID"
	Participations  map[string]bool // "gameID-teamID"
	UserTeams       map[uint]*GameParticipationTeam
	nextID          uint
}

func NewMockService() *MockService {
	return &MockService{
		Games:          make(map[uint]*GameResponse),
		GameChs:        make(map[string]bool),
		Participations: make(map[string]bool),
		UserTeams:      make(map[uint]*GameParticipationTeam),
		nextID:         1,
	}
}

func (m *MockService) CreateGame(req CreateGameRequest, createdBy uint) (*GameResponse, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	isPublic := false
	if req.IsPublic != nil {
		isPublic = *req.IsPublic
	}
	game := &GameResponse{
		ID:          m.nextID,
		Name:        req.Name,
		Description: req.Description,
		Notice:      req.Notice,
		StartTime:   req.StartTime,
		EndTime:     req.EndTime,
		Status:      "draft",
		IsPublic:    isPublic,
		CreatedBy:   createdBy,
		CreatedAt:   time.Now(),
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

func (m *MockService) ListGames(showAll bool) ([]GameResponse, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	var result []GameResponse
	for _, g := range m.Games {
		if !showAll && !g.IsPublic {
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
	if req.IsPublic != nil {
		game.IsPublic = *req.IsPublic
	}
	return game, nil
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
	if m.Participations[key] {
		return fmt.Errorf("team already joined this game")
	}
	m.Participations[key] = true
	return nil
}

func (m *MockService) LeaveGame(gameID uint, teamID uint, userID uint) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	key := fmt.Sprintf("%d-%d", gameID, teamID)
	if !m.Participations[key] {
		return fmt.Errorf("not joined this game")
	}
	delete(m.Participations, key)
	return nil
}

func (m *MockService) GetParticipation(gameID uint, teamID uint) (*models.Participation, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	key := fmt.Sprintf("%d-%d", gameID, teamID)
	if !m.Participations[key] {
		return nil, fmt.Errorf("participation not found")
	}
	return &models.Participation{GameID: gameID, TeamID: teamID, Status: models.ParticipationAccepted}, nil
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
	return &GameParticipationResponse{
		HasTeam:      true,
		Participated: m.Participations[key],
		Status:       string(models.ParticipationAccepted),
		Team:         team,
	}, nil
}

func (m *MockService) GetGameChallenges(gameID uint) ([]GameChallengeDetail, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if _, ok := m.Games[gameID]; !ok {
		return nil, fmt.Errorf("game not found")
	}
	return []GameChallengeDetail{}, nil
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
		if !m.Participations[key] {
			continue
		}
		result = append(result, GameParticipantEntry{
			TeamID:     team.ID,
			TeamName:   team.Name,
			Status:     string(models.ParticipationAccepted),
			JoinedAt:   time.Now(),
			Score:      0,
			SolveCount: 0,
		})
		_ = userID
	}

	return result, nil
}

