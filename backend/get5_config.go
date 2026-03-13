package main

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
)

type internalMatchPayload struct {
	MatchID          string                `json:"matchId"`
	SeriesType       int                   `json:"bo"`
	Maplist          []string              `json:"maplist"`
	PickedMapDetails []pickedMapDetail     `json:"pickedMapDetails"`
	TeamA            []internalMatchPlayer `json:"teamA"`
	TeamB            []internalMatchPlayer `json:"teamB"`
	Server           string                `json:"server"`
	GeneratedAt      string                `json:"generatedAt"`
	Title            string                `json:"title"`
	DatabaseMatchID  int64                 `json:"databaseMatchId"`
}

type internalMatchPlayer struct {
	SteamID   string `json:"steamId"`
	Nickname  string `json:"nickname"`
	IsCaptain bool   `json:"isCaptain,omitempty"`
}

type get5MatchConfig struct {
	MatchID           string        `json:"matchid,omitempty"`
	MatchTitle        string        `json:"match_title,omitempty"`
	NumMaps           int           `json:"num_maps,omitempty"`
	PlayersPerTeam    int           `json:"players_per_team,omitempty"`
	MinPlayersToReady int           `json:"min_players_to_ready,omitempty"`
	SkipVeto          bool          `json:"skip_veto,omitempty"`
	SideType          string        `json:"side_type,omitempty"`
	MapSides          []string      `json:"map_sides,omitempty"`
	Maplist           []string      `json:"maplist"`
	Team1             get5MatchTeam `json:"team1"`
	Team2             get5MatchTeam `json:"team2"`
}

type get5MatchTeam struct {
	Name    string            `json:"name"`
	Tag     string            `json:"tag,omitempty"`
	Players map[string]string `json:"players"`
}

func convertMatchPayloadToGet5Config(payload internalMatchPayload) ([]byte, error) {
	if len(payload.TeamA) != 5 || len(payload.TeamB) != 5 {
		return nil, fmt.Errorf("get5 config requires 5 players per team, got teamA=%d teamB=%d", len(payload.TeamA), len(payload.TeamB))
	}
	if len(payload.Maplist) == 0 {
		return nil, fmt.Errorf("get5 config requires at least one selected map")
	}

	cfg := get5MatchConfig{
		MatchID:           strconv.FormatInt(payload.DatabaseMatchID, 10),
		MatchTitle:        strings.TrimSpace(payload.Title),
		NumMaps:           len(payload.Maplist),
		PlayersPerTeam:    5,
		MinPlayersToReady: 5,
		SkipVeto:          true,
		SideType:          "standard",
		MapSides:          buildGet5MapSides(payload.Maplist, payload.PickedMapDetails),
		Maplist:           append([]string{}, payload.Maplist...),
		Team1: get5MatchTeam{
			Name:    buildGet5TeamName("A", payload.TeamA),
			Tag:     "A",
			Players: buildGet5TeamPlayers(payload.TeamA),
		},
		Team2: get5MatchTeam{
			Name:    buildGet5TeamName("B", payload.TeamB),
			Tag:     "B",
			Players: buildGet5TeamPlayers(payload.TeamB),
		},
	}

	return json.Marshal(cfg)
}

func buildGet5TeamPlayers(players []internalMatchPlayer) map[string]string {
	out := make(map[string]string, len(players))
	for _, p := range players {
		out[strings.TrimSpace(p.SteamID)] = strings.TrimSpace(p.Nickname)
	}
	return out
}

func buildGet5TeamName(side string, players []internalMatchPlayer) string {
	for _, p := range players {
		if p.IsCaptain && strings.TrimSpace(p.Nickname) != "" {
			return p.Nickname
		}
	}
	return "Team " + side
}

func buildGet5MapSides(maplist []string, pickedMapDetails []pickedMapDetail) []string {
	if len(maplist) == 0 {
		return nil
	}
	detailsByMap := make(map[string]pickedMapDetail, len(pickedMapDetails))
	for _, detail := range pickedMapDetails {
		detailsByMap[strings.TrimSpace(detail.Map)] = detail
	}

	out := make([]string, 0, len(maplist))
	for _, mapName := range maplist {
		detail, ok := detailsByMap[strings.TrimSpace(mapName)]
		if !ok {
			out = append(out, "knife")
			continue
		}
		switch {
		case detail.PickedByTeam == "A" && detail.StartSide == "T":
			out = append(out, "team1_t")
		case detail.PickedByTeam == "A" && detail.StartSide == "CT":
			out = append(out, "team1_ct")
		case detail.PickedByTeam == "B" && detail.StartSide == "T":
			out = append(out, "team1_ct")
		case detail.PickedByTeam == "B" && detail.StartSide == "CT":
			out = append(out, "team1_t")
		default:
			out = append(out, "knife")
		}
	}
	return out
}
