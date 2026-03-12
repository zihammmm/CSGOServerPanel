import * as mock from "./matchesMock";
import * as api from "./matchesApi";

export type {
  MatchStatus,
  CaptainMode,
  TeamSide,
  BoType,
  VetoActionType,
  MatchUser,
  MatchPlayer,
  VetoStep,
  MatchSummary,
  MatchPlayerStat,
  MatchMapResult,
  MatchDetail,
} from "./matchesMock";

const useMock = process.env.NEXT_PUBLIC_MATCHES_USE_MOCK !== "false";

export const listMatches = (...args: Parameters<typeof mock.listMatches>): ReturnType<typeof mock.listMatches> =>
  (useMock ? mock.listMatches : api.listMatches)(...args);

export const getMatchDetail = (...args: Parameters<typeof mock.getMatchDetail>): ReturnType<typeof mock.getMatchDetail> =>
  (useMock ? mock.getMatchDetail : api.getMatchDetail)(...args);

export const createMatch = (...args: Parameters<typeof mock.createMatch>): ReturnType<typeof mock.createMatch> =>
  (useMock ? mock.createMatch : api.createMatch)(...args);

export const startMatch = (...args: Parameters<typeof mock.startMatch>): ReturnType<typeof mock.startMatch> =>
  (useMock ? mock.startMatch : api.startMatch)(...args);

export const joinMatch = (...args: Parameters<typeof mock.joinMatch>): ReturnType<typeof mock.joinMatch> =>
  (useMock ? mock.joinMatch : api.joinMatch)(...args);

export const leaveMatch = (...args: Parameters<typeof mock.leaveMatch>): ReturnType<typeof mock.leaveMatch> =>
  (useMock ? mock.leaveMatch : api.leaveMatch)(...args);

export const assignCaptains = (...args: Parameters<typeof mock.assignCaptains>): ReturnType<typeof mock.assignCaptains> =>
  (useMock ? mock.assignCaptains : api.assignCaptains)(...args);

export const draftPick = (...args: Parameters<typeof mock.draftPick>): ReturnType<typeof mock.draftPick> =>
  (useMock ? mock.draftPick : api.draftPick)(...args);

export const vetoMap = (...args: Parameters<typeof mock.vetoMap>): ReturnType<typeof mock.vetoMap> =>
  (useMock ? mock.vetoMap : api.vetoMap)(...args);

export const launchMatch = (...args: Parameters<typeof mock.launchMatch>): ReturnType<typeof mock.launchMatch> =>
  (useMock ? mock.launchMatch : api.launchMatch)(...args);

export const forceStartMatch = (...args: Parameters<typeof mock.forceStartMatch>): ReturnType<typeof mock.forceStartMatch> =>
  (useMock ? mock.forceStartMatch : api.forceStartMatch)(...args);

export const cancelMatch = (...args: Parameters<typeof mock.cancelMatch>): ReturnType<typeof mock.cancelMatch> =>
  (useMock ? mock.cancelMatch : api.cancelMatch)(...args);

export const finishMatch = (...args: Parameters<typeof mock.finishMatch>): ReturnType<typeof mock.finishMatch> =>
  (useMock ? mock.finishMatch : api.finishMatch)(...args);
