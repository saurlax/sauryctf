package challenges_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/saurlax/sauryctf/internal/challenges"
	"github.com/saurlax/sauryctf/internal/db"
	"github.com/saurlax/sauryctf/internal/models"
)

func setupService(t *testing.T) (*challenges.Service, func()) {
	database, err := db.ConnectTest()
	require.NoError(t, err)
	err = db.Migrate(database)
	require.NoError(t, err)

	cleanup := func() {
		db.CleanTables(database)
	}
	cleanup()

	return challenges.NewService(database), cleanup
}

func TestService_CreateChallenge(t *testing.T) {
	svc, cleanup := setupService(t)
	defer cleanup()

	visible := true
	ch, err := svc.CreateChallenge(challenges.CreateChallengeRequest{
		Title:     "XSS Challenge",
		Category:  "web",
		Flag:      "flag{xss}",
		IsVisible: &visible,
	}, 1)
	assert.NoError(t, err)
	assert.Equal(t, "XSS Challenge", ch.Title)
	assert.Equal(t, models.ChallengeCategory("web"), ch.Category)
	assert.Equal(t, 100, ch.BaseScore)
	assert.True(t, ch.IsVisible)
}

func TestService_CreateChallenge_Defaults(t *testing.T) {
	svc, cleanup := setupService(t)
	defer cleanup()

	ch, err := svc.CreateChallenge(challenges.CreateChallengeRequest{
		Title:    "Default Challenge",
		Category: "pwn",
		Flag:     "flag{default}",
	}, 1)
	assert.NoError(t, err)
	assert.Equal(t, models.TypeStatic, ch.Type)
	assert.Equal(t, models.DifficultyEasy, ch.Difficulty)
	assert.Equal(t, 100, ch.BaseScore)
	assert.Equal(t, 10, ch.MinScore)
	assert.Equal(t, 0.1, ch.DecayRate)
	assert.True(t, ch.IsVisible)
}

func TestService_GetChallenge(t *testing.T) {
	svc, cleanup := setupService(t)
	defer cleanup()

	visible := true
	created, _ := svc.CreateChallenge(challenges.CreateChallengeRequest{
		Title: "Get Me", Category: "web", Flag: "flag{get}", IsVisible: &visible,
	}, 1)

	ch, err := svc.GetChallenge(created.ID)
	assert.NoError(t, err)
	assert.Equal(t, "Get Me", ch.Title)
}

func TestService_GetChallenge_NotFound(t *testing.T) {
	svc, cleanup := setupService(t)
	defer cleanup()

	_, err := svc.GetChallenge(999)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "not found")
}

func TestService_ListChallenges_FilterCategory(t *testing.T) {
	svc, cleanup := setupService(t)
	defer cleanup()

	visible := true
	svc.CreateChallenge(challenges.CreateChallengeRequest{
		Title: "Web 1", Category: "web", Flag: "flag{w1}", IsVisible: &visible,
	}, 1)
	svc.CreateChallenge(challenges.CreateChallengeRequest{
		Title: "Pwn 1", Category: "pwn", Flag: "flag{p1}", IsVisible: &visible,
	}, 1)
	svc.CreateChallenge(challenges.CreateChallengeRequest{
		Title: "Web 2", Category: "web", Flag: "flag{w2}", IsVisible: &visible,
	}, 1)

	chs, err := svc.ListChallenges("web", false)
	assert.NoError(t, err)
	assert.Len(t, chs, 2)
}

func TestService_ListChallenges_HiddenFilter(t *testing.T) {
	svc, cleanup := setupService(t)
	defer cleanup()

	visible := true
	hidden := false
	svc.CreateChallenge(challenges.CreateChallengeRequest{
		Title: "Visible", Category: "web", Flag: "flag{v}", IsVisible: &visible,
	}, 1)
	svc.CreateChallenge(challenges.CreateChallengeRequest{
		Title: "Hidden", Category: "web", Flag: "flag{h}", IsVisible: &hidden,
	}, 1)

	// Without show_hidden
	chs, _ := svc.ListChallenges("", false)
	assert.Len(t, chs, 1)
	assert.Equal(t, "Visible", chs[0].Title)

	// With show_hidden
	chs, _ = svc.ListChallenges("", true)
	assert.Len(t, chs, 2)
}

func TestService_UpdateChallenge(t *testing.T) {
	svc, cleanup := setupService(t)
	defer cleanup()

	visible := true
	ch, _ := svc.CreateChallenge(challenges.CreateChallengeRequest{
		Title: "Old", Category: "web", Flag: "flag{old}", IsVisible: &visible,
	}, 1)

	newTitle := "Updated"
	updated, err := svc.UpdateChallenge(ch.ID, challenges.UpdateChallengeRequest{
		Title: &newTitle,
	})
	assert.NoError(t, err)
	assert.Equal(t, "Updated", updated.Title)
}

func TestService_DeleteChallenge(t *testing.T) {
	svc, cleanup := setupService(t)
	defer cleanup()

	visible := true
	ch, _ := svc.CreateChallenge(challenges.CreateChallengeRequest{
		Title: "Delete Me", Category: "web", Flag: "flag{del}", IsVisible: &visible,
	}, 1)

	err := svc.DeleteChallenge(ch.ID)
	assert.NoError(t, err)

	_, err = svc.GetChallenge(ch.ID)
	assert.Error(t, err)
}

func TestService_SubmitFlag_Correct(t *testing.T) {
	svc, cleanup := setupService(t)
	defer cleanup()

	visible := true
	ch, _ := svc.CreateChallenge(challenges.CreateChallengeRequest{
		Title:     "Submit Test",
		Category:  "web",
		Flag:      "flag{submit}",
		BaseScore: 200,
		IsVisible: &visible,
	}, 1)

	result, err := svc.SubmitFlag(ch.ID, 1, 10, 1, "flag{submit}")
	assert.NoError(t, err)
	assert.True(t, result.Correct)
	assert.Equal(t, "first", result.BloodType)
	assert.Equal(t, 200, result.Score)
}

func TestService_SubmitFlag_WrongFlag(t *testing.T) {
	svc, cleanup := setupService(t)
	defer cleanup()

	visible := true
	ch, _ := svc.CreateChallenge(challenges.CreateChallengeRequest{
		Title: "Wrong Test", Category: "web", Flag: "flag{right}", IsVisible: &visible,
	}, 1)

	result, err := svc.SubmitFlag(ch.ID, 1, 10, 1, "flag{wrong}")
	assert.NoError(t, err)
	assert.False(t, result.Correct)
	assert.Equal(t, "wrong flag", result.Message)
}

func TestService_SubmitFlag_DuplicateSolve(t *testing.T) {
	svc, cleanup := setupService(t)
	defer cleanup()

	visible := true
	ch, _ := svc.CreateChallenge(challenges.CreateChallengeRequest{
		Title: "Dup Test", Category: "web", Flag: "flag{dup}", IsVisible: &visible,
	}, 1)

	// First solve
	svc.SubmitFlag(ch.ID, 1, 10, 1, "flag{dup}")

	// Same team tries again
	result, err := svc.SubmitFlag(ch.ID, 1, 10, 1, "flag{dup}")
	assert.NoError(t, err)
	assert.False(t, result.Correct)
	assert.Equal(t, "already solved by your team", result.Message)
}

func TestService_SubmitFlag_BloodBonuses(t *testing.T) {
	svc, cleanup := setupService(t)
	defer cleanup()

	visible := true
	ch, _ := svc.CreateChallenge(challenges.CreateChallengeRequest{
		Title:     "Blood Test",
		Category:  "web",
		Flag:      "flag{blood}",
		BaseScore: 100,
		IsVisible: &visible,
	}, 1)

	// First blood keeps the base score and records blood metadata.
	r1, _ := svc.SubmitFlag(ch.ID, 1, 10, 1, "flag{blood}")
	assert.Equal(t, "first", r1.BloodType)
	assert.Equal(t, 100, r1.Score)

	// Second blood decays but uses the same scoring rule as game-scoped submissions.
	r2, _ := svc.SubmitFlag(ch.ID, 1, 20, 2, "flag{blood}")
	assert.Equal(t, "second", r2.BloodType)
	assert.Equal(t, 91, r2.Score)

	// Third blood continues to decay while preserving blood metadata.
	r3, _ := svc.SubmitFlag(ch.ID, 1, 30, 3, "flag{blood}")
	assert.Equal(t, "third", r3.BloodType)
	assert.Equal(t, 84, r3.Score)

	// Further solves only receive the decayed score.
	r4, _ := svc.SubmitFlag(ch.ID, 1, 40, 4, "flag{blood}")
	assert.Equal(t, "", r4.BloodType)
	assert.Equal(t, 77, r4.Score)
}
