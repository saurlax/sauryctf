package teams

import (
	"github.com/stretchr/testify/assert"

	"github.com/saurlax/sauryctf/internal/models"
)

// Compile-time check: MockService implements ServiceInterface.
var _ ServiceInterface = (*MockService)(nil)

type MockService struct {
	Teams   map[uint]*models.Team  // keyed by team ID
	Members map[uint]map[uint]bool // teamID -> userID -> exists
	Err     error                  // if set, all methods return this
	NextID  uint
	Locks   map[uint]*TeamLockSummary
}

func NewMockService() *MockService {
	return &MockService{
		Teams:   make(map[uint]*models.Team),
		Members: make(map[uint]map[uint]bool),
		NextID:  1,
		Locks:   make(map[uint]*TeamLockSummary),
	}
}

func (m *MockService) CreateTeam(name string, captainID uint) (*models.Team, error) {
	if m.Err != nil {
		return nil, m.Err
	}
	// check if captain already in a team
	for _, members := range m.Members {
		if members[captainID] {
			return nil, assert.AnError
		}
	}
	team := &models.Team{
		ID:         m.NextID,
		Name:       name,
		InviteCode: "INVITE",
		CaptainID:  captainID,
		Status:     models.TeamStatusActive,
	}
	m.NextID++
	m.Teams[team.ID] = team
	m.Members[team.ID] = map[uint]bool{captainID: true}
	return team, nil
}

func (m *MockService) JoinTeam(inviteCode string, userID uint) error {
	if m.Err != nil {
		return m.Err
	}
	// check if user already in a team
	for _, members := range m.Members {
		if members[userID] {
			return assert.AnError
		}
	}
	for _, team := range m.Teams {
		if team.InviteCode == inviteCode {
			m.Members[team.ID][userID] = true
			return nil
		}
	}
	return assert.AnError
}

func (m *MockService) LeaveTeam(teamID, userID uint) error {
	if m.Err != nil {
		return m.Err
	}
	team, ok := m.Teams[teamID]
	if !ok {
		return assert.AnError
	}
	if team.CaptainID == userID {
		return assert.AnError
	}
	delete(m.Members[teamID], userID)
	return nil
}

func (m *MockService) GetUserTeam(userID uint) (*TeamView, error) {
	if m.Err != nil {
		return nil, m.Err
	}
	for teamID, members := range m.Members {
		if members[userID] {
			lock := m.Locks[teamID]
			if lock == nil {
				lock = &TeamLockSummary{Locked: false, Games: []TeamLockGame{}}
			}
			return &TeamView{
				Team: *m.Teams[teamID],
				Lock: lock,
			}, nil
		}
	}
	return nil, assert.AnError
}

func (m *MockService) RemoveMember(teamID, memberID, requesterID uint) error {
	if m.Err != nil {
		return m.Err
	}
	team, ok := m.Teams[teamID]
	if !ok {
		return assert.AnError
	}
	if team.CaptainID != requesterID {
		return assert.AnError
	}
	delete(m.Members[teamID], memberID)
	return nil
}
