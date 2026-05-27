package games

import (
	"fmt"
	"sync"
	"time"
)

type MockService struct {
	mu       sync.Mutex
	Games    map[uint]*GameResponse
	GameChs  map[string]bool // "gameID-challengeID"
	nextID   uint
}

func NewMockService() *MockService {
	return &MockService{
		Games:   make(map[uint]*GameResponse),
		GameChs: make(map[string]bool),
		nextID:  1,
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
