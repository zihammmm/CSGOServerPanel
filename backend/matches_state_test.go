package main

import "testing"

func strPtr(v string) *string { return &v }

func TestComputeDraftStateABBA(t *testing.T) {
	players := []matchPlayerItem{
		{UserID: 1, Team: strPtr("A"), IsCaptain: true},
		{UserID: 2, Team: strPtr("B"), IsCaptain: true},
		{UserID: 3, Team: strPtr("A")},
		{UserID: 4, Team: strPtr("B")},
		{UserID: 5, Team: strPtr("B")},
	}
	idx, team := computeDraftState(players)
	if idx != 3 {
		t.Fatalf("expected draft idx=3, got %d", idx)
	}
	if team != "A" {
		t.Fatalf("expected team A turn, got %s", team)
	}
}

func TestComputeDraftStateFinished(t *testing.T) {
	players := []matchPlayerItem{
		{UserID: 1, Team: strPtr("A"), IsCaptain: true},
		{UserID: 2, Team: strPtr("B"), IsCaptain: true},
		{UserID: 3, Team: strPtr("A")},
		{UserID: 4, Team: strPtr("A")},
		{UserID: 5, Team: strPtr("A")},
		{UserID: 6, Team: strPtr("A")},
		{UserID: 7, Team: strPtr("B")},
		{UserID: 8, Team: strPtr("B")},
		{UserID: 9, Team: strPtr("B")},
		{UserID: 10, Team: strPtr("B")},
	}
	idx, team := computeDraftState(players)
	if idx != len(draftTurnScript) {
		t.Fatalf("expected draft complete idx=%d, got %d", len(draftTurnScript), idx)
	}
	if team != "" {
		t.Fatalf("expected no team turn, got %s", team)
	}
}

func TestBuildVetoScriptByBO(t *testing.T) {
	if got := len(buildVetoScript(1)); got != 6 {
		t.Fatalf("bo1 veto length should be 6, got %d", got)
	}
	if got := len(buildVetoScript(3)); got != 6 {
		t.Fatalf("bo3 veto length should be 6, got %d", got)
	}
	if got := len(buildVetoScript(5)); got != 2 {
		t.Fatalf("bo5 veto length should be 2, got %d", got)
	}
}

func TestComputeMapStateFinalization(t *testing.T) {
	bo1Steps := []vetoStepItem{
		{Order: 1, Team: "A", Action: "ban", Map: "de_ancient"},
		{Order: 2, Team: "B", Action: "ban", Map: "de_anubis"},
		{Order: 3, Team: "A", Action: "ban", Map: "de_dust2"},
		{Order: 4, Team: "B", Action: "ban", Map: "de_inferno"},
		{Order: 5, Team: "A", Action: "ban", Map: "de_mirage"},
		{Order: 6, Team: "B", Action: "ban", Map: "de_nuke"},
	}
	pool, picked, banned := computeMapState(1, matchStatusReadyToStart, bo1Steps)
	if len(pool) != 0 || len(picked) != 1 || len(banned) != 6 {
		t.Fatalf("bo1 finalize mismatch pool=%d picked=%d banned=%d", len(pool), len(picked), len(banned))
	}

	bo3Steps := []vetoStepItem{
		{Order: 1, Team: "A", Action: "ban", Map: "de_ancient"},
		{Order: 2, Team: "B", Action: "ban", Map: "de_anubis"},
		{Order: 3, Team: "A", Action: "pick", Map: "de_dust2"},
		{Order: 4, Team: "B", Action: "pick", Map: "de_inferno"},
		{Order: 5, Team: "A", Action: "ban", Map: "de_mirage"},
		{Order: 6, Team: "B", Action: "ban", Map: "de_nuke"},
	}
	pool, picked, _ = computeMapState(3, matchStatusReadyToStart, bo3Steps)
	if len(pool) != 0 || len(picked) != 3 {
		t.Fatalf("bo3 finalize mismatch pool=%d picked=%d", len(pool), len(picked))
	}
}

func TestComputeSeriesScore(t *testing.T) {
	a, b := computeSeriesScore(3, 3, 11)
	if a+b < 2 {
		t.Fatalf("series score invalid for bo3: %d-%d", a, b)
	}
	a, b = computeSeriesScore(5, 5, 12)
	if a+b < 3 {
		t.Fatalf("series score invalid for bo5: %d-%d", a, b)
	}
}
