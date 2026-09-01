package scoring

import (
	"math"

	"github.com/saurlax/sauryctf/internal/models"
)

func BloodType(solvesBefore int) string {
	switch solvesBefore {
	case 0:
		return "first"
	case 1:
		return "second"
	case 2:
		return "third"
	default:
		return ""
	}
}

// ComputeScore applies one shared scoring rule across the platform.
// Current rule:
// - first/second/third blood are recorded as metadata only
// - score decays exponentially with solve count
// - score is clamped by min_score
func ComputeScore(ch models.Challenge, solvesBefore int) int {
	base := ch.BaseScore
	if base == 0 {
		base = 100
	}

	minScore := ch.MinScore
	if minScore == 0 {
		minScore = 10
	}

	decayRate := ch.DecayRate
	if decayRate == 0 {
		decayRate = 0.1
	}

	score := float64(minScore) + (float64(base)-float64(minScore))*math.Exp(-decayRate*float64(solvesBefore))
	result := int(math.Round(score))
	if result < minScore {
		return minScore
	}
	return result
}
