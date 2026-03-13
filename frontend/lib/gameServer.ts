const gameAddr = process.env.NEXT_PUBLIC_GAME_SERVER_ADDRESS || "127.0.0.1:27015";

export function getGameServerAddress(): string {
  return gameAddr;
}

export function getGameServerConnectURL(): string {
  return `steam://rungameid/4465480//+connect ${gameAddr}`;
}
