package challenges

import (
	"fmt"
	"sync"

	"github.com/saurlax/sauryctf/internal/models"
)

type MockService struct {
	mu         sync.Mutex
	Challenges map[uint]*models.Challenge
	Solves     []models.Solve
	nextID     uint
}

func NewMockService() *MockService {
	return &MockService{
		Challenges: make(map[uint]*models.Challenge),
		nextID:     1,
	}
}

func (m *MockService) CreateChallenge(req CreateChallengeRequest, createdBy uint) (*models.Challenge, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	visible := true
	if req.IsVisible != nil {
		visible = *req.IsVisible
	}
	ch := &models.Challenge{
		ID:          m.nextID,
		Title:       req.Title,
		Description: req.Description,
		Category:    models.ChallengeCategory(req.Category),
		Flag:        req.Flag,
		BaseScore:   req.BaseScore,
		IsVisible:   visible,
		CreatedBy:   createdBy,
	}
	if ch.BaseScore == 0 {
		ch.BaseScore = 100
	}
	m.Challenges[ch.ID] = ch
	m.nextID++
	return ch, nil
}

func (m *MockService) GetChallenge(id uint) (*models.Challenge, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	ch, ok := m.Challenges[id]
	if !ok {
		return nil, fmt.Errorf("challenge not found")
	}
	return ch, nil
}

func (m *MockService) ListChallenges(category string, showHidden bool) ([]models.Challenge, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	var result []models.Challenge
	for _, ch := range m.Challenges {
		if !showHidden && !ch.IsVisible {
			continue
		}
		if category != "" && string(ch.Category) != category {
			continue
		}
		result = append(result, *ch)
	}
	return result, nil
}

func (m *MockService) UpdateChallenge(id uint, req UpdateChallengeRequest, updatedBy ...uint) (*models.Challenge, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	ch, ok := m.Challenges[id]
	if !ok {
		return nil, fmt.Errorf("challenge not found")
	}
	if req.Title != nil {
		ch.Title = *req.Title
	}
	if req.Description != nil {
		ch.Description = *req.Description
	}
	if req.Flag != nil {
		ch.Flag = *req.Flag
	}
	if req.IsVisible != nil {
		ch.IsVisible = *req.IsVisible
	}
	return ch, nil
}

func (m *MockService) DeleteChallenge(id uint, deletedBy ...uint) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if _, ok := m.Challenges[id]; !ok {
		return fmt.Errorf("challenge not found")
	}
	delete(m.Challenges, id)
	return nil
}

func (m *MockService) SubmitFlag(challengeID uint, gameID uint, userID uint, teamID uint, flag string) (*SubmitResult, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	ch, ok := m.Challenges[challengeID]
	if !ok {
		return nil, fmt.Errorf("challenge not found")
	}
	if flag != ch.Flag {
		return &SubmitResult{Correct: false, Message: "wrong flag"}, nil
	}

	m.Solves = append(m.Solves, models.Solve{
		ChallengeID: challengeID,
		UserID:      userID,
		TeamID:      teamID,
		GameID:      gameID,
		Score:       ch.BaseScore,
		SolvedAt:    models.Solve{}.SolvedAt,
	})
	return &SubmitResult{Correct: true, Score: ch.BaseScore, Message: "correct"}, nil
}
