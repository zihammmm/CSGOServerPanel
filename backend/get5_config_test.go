package main

import (
	"encoding/json"
	"testing"
	"time"
)

func TestBuildGet5PayloadAndConvert(t *testing.T) {
	now := time.Date(2026, 3, 13, 12, 0, 0, 0, time.UTC)
	teamA := "A"
	teamB := "B"
	players := []matchPlayerItem{
		{SteamID: "76561198000000001", Nickname: "Alpha", Team: &teamA, IsCaptain: true},
		{SteamID: "76561198000000002", Nickname: "Bravo", Team: &teamA},
		{SteamID: "76561198000000003", Nickname: "Charlie", Team: &teamA},
		{SteamID: "76561198000000004", Nickname: "Delta", Team: &teamA},
		{SteamID: "76561198000000005", Nickname: "Echo", Team: &teamA},
		{SteamID: "76561198000000006", Nickname: "Foxtrot", Team: &teamB, IsCaptain: true},
		{SteamID: "76561198000000007", Nickname: "Golf", Team: &teamB},
		{SteamID: "76561198000000008", Nickname: "Hotel", Team: &teamB},
		{SteamID: "76561198000000009", Nickname: "India", Team: &teamB},
		{SteamID: "76561198000000010", Nickname: "Juliet", Team: &teamB},
	}

	payload, err := buildGet5Payload(matchRow{
		ID:        42,
		DisplayID: "MABC123",
		Title:     "Evening Scrim",
		Bo:        3,
		CreatedAt: now,
	}, players, []string{"de_inferno", "de_mirage", "de_nuke"}, []pickedMapDetail{
		{Map: "de_inferno", PickedByTeam: "A", StartSide: "T"},
		{Map: "de_mirage", PickedByTeam: "B", StartSide: "T"},
		{Map: "de_nuke"},
	})
	if err != nil {
		t.Fatalf("build payload: %v", err)
	}

	if payload.MatchID != "MABC123" {
		t.Fatalf("expected internal match id to stay as display id, got %q", payload.MatchID)
	}
	if len(payload.TeamA) != 5 || len(payload.TeamB) != 5 {
		t.Fatalf("unexpected internal team sizes: A=%d B=%d", len(payload.TeamA), len(payload.TeamB))
	}

	data, err := convertMatchPayloadToGet5Config(payload)
	if err != nil {
		t.Fatalf("convert payload: %v", err)
	}

	var cfg struct {
		MatchID        string   `json:"matchid"`
		MatchTitle     string   `json:"match_title"`
		NumMaps        int      `json:"num_maps"`
		PlayersPerTeam int      `json:"players_per_team"`
		SkipVeto       bool     `json:"skip_veto"`
		SideType       string   `json:"side_type"`
		MapSides       []string `json:"map_sides"`
		Maplist        []string `json:"maplist"`
		Team1          struct {
			Name    string            `json:"name"`
			Tag     string            `json:"tag"`
			Players map[string]string `json:"players"`
		} `json:"team1"`
		Team2 struct {
			Name    string            `json:"name"`
			Tag     string            `json:"tag"`
			Players map[string]string `json:"players"`
		} `json:"team2"`
	}
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("unmarshal config: %v", err)
	}

	if cfg.MatchID != "42" {
		t.Fatalf("expected get5 matchid to use database id, got %q", cfg.MatchID)
	}
	if cfg.MatchTitle != "Evening Scrim" {
		t.Fatalf("unexpected match title %q", cfg.MatchTitle)
	}
	if cfg.NumMaps != 3 || cfg.PlayersPerTeam != 5 || !cfg.SkipVeto {
		t.Fatalf("unexpected get5 config core values: %+v", cfg)
	}
	if cfg.SideType != "standard" {
		t.Fatalf("unexpected side_type %q", cfg.SideType)
	}
	wantSides := []string{"team1_t", "team1_ct", "knife"}
	if len(cfg.MapSides) != len(wantSides) {
		t.Fatalf("unexpected map_sides length: got=%d want=%d", len(cfg.MapSides), len(wantSides))
	}
	for i, want := range wantSides {
		if cfg.MapSides[i] != want {
			t.Fatalf("unexpected map_sides[%d]: got=%q want=%q", i, cfg.MapSides[i], want)
		}
	}
	if len(cfg.Team1.Players) != 5 || len(cfg.Team2.Players) != 5 {
		t.Fatalf("unexpected get5 team sizes: team1=%d team2=%d", len(cfg.Team1.Players), len(cfg.Team2.Players))
	}
	if cfg.Team1.Name != "Alpha" || cfg.Team2.Name != "Foxtrot" {
		t.Fatalf("captain names not propagated: team1=%q team2=%q", cfg.Team1.Name, cfg.Team2.Name)
	}
}
